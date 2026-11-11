/**
 * Machine des scans 3D : sait quels scans existent sur ce poste et si le
 * visiteur veut les voir. Les afficher emmène la caméra au-dessus du premier.
 */

import { assign, fromPromise, sendParent, setup, type SnapshotFrom } from 'xstate';
import type { Scan } from '../domain/scans.ts';
import { loadScans } from '../services/scans.ts';
import type { LayerFeed } from './places.machine.ts';

export type ScansEvent = { type: 'scans.toggled' };

export type ScansEmitted =
  | { type: 'scans.changed'; scans: Scan[] }
  | { type: 'scans.flyRequested'; scan: Scan };

export const scansMachine = setup({
  types: {
    context: {} as { scans: Scan[] },
    events: {} as ScansEvent,
  },
  actors: {
    loadScans: fromPromise<Scan[]>(({ signal }) => loadScans(signal)),
  },
  guards: {
    foundScans: ({ event }) => (event as unknown as { output: Scan[] }).output.length > 0,
  },
  actions: {
    show: sendParent(({ context }): ScansEmitted => ({ type: 'scans.changed', scans: context.scans })),
    hide: sendParent((): ScansEmitted => ({ type: 'scans.changed', scans: [] })),
    flyToFirst: sendParent(({ context }): ScansEmitted => ({ type: 'scans.flyRequested', scan: context.scans[0]! })),
  },
}).createMachine({
  id: 'scans',
  context: { scans: [] },
  initial: 'probing',
  states: {
    probing: {
      invoke: {
        id: 'scans.manifest',
        src: 'loadScans',
        onDone: [
          { guard: 'foundScans', target: 'hidden', actions: assign({ scans: ({ event }) => event.output }) },
          { target: 'absent' },
        ],
        onError: 'absent',
      },
    },
    /** Aucun scan sur ce poste : le calque n'est même pas proposé. */
    absent: {},
    hidden: {
      on: { 'scans.toggled': 'shown' },
    },
    shown: {
      entry: ['show', 'flyToFirst'],
      exit: 'hide',
      on: { 'scans.toggled': 'hidden' },
    },
  },
});

/* ------------------------------------------------------------- lecture --- */

type ScansSnapshot = SnapshotFrom<typeof scansMachine>;

export const hasScans = (snapshot: ScansSnapshot): boolean =>
  snapshot.matches('hidden') || snapshot.matches('shown');

export const scansFeed = (snapshot: ScansSnapshot): LayerFeed =>
  snapshot.matches('shown') ? 'nominal' : 'off';
