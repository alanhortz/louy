/**
 * Machine du viewer : cycle de vie du moteur de rendu.
 *
 * Le moteur n'existe que tant qu'un canvas est monté. La machine mémorise tout
 * ce qu'on lui demande d'afficher (scène, calques, pose) : un moteur qui
 * (re)démarre retrouve ainsi exactement l'état voulu, que les commandes soient
 * arrivées avant ou après lui.
 */

import { assign, sendParent, sendTo, setup, type SnapshotFrom } from 'xstate';
import type { QualityProfile } from '../domain/quality.ts';
import type { SceneSource } from '../domain/scene.ts';
import type { Pose } from '../domain/view.ts';
import {
  engineActor, type EngineCommand, type EngineInput, type EngineReport, type OverlayName,
  type ViewerMount,
} from './actors/engine.actor.ts';

export type ViewerEvent =
  | EngineCommand
  | EngineReport
  | { type: 'viewer.canvasAttached'; mount: ViewerMount }
  | { type: 'viewer.canvasDetached' };

export type ViewerEmitted =
  | { type: 'viewer.viewSettled'; pose: Pose }
  | { type: 'viewer.poseCaptured'; pose: Pose }
  | { type: 'viewer.activityChanged'; loading: boolean; points: number }
  | { type: 'viewer.overlayPicked'; layer: OverlayName; id: string }
  | { type: 'viewer.captured'; blob: Blob | null; blank: boolean };

interface ViewerContext extends Omit<EngineInput, 'mount'> {
  mount: ViewerMount | null;
  loading: boolean;
  points: number;
  failure: string | null;
}

export interface ViewerInput {
  quality: QualityProfile;
  source: SceneSource;
  pose: Pose;
  /** Ouvrir la vue de départ à la précision maximale du relief. */
  sharpStart: boolean;
  /** Ouvrir par un tour complet autour du lieu visé. */
  orbitStart: boolean;
}

/** Ce que chaque commande laisse en mémoire, pour un moteur démarré plus tard. */
function remembered(context: ViewerContext, event: ViewerEvent): Partial<ViewerContext> {
  switch (event.type) {
    case 'viewer.sceneChanged': return { source: event.source };
    case 'viewer.poseApplied': return { pose: event.pose };
    case 'viewer.overlayChanged':
      return { overlays: { ...context.overlays, [event.layer]: event.features } };
    case 'viewer.overlayActivated':
      return { active: { ...context.active, [event.layer]: event.id } };
    case 'viewer.scansChanged': return { scans: event.scans };
    default: return {};
  }
}

const COMMANDS = [
  'viewer.sceneChanged', 'viewer.overlayChanged', 'viewer.overlayActivated', 'viewer.scansChanged',
  'viewer.poseApplied',
] as const;

const viewer = setup({
  types: {
    context: {} as ViewerContext,
    events: {} as ViewerEvent,
    input: {} as ViewerInput,
  },
  actors: { engine: engineActor },
  actions: {
    remember: assign(({ context, event }) => remembered(context, event)),
    command: sendTo('engine', ({ event }) => event as EngineCommand),
  },
});

/** Hors moteur, une commande est seulement mémorisée ; moteur présent, elle lui est aussi transmise. */
const handlers = <A extends readonly string[]>(actions: A) =>
  Object.fromEntries(COMMANDS.map((type) => [type, { actions }])) as Record<(typeof COMMANDS)[number], { actions: A }>;

export const viewerMachine = viewer.createMachine({
  id: 'viewer',
  context: ({ input }) => ({
    ...input,
    mount: null,
    overlays: { places: [], cameras: [], scans: [] },
    active: { places: null, cameras: null, scans: null },
    scans: [],
    loading: true,
    points: 0,
    failure: null,
  }),
  initial: 'detached',
  on: handlers(['remember'] as const),
  states: {
    /** Aucun canvas : rien à rendre. */
    detached: {
      on: {
        'viewer.canvasAttached': {
          target: 'attached',
          actions: assign({ mount: ({ event }) => event.mount, failure: null }),
        },
      },
    },
    attached: {
      invoke: {
        id: 'engine',
        src: 'engine',
        input: ({ context }) => ({ ...context, mount: context.mount! }),
      },
      initial: 'starting',
      on: {
        ...handlers(['remember', 'command'] as const),
        'viewer.poseCaptureRequested': { actions: 'command' },
        'viewer.captureRequested': { actions: 'command' },
        'engine.captured': {
          actions: sendParent(({ event }): ViewerEmitted =>
            ({ type: 'viewer.captured', blob: event.blob, blank: event.blank })),
        },
        'viewer.canvasDetached': { target: 'detached', actions: assign({ mount: null }) },
        'engine.failed': {
          target: 'failed',
          actions: assign({ failure: ({ event }) => event.reason }),
        },
        'engine.viewSettled': {
          actions: [
            // la vue de départ est posée : un moteur redémarré reprendra cette pose telle quelle
            assign({ pose: ({ event }) => event.pose, sharpStart: false, orbitStart: false }),
            sendParent(({ event }): ViewerEmitted => ({ type: 'viewer.viewSettled', pose: event.pose })),
          ],
        },
        'engine.poseCaptured': {
          actions: [
            assign({ pose: ({ event }) => event.pose }),
            sendParent(({ event }): ViewerEmitted => ({ type: 'viewer.poseCaptured', pose: event.pose })),
          ],
        },
        'engine.activityChanged': {
          actions: [
            assign({ loading: ({ event }) => event.loading, points: ({ event }) => event.points }),
            sendParent(({ event }): ViewerEmitted =>
              ({ type: 'viewer.activityChanged', loading: event.loading, points: event.points })),
          ],
        },
        'engine.overlayPicked': {
          actions: sendParent(({ event }): ViewerEmitted =>
            ({ type: 'viewer.overlayPicked', layer: event.layer, id: event.id })),
        },
        'engine.contextLost': '.suspended',
      },
      states: {
        /** Le moteur tourne, les premières tuiles ne sont pas encore arrivées. */
        starting: {
          on: {
            'engine.ready': [
              { guard: ({ context }) => context.orbitStart, target: 'live.orbiting' },
              { target: 'live' },
            ],
            // le visiteur a pris la main avant même l'arrivée des premières tuiles
            'engine.orbitEnded': { actions: assign({ orbitStart: false }) },
            'viewer.flyoverRequested': { target: 'live.orbiting', actions: 'command' },
          },
        },
        live: {
          initial: 'free',
          states: {
            free: {},
            /** La caméra tourne seule autour d'un lieu, jusqu'au premier geste. */
            orbiting: {
              on: {
                'engine.orbitEnded': 'free',
                'viewer.orbitStopped': { target: 'free', actions: 'command' },
                'viewer.poseApplied': { target: 'free', actions: ['remember', 'command'] },
              },
            },
          },
          on: {
            'viewer.flyoverRequested': [
              { guard: ({ event }) => event.flyover.orbit, target: '.orbiting', actions: 'command' },
              { target: '.free', actions: 'command' },
            ],
          },
        },
        /** Le système a repris le contexte graphique (fréquent sur mobile en arrière-plan). */
        suspended: {
          on: { 'engine.contextRestored': 'live' },
        },
      },
    },
    /** WebGL n'a pas pu démarrer sur cet appareil. */
    failed: {
      on: {
        'viewer.canvasDetached': { target: 'detached', actions: assign({ mount: null }) },
      },
    },
  },
});

export const isOrbiting = (snapshot: SnapshotFrom<typeof viewerMachine>): boolean =>
  snapshot.matches({ attached: { live: 'orbiting' } });
