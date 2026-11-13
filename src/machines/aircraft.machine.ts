/**
 * Machine des avions en direct : relève périodiquement les appareils au-dessus
 * de la Wallonie, retient celui que le visiteur a choisi, et tient la caméra à
 * son poste de pilotage quand il le demande.
 *
 *   hidden ⇄ visible ─┬─ fetching ──▶ waiting ──(8 s)──▶ fetching …
 *                     └─ faltering ──(15 s)──▶ fetching     (le réseau n'a pas répondu)
 *
 * La sélection, la recherche et le cockpit sont des données de contexte : ils
 * survivent aux relevés, qui ne font que rafraîchir la liste.
 */

import { assign, fromPromise, sendParent, setup, type SnapshotFrom } from 'xstate';
import {
  AIRCRAFT_POLL_MS, MAX_EXTRAPOLATION_S, aircraftVelocity, searchAircraft, type Aircraft,
} from '../domain/aircraft.ts';
import type { FollowTarget } from '../engine/SceneEngine.ts';
import type { AircraftFeature } from '../engine/overlays/aircraftMarkers.ts';
import { loadAircraft } from '../services/aircraft.ts';
import type { LayerFeed } from './places.machine.ts';

export type AircraftEvent =
  | { type: 'aircraft.toggled' }
  | { type: 'aircraft.picked'; id: string }
  | { type: 'aircraft.dismissed' }
  | { type: 'aircraft.queryChanged'; query: string }
  | { type: 'aircraft.cockpitRequested' }
  | { type: 'aircraft.cockpitLeft' }
  | { type: 'aircraft.locateRequested' };

export type AircraftEmitted =
  | { type: 'aircraft.changed'; visible: boolean; features: AircraftFeature[] }
  | { type: 'aircraft.selectionChanged'; aircraft: Aircraft | null }
  | { type: 'aircraft.followChanged'; target: FollowTarget | null }
  | { type: 'aircraft.flyRequested'; x: number; y: number; height: number };

interface AircraftContext {
  visible: boolean;
  list: Aircraft[];
  /** Instant du dernier relevé réussi, en millisecondes Unix. */
  updatedAt: number | null;
  selectedId: string | null;
  /** Le visiteur est au poste de pilotage de l'appareil sélectionné. */
  inCockpit: boolean;
  query: string;
}

/** Délai avant un nouvel essai quand le réseau n'a pas répondu. */
const RETRY_MS = 15_000;
/** Hauteur d'où regarder un appareil quand on demande à le situer sur la carte. */
const LOCATE_HEIGHT = 2500;

const metres = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 });

const toFeature = (aircraft: Aircraft): AircraftFeature => ({
  id: aircraft.id,
  x: aircraft.x,
  y: aircraft.y,
  label: aircraft.callsign,
  detail: aircraft.altitude === null ? 'au sol' : `${metres.format(aircraft.altitude)} m`,
  track: aircraft.track,
  // les appareils en vol passent avant ceux au sol quand la place manque
  rank: aircraft.altitude ?? -1,
  ...(aircraft.altitude === null ? {} : { altitude: aircraft.altitude }),
  motion: { ...aircraftVelocity(aircraft), at: aircraft.seenAt, horizon: MAX_EXTRAPOLATION_S },
});

const toFollow = (aircraft: Aircraft): FollowTarget => ({
  x: aircraft.x,
  y: aircraft.y,
  altitude: aircraft.altitude,
  ...aircraftVelocity(aircraft),
  track: aircraft.track,
  at: aircraft.seenAt,
  horizon: MAX_EXTRAPOLATION_S,
});

const selected = ({ list, selectedId }: AircraftContext): Aircraft | null =>
  list.find((aircraft) => aircraft.id === selectedId) ?? null;

