/**
 * Machine des caméras routières.
 *
 * Trois niveaux emboîtés : le calque (masqué / visible), la liste (chargement),
 * puis la caméra regardée, dont l'image fixe est redemandée périodiquement —
 * il n'existe pas de flux vidéo. Une image qui échoue au rafraîchissement
 * laisse la précédente à l'écran.
 */

import { assign, fromPromise, sendParent, setup, type SnapshotFrom } from 'xstate';
import type { CameraFeature } from '../engine/overlays/cameraMarkers.ts';
import {
  FRAME_REFRESH_MS, frameUrl, loadCameras, loadFrame, nearestCamera, thumbnailUrl,
  type RoadCamera,
} from '../services/cameras.ts';
import type { LayerFeed } from './places.machine.ts';

export type CamerasEvent =
  | { type: 'cameras.toggled' }
  | { type: 'cameras.picked'; id: string }
  | { type: 'cameras.stepped'; delta: 1 | -1 }
  | { type: 'cameras.nearestRequested' }
  | { type: 'cameras.focusRequested' }
  | { type: 'cameras.dismissed' }
  | { type: 'cameras.viewChanged'; x: number; y: number };

export type CamerasEmitted =
  | { type: 'cameras.changed'; visible: boolean; features: CameraFeature[] }
  | { type: 'cameras.selectionChanged'; camera: RoadCamera | null }
  | { type: 'cameras.flyRequested'; x: number; y: number };

export interface CameraFrame {
  url: string;
  loadedAt: number;
}

interface CamerasContext {
  startsVisible: boolean;
  cameras: RoadCamera[];
  selectedId: string | null;
  frame: CameraFrame | null;
  /** Point visé par la vue, pour « la plus proche ». */
  focus: { x: number; y: number };
  loadedAt: number | null;
}

const RETRY_MS = 30_000;
/** Éloignement au-delà duquel un marqueur de caméra n'est plus dessiné. */
const MARKER_RANGE = 90_000;

const selected = (context: CamerasContext): RoadCamera | null =>
  context.cameras.find((camera) => camera.id === context.selectedId) ?? null;

const toFeature = (camera: RoadCamera): CameraFeature => ({
  id: camera.id,
  x: camera.x,
  y: camera.y,
  label: camera.label,
  rank: 1,
  maxDistance: MARKER_RANGE,
  thumbnail: thumbnailUrl(camera.id),
});

/** Caméra voisine dans la liste, en bouclant aux extrémités. */
function neighbour(context: CamerasContext, delta: number): string | null {
  const { cameras } = context;
  if (cameras.length === 0) return null;
  const at = cameras.findIndex((camera) => camera.id === context.selectedId);
  return cameras[(Math.max(at, 0) + delta + cameras.length) % cameras.length]!.id;
}

