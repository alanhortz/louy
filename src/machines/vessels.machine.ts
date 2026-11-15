/**
 * Machine du trafic fluvial : quand le calque est allumé, elle relève toutes
 * les trente secondes les bateaux présents sur les voies navigables wallonnes
 * et les publie ; le visiteur peut en choisir un pour lire ce qu'il annonce.
 *
 *   hidden ◀──▶ visible ─┬─ fetching ──▶ waiting ──(30 s)──▶ fetching
 *                        └─ faltering ──(15 s)──▶ fetching
 */

import { assign, fromPromise, sendParent, setup, type SnapshotFrom } from 'xstate';
import { VESSEL_POLL_MS, vesselLabel, vesselStateLabel, type Vessel } from '../domain/vessels.ts';
import type { VesselFeature } from '../engine/overlays/vesselMarkers.ts';
import { loadVessels } from '../services/vessels.ts';
import type { LayerFeed } from './places.machine.ts';

export type VesselsEvent =
  | { type: 'vessels.toggled' }
  | { type: 'vessels.picked'; id: string }
  | { type: 'vessels.dismissed' }
  | { type: 'vessels.locateRequested' };

export type VesselsEmitted =
  | { type: 'vessels.changed'; visible: boolean; features: VesselFeature[] }
  | { type: 'vessels.selectionChanged'; vessel: Vessel | null }
  | { type: 'vessels.flyRequested'; x: number; y: number; height: number };

interface VesselsContext {
  visible: boolean;
  list: Vessel[];
  /** Instant du dernier relevé réussi, en millisecondes Unix. */
  updatedAt: number | null;
  selectedId: string | null;
}

/** Délai avant un nouvel essai quand EuRIS n'a pas répondu. */
const RETRY_MS = 15_000;
/** Hauteur d'où regarder un bateau quand on demande à le situer sur la carte. */
const LOCATE_HEIGHT = 260;

const toFeature = (vessel: Vessel): VesselFeature => ({
  id: vessel.id, x: vessel.x, y: vessel.y,
  label: vesselLabel(vessel), detail: vesselStateLabel(vessel),
  course: vessel.course, length: vessel.length ?? 40, beam: vessel.beam ?? 6, moving: vessel.moving,
  // les bateaux en route passent avant ceux à quai quand la place manque ; à défaut, les plus longs
  rank: (vessel.moving ? 1000 : 0) + (vessel.length ?? 0),
});

const selected = ({ list, selectedId }: VesselsContext): Vessel | null =>
  list.find((vessel) => vessel.id === selectedId) ?? null;

export const vesselsMachine = setup({
  types: {
    context: {} as VesselsContext,
    events: {} as VesselsEvent,
    input: {} as { visible: boolean },
  },
  actors: {
    loadVessels: fromPromise<Vessel[]>(({ signal }) => loadVessels(signal)),
  },
  delays: { POLL: VESSEL_POLL_MS, RETRY: RETRY_MS },
  guards: {
    startsVisible: ({ context }) => context.visible,
    picksKnownVessel: ({ context, event }) =>
      event.type === 'vessels.picked' && context.list.some((vessel) => vessel.id === event.id),
    hasSelection: ({ context }) => selected(context) !== null,
    /** Le bateau choisi ne figure plus dans le relevé : il a quitté la couverture. */
    lostSelection: ({ context, event }) =>
      context.selectedId !== null
      && !(event as unknown as { output: Vessel[] }).output.some((vessel) => vessel.id === context.selectedId),
  },
  actions: {
    publish: sendParent(({ context }): VesselsEmitted =>
      ({ type: 'vessels.changed', visible: true, features: context.list.map(toFeature) })),
    withdraw: sendParent((): VesselsEmitted => ({ type: 'vessels.changed', visible: false, features: [] })),
    announceSelection: sendParent(({ context }): VesselsEmitted =>
      ({ type: 'vessels.selectionChanged', vessel: selected(context) })),
    requestFly: sendParent(({ context }): VesselsEmitted => {
      const vessel = selected(context)!;
      return { type: 'vessels.flyRequested', x: vessel.x, y: vessel.y, height: LOCATE_HEIGHT };
    }),
    keepList: assign({
      list: ({ event }) => (event as unknown as { output: Vessel[] }).output,
      updatedAt: () => Date.now(),
    }),
  },
}).createMachine({
  id: 'vessels',
  context: ({ input }) => ({ visible: input.visible, list: [], updatedAt: null, selectedId: null }),
  initial: 'resolving',
  states: {
    resolving: {
      always: [{ guard: 'startsVisible', target: 'visible' }, { target: 'hidden' }],
    },
    hidden: {
      entry: assign({ visible: false }),
      on: { 'vessels.toggled': 'visible' },
    },
    visible: {
      entry: assign({ visible: true }),
      exit: [assign({ list: [], selectedId: null }), 'withdraw', 'announceSelection'],
      initial: 'fetching',
      on: {
        'vessels.toggled': 'hidden',
        'vessels.picked': {
          guard: 'picksKnownVessel',
          actions: [assign({ selectedId: ({ event }) => event.id }), 'announceSelection'],
        },
        'vessels.dismissed': { guard: 'hasSelection', actions: [assign({ selectedId: null }), 'announceSelection'] },
        'vessels.locateRequested': { guard: 'hasSelection', actions: 'requestFly' },
      },
      states: {
        fetching: {
          invoke: {
            id: 'vessels.feed',
            src: 'loadVessels',
            onDone: [
              { guard: 'lostSelection', target: 'waiting', actions: ['keepList', assign({ selectedId: null }), 'publish', 'announceSelection'] },
              { target: 'waiting', actions: ['keepList', 'publish'] },
            ],
            onError: 'faltering',
          },
        },
        waiting: { after: { POLL: 'fetching' } },
        /** EuRIS n'a pas répondu : les dernières positions restent affichées, on réessaie plus tard. */
        faltering: { after: { RETRY: 'fetching' } },
      },
    },
  },
});

/* ------------------------------------------------------------- lecture --- */

type VesselsSnapshot = SnapshotFrom<typeof vesselsMachine>;

export function vesselsFeed(snapshot: VesselsSnapshot): LayerFeed {
  if (!snapshot.matches('visible')) return 'off';
  if (snapshot.matches({ visible: 'faltering' })) return snapshot.context.updatedAt === null ? 'unavailable' : 'degraded';
  return snapshot.context.updatedAt === null ? 'loading' : 'nominal';
}

export const selectedVessel = (snapshot: VesselsSnapshot): Vessel | null => selected(snapshot.context);
