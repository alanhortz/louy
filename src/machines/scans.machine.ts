/**
 * Machine des scans 3D : sait quels scans le site publie, les signale sur la
 * carte par un marqueur, et retient si le visiteur veut les voir. Les afficher
 * — par le calque ou par un marqueur — emmène la caméra au-dessus d'un scan.
 */

import { assign, fromPromise, sendParent, setup, type SnapshotFrom } from 'xstate';
import type { Scan } from '../domain/scans.ts';
import type { ScanFeature } from '../engine/overlays/scanMarkers.ts';
import { loadScans } from '../services/scans.ts';
import type { LayerFeed } from './places.machine.ts';

export type ScansEvent =
  | { type: 'scans.toggled' }
  | { type: 'scans.picked'; id: string };

export type ScansEmitted =
  | { type: 'scans.changed'; scans: Scan[] }
  | { type: 'scans.flyRequested'; scan: Scan }
  | { type: 'scans.markersChanged'; features: ScanFeature[]; activeId: string | null };

interface ScansContext {
  scans: Scan[];
  /** Scan vers lequel la caméra a été emmenée en dernier. */
  focus: string | null;
}

/**
 * Éloignement sous lequel le marqueur d'un scan affiché s'efface : on a alors
 * le lieu lui-même sous les yeux, le marqueur ne ferait que le recouvrir.
 */
const MARKER_CLEARANCE = 1200;

const toFeature = (scan: Scan, shown: boolean): ScanFeature => ({
  id: scan.id,
  x: scan.x,
  y: scan.y,
  label: scan.name,
  rank: 1,
  ...(shown ? { minDistance: MARKER_CLEARANCE } : {}),
});

const focused = ({ scans, focus }: ScansContext): Scan => scans.find((scan) => scan.id === focus) ?? scans[0]!;

export const scansMachine = setup({
  types: {
    context: {} as ScansContext,
    events: {} as ScansEvent,
  },
  actors: {
    loadScans: fromPromise<Scan[]>(({ signal }) => loadScans(signal)),
  },
  guards: {
    foundScans: ({ event }) => (event as unknown as { output: Scan[] }).output.length > 0,
    picksKnownScan: ({ context, event }) =>
      event.type === 'scans.picked' && context.scans.some((scan) => scan.id === event.id),
  },
  actions: {
    focusFirst: assign({ focus: ({ context }) => context.scans[0]?.id ?? null }),
    focusPicked: assign({ focus: ({ context, event }) => (event.type === 'scans.picked' ? event.id : context.focus) }),
    show: sendParent(({ context }): ScansEmitted => ({ type: 'scans.changed', scans: context.scans })),
    hide: sendParent((): ScansEmitted => ({ type: 'scans.changed', scans: [] })),
    fly: sendParent(({ context }): ScansEmitted => ({ type: 'scans.flyRequested', scan: focused(context) })),
    markIdle: sendParent(({ context }): ScansEmitted => ({
      type: 'scans.markersChanged',
      features: context.scans.map((scan) => toFeature(scan, false)),
      activeId: null,
    })),
    markShown: sendParent(({ context }): ScansEmitted => ({
      type: 'scans.markersChanged',
      features: context.scans.map((scan) => toFeature(scan, true)),
      activeId: focused(context).id,
    })),
  },
}).createMachine({
  id: 'scans',
  context: { scans: [], focus: null },
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
    /** Aucun scan publié : le calque n'est même pas proposé. */
    absent: {},
    /** Les scans ne sont pas dessinés, mais leurs marqueurs disent où ils sont. */
    hidden: {
      entry: 'markIdle',
      on: {
        'scans.toggled': { target: 'shown', actions: 'focusFirst' },
        'scans.picked': { guard: 'picksKnownScan', target: 'shown', actions: 'focusPicked' },
      },
    },
    shown: {
      entry: ['show', 'markShown', 'fly'],
      exit: 'hide',
      on: {
        'scans.toggled': 'hidden',
        // un autre marqueur : la caméra change de lieu, les scans restent affichés
        'scans.picked': { guard: 'picksKnownScan', actions: ['focusPicked', 'markShown', 'fly'] },
      },
    },
  },
});

/* ------------------------------------------------------------- lecture --- */

type ScansSnapshot = SnapshotFrom<typeof scansMachine>;

export const hasScans = (snapshot: ScansSnapshot): boolean =>
  snapshot.matches('hidden') || snapshot.matches('shown');

export const scansFeed = (snapshot: ScansSnapshot): LayerFeed =>
  snapshot.matches('shown') ? 'nominal' : 'off';

const NONE: Scan[] = [];

/** Scans actuellement à l'écran : leurs auteurs doivent alors être crédités. */
export const shownScans = (snapshot: ScansSnapshot): Scan[] =>
  snapshot.matches('shown') ? snapshot.context.scans : NONE;
