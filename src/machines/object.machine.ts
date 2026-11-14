/**
 * Machine de la visionneuse d'objet : ouvre un scan maillé, suit son
 * chargement, et tient à jour ce que le visiteur en fait.
 *
 * Tout passe par elle, y compris ce qui n'a pas besoin d'être décidé : la
 * progression du chargement, la première image, chaque geste. C'est voulu —
 * un événement reçu par une machine est un événement consigné dans le journal
 * local, sans qu'aucun code n'ait à penser à l'écrire.
 *
 *   closed ──▶ open ─┬─ mounting ──▶ viewing ─┬─ loading ──▶ ready ─┬─ still ⇄ handled
 *                    │                        │                     └─ (tour automatique : drapeau)
 *                    │                        └─ suspended
 *                    └─ failed
 */

import { assign, enqueueActions, sendTo, setup, type SnapshotFrom } from 'xstate';
import { DEFAULT_OBJECT_POSE, type ObjectGesture, type ObjectPose } from '../domain/objectView.ts';
import type { Scan } from '../domain/scans.ts';
import type { ObjectStats } from '../engine/ObjectEngine.ts';
import {
  objectEngineActor, type ObjectEngineCommand, type ObjectEngineReport,
} from './actors/objectEngine.actor.ts';

export type ObjectEvent =
  | ObjectEngineReport
  | { type: 'object.opened'; scan: Scan; group?: Scan[] }
  | { type: 'object.paged'; delta: 1 | -1; by: 'button' | 'keyboard' }
  | { type: 'object.closed'; by: 'button' | 'backdrop' | 'escape' }
  | { type: 'object.canvasAttached'; canvas: HTMLCanvasElement }
  | { type: 'object.canvasDetached' }
  | { type: 'object.resetRequested' }
  | { type: 'object.autoRotateToggled' }
  | { type: 'object.retryRequested' };

/** Annoncé au parent quand la visionneuse se referme : l'objet n'est plus regardé. */
export type ObjectEmitted = { type: 'object.left' };

interface ObjectContext {
  scan: Scan | null;
  /** Objets du même marqueur, dans l'ordre où on les feuillette ; un seul quand l'objet est isolé. */
  group: Scan[];
  canvas: HTMLCanvasElement | null;
  /** Avancement du chargement, de 0 à 1. */
  progress: number;
  stats: ObjectStats | null;
  pose: ObjectPose;
  /** Geste en cours, s'il y en a un. */
  gesture: ObjectGesture | null;
  /** L'objet tourne seul tant que le visiteur ne l'a pas pris en main. */
  autoRotate: boolean;
  failure: string | null;
}

const fresh = { canvas: null, progress: 0, stats: null, pose: DEFAULT_OBJECT_POSE, gesture: null, autoRotate: true, failure: null };

