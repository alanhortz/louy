/**
 * Machine du calque « Autoroutes » : le tracé des autoroutes de Wallonie, posé
 * sur le relief. Un calque comme les autres — on l'allume, on l'éteint — sauf
 * qu'il n'a ni marqueur ni sélection : allumé, il est dessiné tout entier.
 *
 *   probing ──▶ absent                      (le site ne publie aucun tracé)
 *          └──▶ hidden ⇄ shown
 */

import { assign, fromPromise, sendParent, setup, type SnapshotFrom } from 'xstate';
import { traceScans, type Scan } from '../domain/scans.ts';
import { loadScans } from '../services/scans.ts';
import type { LayerFeed } from './places.machine.ts';

export type MotorwaysEvent = { type: 'motorways.toggled' };

export type MotorwaysEmitted =
  /** `traces` : les tracés à dessiner ; aucun quand le calque est éteint. */
  | { type: 'motorways.changed'; visible: boolean; traces: Scan[] }
  /** Le visiteur vient d'allumer le calque : la vue recule pour le voir se poser. */
  | { type: 'motorways.flyRequested'; trace: Scan };

export const motorwaysMachine = setup({
  types: {
    context: {} as { traces: Scan[]; startsVisible: boolean },
    events: {} as MotorwaysEvent,
    input: {} as { visible: boolean } | undefined,
  },
  actors: {
    load: fromPromise<Scan[]>(async ({ signal }) => traceScans(await loadScans(signal))),
  },
  actions: {
    publish: sendParent(({ context }): MotorwaysEmitted => ({ type: 'motorways.changed', visible: true, traces: context.traces })),
    withdraw: sendParent((): MotorwaysEmitted => ({ type: 'motorways.changed', visible: false, traces: [] })),
    fly: sendParent(({ context }): MotorwaysEmitted => ({ type: 'motorways.flyRequested', trace: context.traces[0]! })),
  },
}).createMachine({
  id: 'motorways',
  context: ({ input }) => ({ traces: [], startsVisible: input?.visible ?? false }),
  initial: 'probing',
  states: {
    probing: {
      invoke: {
        id: 'motorways.list',
        src: 'load',
        onDone: [
          { guard: ({ event }) => event.output.length === 0, target: 'absent' },
          { guard: ({ context }) => context.startsVisible, target: 'shown', actions: assign({ traces: ({ event }) => event.output }) },
          { target: 'hidden', actions: assign({ traces: ({ event }) => event.output }) },
        ],
        onError: 'absent',
      },
    },
    /** Rien à montrer : le calque n'est même pas proposé. */
    absent: {},
    hidden: {
      // la vue ne recule que si c'est le visiteur qui allume : un lien partagé garde la sienne
      on: { 'motorways.toggled': { target: 'shown', actions: 'fly' } },
    },
    shown: {
      entry: 'publish',
      exit: 'withdraw',
      on: { 'motorways.toggled': 'hidden' },
    },
  },
});

/* ------------------------------------------------------------- lecture --- */

type MotorwaysSnapshot = SnapshotFrom<typeof motorwaysMachine>;

export const motorwaysAvailable = (snapshot: MotorwaysSnapshot): boolean => snapshot.matches('hidden') || snapshot.matches('shown');
export const motorwaysFeed = (snapshot: MotorwaysSnapshot): LayerFeed => (snapshot.matches('shown') ? 'nominal' : 'off');