export const camerasMachine = setup({
  types: {
    context: {} as CamerasContext,
    events: {} as CamerasEvent,
    input: {} as { visible: boolean; selectedId: string | null; focus: { x: number; y: number } },
  },
  actors: {
    loadList: fromPromise<RoadCamera[]>(({ signal }) => loadCameras(signal)),
    loadFrame: fromPromise<string, string>(({ input, signal }) => loadFrame(frameUrl(input), signal)),
  },
  guards: {
    startsVisible: ({ context }) => context.startsVisible,
    hasList: ({ context }) => context.cameras.length > 0,
    hasSelection: ({ context }) => selected(context) !== null,
    picksAnother: ({ context, event }) => event.type === 'cameras.picked' && event.id !== context.selectedId,
  },
  actions: {
    trackFocus: assign({
      focus: ({ context, event }) =>
        (event.type === 'cameras.viewChanged' ? { x: event.x, y: event.y } : context.focus),
    }),
    selectPicked: assign({
      selectedId: ({ context, event }) => (event.type === 'cameras.picked' ? event.id : context.selectedId),
      frame: null,
    }),
    selectNeighbour: assign({
      selectedId: ({ context, event }) =>
        neighbour(context, event.type === 'cameras.stepped' ? event.delta : 1),
      frame: null,
    }),
    selectNearest: assign({
      selectedId: ({ context }) =>
        nearestCamera(context.cameras, context.focus.x, context.focus.y)?.id ?? null,
      frame: null,
    }),
    deselect: assign({ selectedId: null, frame: null }),
    publish: sendParent(({ context }): CamerasEmitted =>
      ({ type: 'cameras.changed', visible: true, features: context.cameras.map(toFeature) })),
    withdraw: sendParent((): CamerasEmitted => ({ type: 'cameras.changed', visible: false, features: [] })),
    announceSelection: sendParent(({ context }): CamerasEmitted =>
      ({ type: 'cameras.selectionChanged', camera: selected(context) })),
    requestFly: sendParent(({ context }): CamerasEmitted => {
      const camera = selected(context)!;
      return { type: 'cameras.flyRequested', x: camera.x, y: camera.y };
    }),
  },
}).createMachine({
  id: 'cameras',
  context: ({ input }) => ({
    startsVisible: input.visible,
    cameras: [],
    selectedId: input.selectedId,
    frame: null,
    focus: input.focus,
    loadedAt: null,
  }),
  initial: 'resolving',
  on: {
    'cameras.viewChanged': { actions: 'trackFocus' },
  },
  states: {
    resolving: {
      always: [{ guard: 'startsVisible', target: 'visible' }, { target: 'hidden' }],
    },
    hidden: {
      on: { 'cameras.toggled': 'visible' },
    },
    visible: {
      initial: 'pending',
      exit: ['deselect', 'announceSelection', 'withdraw'],
      on: { 'cameras.toggled': 'hidden' },
      states: {
        pending: {
          always: [{ guard: 'hasList', target: 'listed' }, { target: 'loading' }],
        },
        loading: {
          invoke: {
            id: 'cameras.list',
            src: 'loadList',
            onDone: {
              target: 'listed',
              actions: assign({ cameras: ({ event }) => event.output, loadedAt: () => Date.now() }),
            },
            onError: 'failed',
          },
        },
        failed: {
          after: { [RETRY_MS]: 'loading' },
        },
        listed: {
          entry: 'publish',
          initial: 'routing',
          on: {
            'cameras.picked': [
              { guard: 'picksAnother', target: '.watching', reenter: true, actions: 'selectPicked' },
              // La caméra déjà active est touchée de nouveau : rien ne change, mais le
              // visiteur la redemande. On la ré-annonce, ce qui rouvre son panneau s'il
              // avait été refermé — sans cela, le marqueur actif ne répondait plus.
              { guard: 'hasSelection', actions: 'announceSelection' },
            ],
            'cameras.stepped': { guard: 'hasList', target: '.watching', reenter: true, actions: ['selectNeighbour', 'requestFly'] },
            'cameras.nearestRequested': { guard: 'hasList', target: '.watching', reenter: true, actions: ['selectNearest', 'requestFly'] },
          },
          states: {
            routing: {
              always: [{ guard: 'hasSelection', target: 'watching' }, { target: 'standby' }],
            },
            /** Aucune caméra regardée. */
            standby: {},
            watching: {
              entry: 'announceSelection',
              initial: 'acquiring',
              on: {
                'cameras.dismissed': { target: 'standby', actions: ['deselect', 'announceSelection'] },
                'cameras.focusRequested': { actions: 'requestFly' },
              },
              states: {
                /** Première image d'une caméra : rien à montrer en attendant. */
                acquiring: {
                  invoke: {
                    id: 'cameras.frame',
                    src: 'loadFrame',
                    input: ({ context }) => context.selectedId!,
                    onDone: { target: 'live', actions: assign({ frame: ({ event }) => ({ url: event.output, loadedAt: Date.now() }) }) },
                    onError: 'unavailable',
                  },
                },
                live: {
                  after: { [FRAME_REFRESH_MS]: 'refreshing' },
                },
                /** L'image précédente reste affichée pendant le rechargement. */
                refreshing: {
                  invoke: {
                    id: 'cameras.refresh',
                    src: 'loadFrame',
                    input: ({ context }) => context.selectedId!,
                    onDone: { target: 'live', actions: assign({ frame: ({ event }) => ({ url: event.output, loadedAt: Date.now() }) }) },
                    onError: 'live',
                  },
                },
                unavailable: {
                  after: { [RETRY_MS]: 'acquiring' },
                },
              },
            },
          },
        },
      },
    },
  },
});

/* ------------------------------------------------------------- lecture --- */

export type CamerasSnapshot = SnapshotFrom<typeof camerasMachine>;

export type FrameState = 'idle' | 'loading' | 'ready' | 'error';

export const selectedCamera = (snapshot: CamerasSnapshot): RoadCamera | null => selected(snapshot.context);

type WatchingLeaf = 'acquiring' | 'live' | 'refreshing' | 'unavailable';

export function frameState(snapshot: CamerasSnapshot): FrameState {
  const at = (leaf: WatchingLeaf) => snapshot.matches({ visible: { listed: { watching: leaf } } });
  if (at('acquiring')) return 'loading';
  if (at('unavailable')) return 'error';
  if (at('live') || at('refreshing')) return 'ready';
  return 'idle';
}

export function camerasFeed(snapshot: CamerasSnapshot): LayerFeed {
  if (!snapshot.matches('visible')) return 'off';
  if (snapshot.matches({ visible: 'failed' })) return 'unavailable';
  if (snapshot.matches({ visible: 'listed' })) return 'nominal';
  return 'loading';
}