export const objectMachine = setup({
  types: {
    context: {} as ObjectContext,
    events: {} as ObjectEvent,
  },
  actors: { engine: objectEngineActor },
  guards: {
    opensObject: ({ event }) => event.type === 'object.opened' && event.scan.mesh !== undefined,
    /** La page demandée existe-t-elle ? Le feuilletage s'arrête aux deux bouts. */
    canPage: ({ context, event }) => {
      if (event.type !== 'object.paged' || !context.scan) return false;
      const next = context.group.indexOf(context.scan) + event.delta;
      return next >= 0 && next < context.group.length;
    },
  },
  actions: {
    open: assign(({ event }) => (event.type === 'object.opened'
      ? { ...fresh, scan: event.scan, group: event.group ?? [event.scan] }
      : { ...fresh, scan: null, group: [] })),
    forget: assign({ ...fresh, scan: null, group: [] }),
    /** Prévient la machine applicative ; sans parent (essais), il n'y a personne à prévenir. */
    announceLeft: enqueueActions(({ self, enqueue }) => {
      if (self._parent) enqueue.sendParent({ type: 'object.left' } satisfies ObjectEmitted);
    }),
    /** Passe à l'objet voisin du groupe : il s'ouvre comme un objet neuf. */
    page: assign(({ context, event }) => ({
      ...fresh,
      scan: event.type === 'object.paged' ? context.group[context.group.indexOf(context.scan!) + event.delta]! : context.scan,
    })),
    commandReset: sendTo('engine', { type: 'objectEngine.resetView' } satisfies ObjectEngineCommand),
    commandAutoRotate: sendTo('engine', ({ context }): ObjectEngineCommand =>
      ({ type: 'objectEngine.autoRotateSet', on: context.autoRotate })),
  },
}).createMachine({
  id: 'object',
  context: { ...fresh, scan: null, group: [] },
  initial: 'closed',
  states: {
    closed: {
      on: { 'object.opened': { guard: 'opensObject', target: 'open', actions: 'open' } },
    },

    open: {
      initial: 'mounting',
      on: {
        'object.closed': { target: 'closed', actions: ['forget', 'announceLeft'] },
        'object.paged': { guard: 'canPage', target: 'open', reenter: true, actions: 'page' },
        // un autre objet demandé pendant que celui-ci est ouvert : on repart de zéro
        'object.opened': { guard: 'opensObject', target: 'open', reenter: true, actions: 'open' },
      },
      states: {
        /** La fenêtre s'ouvre : on attend son canvas. */
        mounting: {
          on: {
            'object.canvasAttached': { target: 'viewing', actions: assign({ canvas: ({ event }) => event.canvas }) },
          },
        },

        viewing: {
          invoke: {
            id: 'engine',
            src: 'engine',
            input: ({ context }) => ({ canvas: context.canvas!, url: context.scan!.mesh!, autoRotate: context.autoRotate }),
          },
          initial: 'loading',
          on: {
            'object.canvasDetached': { target: 'mounting', actions: assign({ canvas: null }) },
            'objectEngine.failed': { target: 'failed', actions: assign({ failure: ({ event }) => event.reason }) },
          },
          states: {
            loading: {
              on: {
                'objectEngine.progressed': { actions: assign({ progress: ({ event }) => event.fraction }) },
                'objectEngine.loaded': { target: 'ready', actions: assign({ stats: ({ event }) => event.stats, progress: 1 }) },
              },
            },

            /** L'objet est à l'écran : le visiteur peut le prendre en main. */
            ready: {
              initial: 'still',
              on: {
                // consigné tel quel : c'est l'instant où le visiteur voit réellement l'objet
                'objectEngine.firstFrameShown': {},
                'objectEngine.contextLost': 'suspended',
                'object.resetRequested': { actions: 'commandReset' },
                'objectEngine.viewReset': { actions: assign({ pose: ({ event }) => event.pose }) },
                'object.autoRotateToggled': {
                  actions: [assign({ autoRotate: ({ context }) => !context.autoRotate }), 'commandAutoRotate'],
                },
              },
              states: {
                still: {
                  on: {
                    'objectEngine.gestureStarted': {
                      target: 'handled',
                      // la main du visiteur prime : le tour automatique s'arrête pour de bon
                      actions: [assign({ gesture: ({ event }) => event.gesture, autoRotate: false }), 'commandAutoRotate'],
                    },
                  },
                },
                handled: {
                  on: {
                    'objectEngine.gestureStarted': { actions: assign({ gesture: ({ event }) => event.gesture }) },
                    'objectEngine.gestureEnded': {
                      target: 'still',
                      actions: assign({ pose: ({ event }) => event.pose, gesture: null }),
                    },
                  },
                },
              },
            },

            /** Le système a repris le contexte graphique (fréquent sur mobile en arrière-plan). */
            suspended: {
              on: { 'objectEngine.contextRestored': 'ready' },
            },
          },
        },

        /** Le fichier n'a pas pu être lu, ou WebGL n'a pas démarré. */
        failed: {
          on: {
            'object.retryRequested': { target: 'mounting', actions: assign({ failure: null, progress: 0 }) },
          },
        },
      },
    },
  },
});

/* ------------------------------------------------------------- lecture --- */

type ObjectSnapshot = SnapshotFrom<typeof objectMachine>;

export type ObjectPhase = 'closed' | 'loading' | 'ready' | 'suspended' | 'failed';

export function objectPhase(snapshot: ObjectSnapshot): ObjectPhase {
  if (snapshot.matches('closed')) return 'closed';
  if (snapshot.matches({ open: 'failed' })) return 'failed';
  if (snapshot.matches({ open: { viewing: 'ready' } })) return 'ready';
  if (snapshot.matches({ open: { viewing: 'suspended' } })) return 'suspended';
  return 'loading';
}

/** Place de l'objet ouvert dans son groupe : `{ index, total }`, comptés à partir de 1. */
export const objectPage = (snapshot: ObjectSnapshot): { index: number; total: number } => ({
  index: snapshot.context.scan ? snapshot.context.group.indexOf(snapshot.context.scan) + 1 : 0,
  total: snapshot.context.group.length,
});
