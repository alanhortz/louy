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
 *   idle ──▶ fetching ──▶ presenting    (film déjà tourné : ses images viennent du CDN)
 *            fetching ──▶ preparing     (film introuvable : on le tourne sur place)
 *
 * Elle ne connaît ni la carte ni le moteur : elle demande un millésime, attend
 * qu'on lui dise que la vue est chargée, demande une photo, et la reçoit.
 */

import { assign, fromPromise, sendParent, setup, type SnapshotFrom } from 'xstate';
import { TIMELINE_STEP_MS, type FilmFraming, type TimelineStep } from '../domain/timeline.ts';
import { loadPreparedFilm, type LoadedFilm } from '../services/films.ts';

export type TimelineEvent =
  /** `prepared` : dossier d'un film déjà tourné pour cette vue, à préférer à la préparation sur place. */
  | { type: 'timeline.opened'; steps: TimelineStep[]; prepared?: string; framing?: FilmFraming }
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
  /** Film déjà tourné en cours de téléchargement, le cas échéant. */
  prepared: { base: string; framing: FilmFraming } | null;
  /**
   * La carte charge-t-elle en ce moment ? Tenu à jour en permanence : un film
   * demandé pendant un chargement ne verra jamais ce chargement « commencer ».
   */
  mapLoading: boolean;
}

/** Si la carte ne signale aucun chargement dans ce délai, ses tuiles étaient déjà là. */
const LOAD_START_MS = 900;
/** Délai au-delà duquel on photographie ce qui est arrivé, plutôt que d'attendre indéfiniment. */
const LOAD_TIMEOUT_MS = 30_000;
/** Répit après la dernière tuile : le temps que l'image se stabilise. */
const SETTLE_MS = 600;

const clampIndex = (index: number, frames: readonly unknown[]) => Math.max(0, Math.min(frames.length - 1, index));

export const timelineMachine = setup({
  types: {
    context: {} as TimelineContext,
    events: {} as TimelineEvent,
  },
  actors: {
    loadPrepared: fromPromise<LoadedFilm, { base: string; framing: FilmFraming }>(({ input, signal }) =>
      loadPreparedFilm(input.base, input.framing, signal)),
  },
  delays: { LOAD_START: LOAD_START_MS, LOAD_TIMEOUT: LOAD_TIMEOUT_MS, SETTLE: SETTLE_MS, ADVANCE: TIMELINE_STEP_MS },
  guards: {
    hasSteps: ({ event }) => event.type === 'timeline.opened' && event.steps.length > 0,
    hasPrepared: ({ event }) => event.type === 'timeline.opened' && event.steps.length > 0 && event.prepared !== undefined,
    loadedFrames: ({ event }) => (event as unknown as { output: LoadedFilm }).output.frames.length > 0,
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
      prepared: event.type === 'timeline.opened' && event.prepared
        ? { base: event.prepared, framing: event.framing ?? 'paysage' } : null,
    })),
    /** Le film tourné est arrivé : ses images sont déjà dans le navigateur. */
    keepPrepared: assign(({ event }) => {
      const { frames, skipped } = (event as unknown as { output: LoadedFilm }).output;
      return { frames, skipped, index: 0 };
    }),
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
      return { steps: [], cursor: 0, frames: [], skipped: [], index: 0, prepared: null };
    }),
  },
}).createMachine({
  id: 'timeline',
  context: { steps: [], cursor: 0, frames: [], skipped: [], index: 0, mapLoading: false, prepared: null },
  initial: 'idle',
  // hors préparation, l'état de la carte est seulement retenu
  on: { 'timeline.activityChanged': { actions: 'noteActivity' } },
  states: {
    idle: {
      on: {
        'timeline.opened': [
          { guard: 'hasPrepared', target: 'fetching', actions: 'begin' },
          { guard: 'hasSteps', target: 'preparing', actions: 'begin' },
        ],
      },
    },

    /** Un film déjà tourné existe pour cette vue : on télécharge ses images, sans toucher à la carte. */
    fetching: {
      invoke: {
        id: 'timeline.prepared',
        src: 'loadPrepared',
        input: ({ context }) => context.prepared!,
        onDone: [
          { guard: 'loadedFrames', target: 'presenting', actions: 'keepPrepared' },
          // index vide ou images absentes : on tourne le film sur place, comme pour n'importe quelle vue
          { target: 'preparing' },
        ],
        onError: 'preparing',
      },
      on: { 'timeline.closed': { target: 'idle', actions: 'release' } },
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

export type TimelinePhase = 'idle' | 'fetching' | 'preparing' | 'playing' | 'paused' | 'empty';

export function timelinePhase(snapshot: TimelineSnapshot): TimelinePhase {
  if (snapshot.matches('fetching')) return 'fetching';
  if (snapshot.matches('preparing')) return 'preparing';
  if (snapshot.matches({ presenting: 'playing' })) return 'playing';
  if (snapshot.matches({ presenting: 'paused' })) return 'paused';
  if (snapshot.matches('empty')) return 'empty';
  return 'idle';
}

/** Avancement de la préparation, de 0 à 1. */
export const timelineProgress = (snapshot: TimelineSnapshot): number =>
  (snapshot.context.steps.length === 0 ? 0 : snapshot.context.cursor / snapshot.context.steps.length);
