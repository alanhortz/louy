/**
 * Machine de la trajectoire d'un vol : la quatrième dimension du calque des avions.
 *
 * Pour l'appareil sélectionné, elle tient ensemble la trace que le site a
 * relevée de lui et l'estimation de sa route devant lui, refaites à chaque
 * relevé. Le visiteur peut déplacer un curseur dans le temps, du premier relevé
 * aux prochaines minutes : la machine dit alors où l'appareil était, ou devrait être.
 * Elle cherche aussi, une fois par appareil, la liaison que dessert son indicatif.
 *
 *   idle ──▶ tracking ─┬─ routing ──▶ routed   (d'où il vient, où il va)
 *                      └─ (curseur : un instant du passé ou de l'avenir, ou « maintenant »)
 */

import { assign, fromPromise, sendParent, setup, type SnapshotFrom } from 'xstate';
import type { Aircraft } from '../domain/aircraft.ts';
import { isPlausibleRoute, routeCallsign, type FlightRoute } from '../domain/flightRoute.ts';
import { toWgs84 } from '../domain/lambert2008.ts';
import { AHEAD_SECONDS, pointAt, projectAhead, thin, type TrackPoint } from '../domain/trajectory.ts';
import { loadRoute } from '../services/aircraft.ts';

export type TrajectoryEvent =
  /** L'appareil sélectionné, tel que le dernier relevé le donne, et sa trace ; `null` quand plus aucun ne l'est. */
  | { type: 'trajectory.aircraftChanged'; aircraft: Aircraft | null; track: TrackPoint[] }
  /** Curseur du temps, en secondes par rapport à maintenant : négatif dans le passé, positif dans l'avenir. */
  | { type: 'trajectory.scrubbed'; offset: number };

export type TrajectoryEmitted = {
  type: 'trajectory.changed';
  /** Trace relevée du vol, jusqu'à l'appareil ; estimation devant lui ; point du curseur, s'il n'est pas sur « maintenant ». */
  past: TrackPoint[];
  future: TrackPoint[];
  cursor: TrackPoint | null;
};

interface TrajectoryContext {
  aircraft: Aircraft | null;
  past: TrackPoint[];
  future: TrackPoint[];
  /** Liaison que dessert l'indicatif de l'appareil ; `null` tant qu'elle n'est pas connue, ou s'il n'en a pas. */
  route: FlightRoute | null;
  /** Décalage du curseur, en secondes ; 0 = maintenant. */
  offset: number;
  /** Instant auquel l'estimation a été faite : l'origine du curseur. */
  now: number;
}

const cursorOf = (context: TrajectoryContext): TrackPoint | null => {
  if (context.offset === 0) return null;
  const at = context.now + context.offset * 1000;
  return context.offset < 0 ? pointAt(context.past, at) : pointAt(context.future, at);
};

export const trajectoryMachine = setup({
  types: {
    context: {} as TrajectoryContext,
    events: {} as TrajectoryEvent,
  },
  actors: {
    /** Sans indicatif de ligne régulière, il n'y a rien à demander. */
    loadRoute: fromPromise<FlightRoute | null, string | null>(({ input, signal }) =>
      (input ? loadRoute(input, signal) : Promise.resolve(null))),
  },
  guards: {
    otherAircraft: ({ context, event }) =>
      event.type === 'trajectory.aircraftChanged' && event.aircraft !== null && event.aircraft.id !== context.aircraft?.id,
    hasAircraft: ({ event }) => event.type === 'trajectory.aircraftChanged' && event.aircraft !== null,
  },
  actions: {
    /** Un nouveau relevé de l'appareil : sa trace s'est allongée, et l'estimation est refaite. */
    keepAircraft: assign(({ context, event }) => {
      if (event.type !== 'trajectory.aircraftChanged' || !event.aircraft) return {};
      const now = Date.now();
      const same = event.aircraft.id === context.aircraft?.id;
      return {
        aircraft: event.aircraft, now,
        past: event.track,
        future: projectAhead(event.aircraft, now),
        // ni le curseur ni la liaison ne suivent d'un appareil à l'autre
        offset: same ? context.offset : 0,
        route: same ? context.route : null,
      };
    }),
    scrub: assign({
      offset: ({ context, event }) => {
        if (event.type !== 'trajectory.scrubbed') return context.offset;
        const earliest = context.past[0] ? Math.round((context.past[0].at - context.now) / 1000) : 0;
        return Math.max(Math.min(0, earliest), Math.min(context.future.length > 0 ? AHEAD_SECONDS : 0, event.offset));
      },
    }),
    /** Une liaison que la position de l'appareil dément n'est pas retenue. */
    keepRoute: assign({
      route: ({ context, event }) => {
        const route = (event as unknown as { output: FlightRoute | null }).output;
        const aircraft = context.aircraft;
        return route && aircraft && isPlausibleRoute(route, toWgs84(aircraft.x, aircraft.y)) ? route : null;
      },
    }),
    forget: assign({ aircraft: null, past: [], future: [], offset: 0, route: null }),
    announce: sendParent(({ context }): TrajectoryEmitted =>
      ({ type: 'trajectory.changed', past: thin(context.past), future: context.future, cursor: cursorOf(context) })),
  },
}).createMachine({
  id: 'trajectory',
  context: { aircraft: null, past: [], future: [], route: null, offset: 0, now: 0 },
  initial: 'idle',
  states: {
    idle: {
      on: { 'trajectory.aircraftChanged': { guard: 'hasAircraft', target: 'tracking', actions: ['keepAircraft', 'announce'] } },
    },
    tracking: {
      exit: ['forget', 'announce'],
      on: {
        'trajectory.aircraftChanged': [
          // un autre appareil : sa liaison est à chercher
          { guard: 'otherAircraft', target: '.routing', reenter: true, actions: ['keepAircraft', 'announce'] },
          // un relevé de plus : la trajectoire est redessinée
          { guard: 'hasAircraft', actions: ['keepAircraft', 'announce'] },
          { target: 'idle' },
        ],
        'trajectory.scrubbed': { actions: ['scrub', 'announce'] },
      },
      initial: 'routing',
      states: {
        routing: {
          invoke: {
            id: 'trajectory.route',
            src: 'loadRoute',
            input: ({ context }) => routeCallsign(context.aircraft?.callsign ?? null),
            onDone: { target: 'routed', actions: 'keepRoute' },
            // liaison inconnue ou réseau muet : le panneau s'en passe
            onError: 'routed',
          },
        },
        routed: {},
      },
    },
  },
});

/* ------------------------------------------------------------- lecture --- */

type TrajectorySnapshot = SnapshotFrom<typeof trajectoryMachine>;

/** Liaison de l'appareil suivi, quand son indicatif en désigne une. */
export const trajectoryRoute = (snapshot: TrajectorySnapshot): FlightRoute | null => snapshot.context.route;

/** Étendue du curseur, en secondes autour de maintenant, et point désigné. */
export function trajectoryCursor(snapshot: TrajectorySnapshot) {
  const { past, future, now, offset } = snapshot.context;
  return {
    earliest: past[0] ? Math.min(0, Math.round((past[0].at - now) / 1000)) : 0,
    latest: future.length > 0 ? AHEAD_SECONDS : 0,
    offset,
    point: cursorOf(snapshot.context),
  };
}
