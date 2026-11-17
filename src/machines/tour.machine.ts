/**
 * Machine de la vue caméra d'un drone — son « cockpit » : le visiteur
 * refait le trajet du drone, à sa vitesse et dans son regard, comme un jumeau numérique
 * de la prise de vue. Il ne tient pas la vue : il peut seulement la mettre en pause, la
 * reprendre, ou la quitter. À la fin du trajet la visite se quitte d'elle-même, et la carte
 * revient là où elle était.
 *
 *   idle ──▶ touring (playing ⇄ paused) ──▶ idle
 */

import { assign, sendParent, setup, type SnapshotFrom } from 'xstate';
import type { DroneFlight } from '../domain/droneFlights.ts';

export type TourEvent =
  | { type: 'tour.requested'; flight: DroneFlight }
  | { type: 'tour.toggled' }
  | { type: 'tour.left' }
  /** Reprendre la visite depuis le début, dans le regard du drone. */
  | { type: 'tour.replayed' }
  /** Le visiteur a pris la main — tourné la tête, avancé ou reculé : la visite se met en pause. */
  | { type: 'tour.held' }
  /** Le moteur est arrivé au bout du trajet. */
  | { type: 'tour.finished' };

export type TourEmitted =
  | { type: 'tour.started'; flight: DroneFlight }
  | { type: 'tour.playChanged'; playing: boolean }
  | { type: 'tour.ended' }
  | { type: 'tour.restarted' };

export const tourMachine = setup({
  types: {
    context: {} as { flight: DroneFlight | null },
    events: {} as TourEvent,
  },
  actions: {
    announceStart: sendParent(({ context }): TourEmitted => ({ type: 'tour.started', flight: context.flight! })),
    announcePlaying: sendParent((): TourEmitted => ({ type: 'tour.playChanged', playing: true })),
    announcePaused: sendParent((): TourEmitted => ({ type: 'tour.playChanged', playing: false })),
    announceRestart: sendParent((): TourEmitted => ({ type: 'tour.restarted' })),
    announceEnd: sendParent((): TourEmitted => ({ type: 'tour.ended' })),
  },
}).createMachine({
  id: 'tour',
  context: { flight: null },
  initial: 'idle',
  states: {
    idle: {
      on: { 'tour.requested': { target: 'touring', actions: assign({ flight: ({ event }) => event.flight }) } },
    },
    touring: {
      entry: 'announceStart',
      exit: ['announceEnd', assign({ flight: null })],
      initial: 'playing',
      on: {
        'tour.left': 'idle',
        'tour.finished': 'idle',
        // rejouer est toujours possible, en lecture comme en pause : on repart du début, en lecture
        'tour.replayed': { target: '.playing', actions: 'announceRestart' },
      },
      states: {
        playing: {
          on: {
            'tour.toggled': { target: 'paused', actions: 'announcePaused' },
            'tour.held': { target: 'paused', actions: 'announcePaused' },
          },
        },
        paused: { on: { 'tour.toggled': { target: 'playing', actions: 'announcePlaying' } } },
      },
    },
  },
});

type TourSnapshot = SnapshotFrom<typeof tourMachine>;
export const tourPhase = (snapshot: TourSnapshot): 'idle' | 'playing' | 'paused' =>
  (snapshot.matches({ touring: 'playing' }) ? 'playing' : snapshot.matches({ touring: 'paused' }) ? 'paused' : 'idle');