export const aircraftMachine = setup({
  types: {
    context: {} as AircraftContext,
    events: {} as AircraftEvent,
    input: {} as { visible: boolean },
  },
  actors: {
    loadAircraft: fromPromise<Aircraft[]>(({ signal }) => loadAircraft(signal)),
  },
  delays: { POLL: AIRCRAFT_POLL_MS, RETRY: RETRY_MS },
  guards: {
    startsVisible: ({ context }) => context.visible,
    picksKnownAircraft: ({ context, event }) =>
      event.type === 'aircraft.picked' && context.list.some((aircraft) => aircraft.id === event.id),
    hasSelection: ({ context }) => selected(context) !== null,
    /** L'appareil choisi ne figure plus dans le relevé : il a quitté le ciel wallon, ou s'est posé hors de portée. */
    lostSelection: ({ context, event }) =>
      context.selectedId !== null
      && !(event as unknown as { output: Aircraft[] }).output.some((aircraft) => aircraft.id === context.selectedId),
    isInCockpit: ({ context }) => context.inCockpit,
  },
  actions: {
    publish: sendParent(({ context }): AircraftEmitted =>
      ({ type: 'aircraft.changed', visible: true, features: context.list.map(toFeature) })),
    withdraw: sendParent((): AircraftEmitted => ({ type: 'aircraft.changed', visible: false, features: [] })),
    announceSelection: sendParent(({ context }): AircraftEmitted =>
      ({ type: 'aircraft.selectionChanged', aircraft: selected(context) })),
    announceFollow: sendParent(({ context }): AircraftEmitted => {
      const aircraft = selected(context);
      return { type: 'aircraft.followChanged', target: context.inCockpit && aircraft ? toFollow(aircraft) : null };
    }),
    requestFly: sendParent(({ context }): AircraftEmitted => {
      const aircraft = selected(context)!;
      return { type: 'aircraft.flyRequested', x: aircraft.x, y: aircraft.y, height: (aircraft.altitude ?? 0) + LOCATE_HEIGHT };
    }),
    /** Un relevé vient d'arriver : il remplace la liste. */
    keepList: assign({
      list: ({ event }) => (event as unknown as { output: Aircraft[] }).output,
      updatedAt: () => Date.now(),
    }),
    dropSelection: assign({ selectedId: null, inCockpit: false }),
  },
}).createMachine({
  id: 'aircraft',
  context: ({ input }) => ({ visible: input.visible, list: [], updatedAt: null, selectedId: null, inCockpit: false, query: '' }),
  initial: 'resolving',
  states: {
    resolving: {
      always: [{ guard: 'startsVisible', target: 'visible' }, { target: 'hidden' }],
    },
    hidden: {
      entry: assign({ visible: false }),
      on: { 'aircraft.toggled': 'visible' },
    },
    visible: {
      entry: assign({ visible: true }),
      exit: [
        assign({ list: [], selectedId: null, inCockpit: false, query: '' }),
        'withdraw', 'announceSelection', 'announceFollow',
      ],
      initial: 'fetching',
      on: {
        'aircraft.toggled': 'hidden',
        'aircraft.queryChanged': { actions: assign({ query: ({ event }) => event.query }) },
        'aircraft.picked': {
          guard: 'picksKnownAircraft',
          // changer d'appareil fait quitter le cockpit du précédent
          actions: [assign({ selectedId: ({ event }) => event.id, inCockpit: false }), 'announceSelection', 'announceFollow'],
        },
        'aircraft.dismissed': {
          actions: [assign({ selectedId: null, inCockpit: false }), 'announceSelection', 'announceFollow'],
        },
        'aircraft.cockpitRequested': {
          guard: 'hasSelection',
          actions: [assign({ inCockpit: true }), 'announceFollow'],
        },
        'aircraft.cockpitLeft': { actions: [assign({ inCockpit: false }), 'announceFollow'] },
        'aircraft.locateRequested': {
          guard: 'hasSelection',
          actions: [assign({ inCockpit: false }), 'announceFollow', 'requestFly'],
        },
      },
      states: {
        fetching: {
          invoke: {
            id: 'aircraft.feed',
            src: 'loadAircraft',
            // la liste est publiée ; l'appareil suivi donne sa nouvelle position à la caméra ;
            // s'il a disparu du relevé, on le lâche. (Le panneau lit l'appareil choisi dans le
            // contexte : inutile de ré-annoncer la sélection, ce qui rouvrirait le panneau.)
            onDone: [
              {
                guard: 'lostSelection',
                target: 'waiting',
                actions: ['keepList', 'dropSelection', 'publish', 'announceSelection', 'announceFollow'],
              },
              { guard: 'isInCockpit', target: 'waiting', actions: ['keepList', 'publish', 'announceFollow'] },
              { target: 'waiting', actions: ['keepList', 'publish'] },
            ],
            onError: 'faltering',
          },
        },
        waiting: { after: { POLL: 'fetching' } },
        /** Le réseau n'a pas répondu : les dernières positions restent affichées, on réessaie plus tard. */
        faltering: { after: { RETRY: 'fetching' } },
      },
    },
  },
});

/* ------------------------------------------------------------- lecture --- */

type AircraftSnapshot = SnapshotFrom<typeof aircraftMachine>;

export function aircraftFeed(snapshot: AircraftSnapshot): LayerFeed {
  if (!snapshot.matches('visible')) return 'off';
  if (snapshot.matches({ visible: 'faltering' })) return snapshot.context.updatedAt === null ? 'unavailable' : 'degraded';
  return snapshot.context.updatedAt === null ? 'loading' : 'nominal';
}

export const selectedAircraft = (snapshot: AircraftSnapshot): Aircraft | null => selected(snapshot.context);

/** Appareils correspondant à la recherche en cours, par indicatif. */
export const listedAircraft = (snapshot: AircraftSnapshot): Aircraft[] =>
  searchAircraft(snapshot.context.list, snapshot.context.query);
