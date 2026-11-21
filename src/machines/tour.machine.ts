/**
 * Machine de la vue caméra d'un drone — son « cockpit » : le visiteur
 * refait le trajet du drone, à sa vitesse et dans son regard, comme un jumeau numérique
 * de la prise de vue. Il ne tient pas la vue : il peut seulement la mettre en pause, la
 * reprendre, ou la quitter. À la fin du trajet la visite se quitte d'elle-même, et la carte
 * revient là où elle était.
 *
 * Deux régions indépendantes, qui vivent en parallèle :
 *
 *   visite : idle ──▶ touring (playing ⇄ paused) ──▶ idle
 *   champ  : shown ⇄ hidden        le cône que filme la caméra, dessiné sur la carte
 *
 * Le champ est un état, pas un drapeau : il est montré d'office, et le rester ou non ne dépend pas
 * de la visite en cours.
 */

import { assign, sendParent, setup, type SnapshotFrom } from 'xstate';
import type { DroneFlight } from '../domain/droneFlights.ts';

export type TourEvent =
  | { type: 'tour.requested'; flight: DroneFlight }
  | { type: 'tour.toggled' }
  | { type: 'tour.left' }
  /** Montrer ou cacher, sur la carte, le champ que filme la caméra du drone. */
  | { type: 'tour.sightToggled' }
  /** Reprendre la visite depuis le début, dans le regard du drone. */
  | { type: 'tour.replayed' }
  /** Le visiteur a pris la main — tourné la tête, avancé ou reculé : la visite se met en pause. */
  | { type: 'tour.held' }
  /** Le moteur est arrivé au bout du trajet. */
  | { type: 'tour.finished' }
  /** Où en est la visite, en secondes depuis le départ du drone : la vidéo de son vol s'y cale. */
  | { type: 'tour.progressed'; t: number };

export type TourEmitted =
  | { type: 'tour.started'; flight: DroneFlight }
  | { type: 'tour.playChanged'; playing: boolean }
  | { type: 'tour.ended' }
  | { type: 'tour.restarted' }
  | { type: 'tour.sightChanged'; visible: boolean };

export const tourMachine = setup({
  types: {
    context: {} as { flight: DroneFlight | null; t: number },
    events: {} as TourEvent,
  },
  actions: {
    announceStart: sendParent(({ context }): TourEmitted => ({ type: 'tour.started', flight: context.flight! })),
    announcePlaying: sendParent((): TourEmitted => ({ type: 'tour.playChanged', playing: true })),
    announcePaused: sendParent((): TourEmitted => ({ type: 'tour.playChanged', playing: false })),
    announceRestart: sendParent((): TourEmitted => ({ type: 'tour.restarted' })),
    announceEnd: sendParent((): TourEmitted => ({ type: 'tour.ended' })),
    announceSightShown: sendParent((): TourEmitted => ({ type: 'tour.sightChanged', visible: true })),
    announceSightHidden: sendParent((): TourEmitted => ({ type: 'tour.sightChanged', visible: false })),
  },
}).createMachine({
  id: 'tour',
  context: { flight: null, t: 0 },
  type: 'parallel',
  states: {
    visit: {
      initial: 'idle',
      states: {
        idle: {
          on: { 'tour.requested': { target: 'touring', actions: assign({ flight: ({ event }) => event.flight, t: 0 }) } },
        },
        touring: {
          entry: 'announceStart',
          exit: ['announceEnd', assign({ flight: null, t: 0 })],
          initial: 'playing',
          on: {
            'tour.left': 'idle',
            'tour.finished': 'idle',
            // rejouer est toujours possible, en lecture comme en pause : on repart du début, en lecture
            'tour.replayed': { target: '.playing', actions: ['announceRestart', assign({ t: 0 })] },
            'tour.progressed': { actions: assign({ t: ({ event }) => event.t }) },
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
    },
    // le champ de la caméra, sur la carte : montré d'office, il dit ce que le drone filme
    sight: {
      initial: 'shown',
      states: {
        shown: { on: { 'tour.sightToggled': { target: 'hidden', actions: 'announceSightHidden' } } },
        hidden: { on: { 'tour.sightToggled': { target: 'shown', actions: 'announceSightShown' } } },
      },
    },
  },
});

type TourSnapshot = SnapshotFrom<typeof tourMachine>;
/** Le champ de la caméra du drone est-il montré sur la carte ? */
export const tourSight = (snapshot: TourSnapshot): boolean => snapshot.matches({ sight: 'shown' });
/** L'instant de la visite, en secondes depuis le départ du drone. */
export const tourTime = (snapshot: TourSnapshot): number => snapshot.context.t;
export const tourPhase = (snapshot: TourSnapshot): 'idle' | 'playing' | 'paused' =>
  (snapshot.matches({ visit: { touring: 'playing' } }) ? 'playing' : snapshot.matches({ visit: { touring: 'paused' } }) ? 'paused' : 'idle');
