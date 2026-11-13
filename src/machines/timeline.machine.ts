/**
 * Machine du film du temps : prépare une présentation plein écran de la vue
 * courante, millésime par millésime, puis la joue en fondu enchaîné.
 *
 * La préparation vient d'abord, et entièrement : pour chaque millésime, la carte
 * est chargée jusqu'au bout puis photographiée. Le film ne montre donc jamais un
 * chargement — seulement des images finies, entre lesquelles on passe à volonté.
 *
 *   idle ──▶ preparing ─┬─ requesting ──▶ awaitingLoad ──▶ loading ──▶ settling ──▶ capturing ─┐
 *                       └──────────────────────── (millésime suivant) ◀──────────────────────────┘
 *            preparing ──▶ presenting ─┬─ playing ⇄ paused
 *                                      └─ (frise, clavier : image précédente, suivante, choisie)
 *            preparing ──▶ empty        (aucune photo exploitable ici)
 *
 * Elle ne connaît ni la carte ni le moteur : elle demande un millésime, attend
 * qu'on lui dise que la vue est chargée, demande une photo, et la reçoit.
 */

import { assign, sendParent, setup, type SnapshotFrom } from 'xstate';
import { TIMELINE_STEP_MS, type TimelineStep } from '../domain/timeline.ts';

export type TimelineEvent =
  | { type: 'timeline.opened'; steps: TimelineStep[] }
  | { type: 'timeline.closed'; by: 'button' | 'escape' | 'fullscreen' }
  | { type: 'timeline.activityChanged'; loading: boolean }
  | { type: 'timeline.frameCaptured'; url: string | null; blank: boolean }
  | { type: 'timeline.playToggled' }
  | { type: 'timeline.stepped'; delta: 1 | -1; by: 'button' | 'keyboard' }
  | { type: 'timeline.seeked'; index: number; by: 'frise' | 'keyboard' };

export type TimelineEmitted =
  | { type: 'timeline.vintageRequested'; vintage: string }
  | { type: 'timeline.captureRequested' }
  | { type: 'timeline.restoreRequested' };

/** Une image du film : un millésime, photographié. */
export interface TimelineFrame extends TimelineStep { url: string }

interface TimelineContext {
  steps: TimelineStep[];
  /** Rang, dans `steps`, du millésime en cours de préparation. */
  cursor: number;
  frames: TimelineFrame[];
  /** Millésimes écartés : la photo aérienne ne couvre pas cet endroit. */
  skipped: TimelineStep[];
  /** Rang, dans `frames`, de l'image à l'écran. */
  index: number;
  /**
   * La carte charge-t-elle en ce moment ? Tenu à jour en permanence : un film
   * demandé pendant un chargement ne verra jamais ce chargement « commencer ».
   */
  mapLoading: boolean;
}

/** Si la carte ne signale aucun chargement dans ce délai, ses tuiles étaient déjà là. */
const LOAD_START_MS = 1600;
/** Délai au-delà duquel on photographie ce qui est arrivé, plutôt que d'attendre indéfiniment. */
const LOAD_TIMEOUT_MS = 30_000;
/** Répit après la dernière tuile : le temps que l'image se stabilise. */
const SETTLE_MS = 900;

const clampIndex = (index: number, frames: readonly unknown[]) => Math.max(0, Math.min(frames.length - 1, index));

