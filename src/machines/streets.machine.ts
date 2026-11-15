/**
 * Machine du calque « Noms de rues » : de près, elle charge les dalles
 * d'étiquettes autour du point visé et les publie ; de loin, elle se tait —
 * des noms de rues vus à dix kilomètres ne seraient qu'un fouillis.
 */

import { assign, fromPromise, sendParent, setup, type SnapshotFrom } from 'xstate';
import {
  STREET_MAX_DISTANCE, streetCellKey, streetCellsAround, type StreetCell, type StreetLabel,
} from '../domain/streets.ts';
import { loadStreetCell } from '../services/streets.ts';
import type { LayerFeed } from './places.machine.ts';

export type StreetsEvent =
  | { type: 'streets.toggled' }
  | { type: 'streets.viewChanged'; x: number; y: number; distance: number };

export type StreetsEmitted = { type: 'streets.changed'; visible: boolean; features: StreetLabel[] };

interface Focus { x: number; y: number; distance: number }

interface StreetsContext {
  visible: boolean;
  focus: Focus;
  /** Dalles déjà lues, par clef ; les plus anciennes sont oubliées au-delà de CELL_MEMORY. */
  cells: Map<string, StreetLabel[]>;
}

/** Nombre de dalles gardées en mémoire : de quoi revenir sur ses pas sans rien recharger. */
const CELL_MEMORY = 36;

const wanted = (focus: Focus): StreetCell[] => streetCellsAround(focus.x, focus.y);
const missing = ({ focus, cells }: StreetsContext): StreetCell[] =>
  wanted(focus).filter((cell) => !cells.has(streetCellKey(cell)));

export const streetsMachine = setup({
  types: {
    context: {} as StreetsContext,
    events: {} as StreetsEvent,
    input: {} as { visible: boolean; focus: Focus },
  },
  actors: {
    loadCells: fromPromise<[string, StreetLabel[]][], StreetCell[]>(({ input, signal }) =>
      Promise.all(input.map(async (cell) =>
        [streetCellKey(cell), await loadStreetCell(cell, signal)] as [string, StreetLabel[]]))),
  },
  guards: {
    startsVisible: ({ context }) => context.visible,
    isTooFar: ({ context }) => context.focus.distance > STREET_MAX_DISTANCE,
    lacksCells: ({ context }) => missing(context).length > 0,
  },
  actions: {
    trackFocus: assign({
      focus: ({ context, event }) =>
        (event.type === 'streets.viewChanged' ? { x: event.x, y: event.y, distance: event.distance } : context.focus),
    }),
    publish: sendParent(({ context }): StreetsEmitted => ({
      type: 'streets.changed',
      visible: true,
      features: wanted(context.focus).flatMap((cell) => context.cells.get(streetCellKey(cell)) ?? []),
    })),
    /** Le calque reste allumé, mais il n'y a rien à montrer d'ici. */
    publishNothing: sendParent((): StreetsEmitted => ({ type: 'streets.changed', visible: true, features: [] })),
    withdraw: sendParent((): StreetsEmitted => ({ type: 'streets.changed', visible: false, features: [] })),
  },
}).createMachine({
  id: 'streets',
  context: ({ input }) => ({ ...input, cells: new Map() }),
  initial: 'resolving',
  states: {
    resolving: {
      always: [{ guard: 'startsVisible', target: 'visible' }, { target: 'hidden' }],
    },
    hidden: {
      entry: assign({ visible: false }),
      on: {
        'streets.viewChanged': { actions: 'trackFocus' },
        'streets.toggled': 'visible',
      },
    },
    visible: {
      entry: assign({ visible: true }),
      exit: 'withdraw',
      initial: 'routing',
      on: {
        'streets.toggled': 'hidden',
        'streets.viewChanged': { target: '.routing', actions: 'trackFocus' },
      },
      states: {
        routing: {
          always: [
            { guard: 'isTooFar', target: 'outOfRange' },
            { guard: 'lacksCells', target: 'loading' },
            { target: 'shown' },
          ],
        },
        /** Trop loin pour lire des noms de rues. */
        outOfRange: { entry: 'publishNothing' },
        loading: {
          invoke: {
            id: 'streets.cells',
            src: 'loadCells',
            input: ({ context }) => missing(context),
            onDone: {
              target: 'shown',
              actions: assign({
                cells: ({ context, event }) => {
                  const cells = new Map([...context.cells, ...event.output]);
                  // Map garde l'ordre d'insertion : les premières entrées sont les plus anciennes
                  for (const key of [...cells.keys()].slice(0, Math.max(0, cells.size - CELL_MEMORY))) cells.delete(key);
                  return cells;
                },
              }),
            },
            onError: 'failed',
          },
        },
        shown: { entry: 'publish' },
        failed: { entry: 'publishNothing' },
      },
    },
  },
});

/* ------------------------------------------------------------- lecture --- */

type StreetsSnapshot = SnapshotFrom<typeof streetsMachine>;

export function streetsFeed(snapshot: StreetsSnapshot): LayerFeed {
  if (snapshot.matches('hidden') || snapshot.matches('resolving')) return 'off';
  if (snapshot.matches({ visible: 'loading' })) return 'loading';
  if (snapshot.matches({ visible: 'failed' })) return 'unavailable';
  return 'nominal';
}

/** Les noms ne se lisent que de près : le calque est allumé mais attend qu'on s'approche. */
export const streetsOutOfRange = (snapshot: StreetsSnapshot): boolean => snapshot.matches({ visible: 'outOfRange' });

export const streetsCount = (snapshot: StreetsSnapshot): number =>
  (snapshot.matches({ visible: 'shown' })
    ? wanted(snapshot.context.focus).reduce((sum, cell) => sum + (snapshot.context.cells.get(streetCellKey(cell))?.length ?? 0), 0)
    : 0);