export const timelineMachine = setup({
  types: {
    context: {} as TimelineContext,
    events: {} as TimelineEvent,
  },
  delays: { LOAD_START: LOAD_START_MS, LOAD_TIMEOUT: LOAD_TIMEOUT_MS, SETTLE: SETTLE_MS, ADVANCE: TIMELINE_STEP_MS },
  guards: {
    hasSteps: ({ event }) => event.type === 'timeline.opened' && event.steps.length > 0,
    isLoading: ({ event }) => event.type === 'timeline.activityChanged' && event.loading,
    isLoaded: ({ event }) => event.type === 'timeline.activityChanged' && !event.loading,
    mapIsLoading: ({ context }) => context.mapLoading,
    hasMoreSteps: ({ context }) => context.cursor < context.steps.length - 1,
    /** Après cette photo, le film aura-t-il au moins une image ? */
    willHaveFrames: ({ context, event }) =>
      context.frames.length > 0 || (event.type === 'timeline.frameCaptured' && event.url !== null && !event.blank),
    isAtEnd: ({ context }) => context.index >= context.frames.length - 1,
  },
  actions: {
    noteActivity: assign({
      mapLoading: ({ context, event }) => (event.type === 'timeline.activityChanged' ? event.loading : context.mapLoading),
    }),
    begin: assign(({ event }) => ({
      steps: event.type === 'timeline.opened' ? event.steps : [],
      cursor: 0, frames: [], skipped: [], index: 0,
    })),
    requestVintage: sendParent(({ context }): TimelineEmitted =>
      ({ type: 'timeline.vintageRequested', vintage: context.steps[context.cursor]!.vintage })),
    requestCapture: sendParent((): TimelineEmitted => ({ type: 'timeline.captureRequested' })),
    requestRestore: sendParent((): TimelineEmitted => ({ type: 'timeline.restoreRequested' })),
    /** Range la photo reçue : dans le film si elle montre quelque chose, parmi les écartées sinon. */
    keepFrame: assign(({ context, event }) => {
      if (event.type !== 'timeline.frameCaptured') return {};
      const step = context.steps[context.cursor]!;
      if (event.url === null || event.blank) {
        if (event.url) URL.revokeObjectURL(event.url);
        return { skipped: [...context.skipped, step] };
      }
      return { frames: [...context.frames, { ...step, url: event.url }] };
    }),
    nextStep: assign({ cursor: ({ context }) => context.cursor + 1 }),
    advance: assign({ index: ({ context }) => clampIndex(context.index + 1, context.frames) }),
    step: assign({
      index: ({ context, event }) =>
        (event.type === 'timeline.stepped' ? clampIndex(context.index + event.delta, context.frames) : context.index),
    }),
    seek: assign({
      index: ({ context, event }) =>
        (event.type === 'timeline.seeked' ? clampIndex(event.index, context.frames) : context.index),
    }),
    rewind: assign({ index: 0 }),
    /** Les photos sont des fichiers en mémoire : on les libère en quittant. */
    release: assign(({ context }) => {
      for (const frame of context.frames) URL.revokeObjectURL(frame.url);
      return { steps: [], cursor: 0, frames: [], skipped: [], index: 0 };
    }),
  },
}).createMachine({
  id: 'timeline',
  context: { steps: [], cursor: 0, frames: [], skipped: [], index: 0, mapLoading: false },
  initial: 'idle',
  // hors préparation, l'état de la carte est seulement retenu
  on: { 'timeline.activityChanged': { actions: 'noteActivity' } },
  states: {
    idle: {
      on: { 'timeline.opened': { guard: 'hasSteps', target: 'preparing', actions: 'begin' } },
    },

    preparing: {
      initial: 'requesting',
      on: {
        // abandon : la carte retrouve sa scène, les photos déjà prises sont libérées
        'timeline.closed': { target: 'idle', actions: ['requestRestore', 'release'] },
      },
      states: {
        requesting: {
          entry: 'requestVintage',
          always: 'awaitingLoad',
        },
        /** La carte va-t-elle annoncer un chargement, ou avait-elle déjà tout ? */
        awaitingLoad: {
          // elle chargeait déjà : ce chargement est le nôtre, il n'y aura pas d'annonce
          always: { guard: 'mapIsLoading', target: 'loading' },
          on: {
            'timeline.activityChanged': [
              { guard: 'isLoading', target: 'loading', actions: 'noteActivity' },
              { actions: 'noteActivity' },
            ],
          },
          after: { LOAD_START: 'settling' },
        },
        loading: {
          on: {
            'timeline.activityChanged': [
              { guard: 'isLoaded', target: 'settling', actions: 'noteActivity' },
              { actions: 'noteActivity' },
            ],
          },
          after: { LOAD_TIMEOUT: 'settling' },
        },
        settling: {
          // une tuile de plus est partie : ce n'était pas fini
          on: {
            'timeline.activityChanged': [
              { guard: 'isLoading', target: 'loading', actions: 'noteActivity' },
              { actions: 'noteActivity' },
            ],
          },
          after: { SETTLE: 'capturing' },
        },
        capturing: {
          entry: 'requestCapture',
          on: {
            'timeline.frameCaptured': [
              { guard: 'hasMoreSteps', target: 'requesting', actions: ['keepFrame', 'nextStep'] },
              { guard: 'willHaveFrames', target: '#timeline.presenting', actions: 'keepFrame' },
              { target: '#timeline.empty', actions: 'keepFrame' },
            ],
          },
        },
      },
    },

    /** Le film est prêt : la carte a retrouvé sa scène, et n'est plus sollicitée. */
    presenting: {
      entry: ['requestRestore', 'rewind'],
      initial: 'playing',
      on: {
        'timeline.closed': { target: 'idle', actions: 'release' },
        // prendre la main sur la frise met le défilement en pause : c'est le visiteur qui pilote
        'timeline.stepped': { target: '.paused', actions: 'step' },
        'timeline.seeked': { target: '.paused', actions: 'seek' },
      },
      states: {
        playing: {
          after: {
            ADVANCE: [
              { guard: 'isAtEnd', target: 'paused' },
              { target: 'playing', reenter: true, actions: 'advance' },
            ],
          },
          on: { 'timeline.playToggled': 'paused' },
        },
        paused: {
          on: {
            'timeline.playToggled': [
              // relancé en fin de film, il repart du début
              { guard: 'isAtEnd', target: 'playing', actions: 'rewind' },
              { target: 'playing' },
            ],
          },
        },
      },
    },

    /** Aucune photo aérienne exploitable pour cette vue. */
    empty: {
      entry: 'requestRestore',
      on: { 'timeline.closed': { target: 'idle', actions: 'release' } },
    },
  },
});

/* ------------------------------------------------------------- lecture --- */

type TimelineSnapshot = SnapshotFrom<typeof timelineMachine>;

export type TimelinePhase = 'idle' | 'preparing' | 'playing' | 'paused' | 'empty';

export function timelinePhase(snapshot: TimelineSnapshot): TimelinePhase {
  if (snapshot.matches('preparing')) return 'preparing';
  if (snapshot.matches({ presenting: 'playing' })) return 'playing';
  if (snapshot.matches({ presenting: 'paused' })) return 'paused';
  if (snapshot.matches('empty')) return 'empty';
  return 'idle';
}

/** Avancement de la préparation, de 0 à 1. */
export const timelineProgress = (snapshot: TimelineSnapshot): number =>
  (snapshot.context.steps.length === 0 ? 0 : snapshot.context.cursor / snapshot.context.steps.length);
