/**
 * Machine de l'imagerie 3D : sait quels scans le site publie et se comporte
 * comme les autres calques.
 *
 *   - Visibilité : calque éteint, rien n'est sur la carte ; allumé, chaque lieu
 *     et chaque objet y a son marqueur. Rien d'autre ne se passe à l'allumage.
 *   - Sélection : toucher un marqueur le sélectionne — il passe à l'or, comme
 *     une caméra. Un lieu sélectionné est dessiné dans la carte et la caméra s'y
 *     rend ; un objet s'ouvre dans sa visionneuse. Un seul scan est sélectionné
 *     à la fois ; éteindre le calque retire tout.
 *
 * Les objets trop proches pour que leurs marqueurs se distinguent à l'écran en
 * partagent un, qui porte leur nombre ; dès que la caméra s'approche assez,
 * chacun retrouve le sien.
 */

import { assign, fromPromise, sendParent, setup, type SnapshotFrom } from 'xstate';
import { groupObjects, isObjectScan, placeScans, scanGroupRadius, type Scan } from '../domain/scans.ts';
import type { ScanFeature } from '../engine/overlays/scanMarkers.ts';
import { loadScans } from '../services/scans.ts';
import type { LayerFeed } from './places.machine.ts';

export type ScansEvent =
  | { type: 'scans.toggled' }
  | { type: 'scans.picked'; id: string }
  /** La visionneuse d'objet s'est refermée : l'objet n'est plus sélectionné. */
  | { type: 'scans.dismissed' }
  | { type: 'scans.viewChanged'; distance: number };

export type ScansEmitted =
  | { type: 'scans.changed'; visible: boolean; features: ScanFeature[] }
  /** `markerId` : le marqueur à mettre en valeur — celui du groupe, pour un objet groupé. */
  | { type: 'scans.selectionChanged'; scan: Scan | null; markerId: string | null }
  /** Lieux à dessiner dans la carte. */
  | { type: 'scans.drawn'; scans: Scan[] }
  | { type: 'scans.flyRequested'; scan: Scan }
  | { type: 'scans.objectRequested'; scan: Scan; group: Scan[] };

interface ScansContext {
  startsVisible: boolean;
  scans: Scan[];
  selectedId: string | null;
  /** Éloignement de la caméra : il décide quels objets voisins partagent un marqueur. */
  distance: number;
}

/**
 * Éloignement sous lequel le marqueur d'un lieu dessiné s'efface : on a alors
 * le lieu lui-même sous les yeux, le marqueur ne ferait que le recouvrir.
 */
const MARKER_CLEARANCE = 1200;

const groups = ({ scans, distance }: ScansContext): Scan[][] => groupObjects(scans, scanGroupRadius(distance));

const selected = ({ scans, selectedId }: ScansContext): Scan | null =>
  scans.find((scan) => scan.id === selectedId) ?? null;

/** Lieux dessinés dans la carte : le lieu sélectionné, s'il y en a un. */
const drawn = (context: ScansContext): Scan[] => {
  const scan = selected(context);
  return scan && !isObjectScan(scan) ? [scan] : [];
};

/**
 * Marqueur d'un groupe d'objets voisins : posé au milieu d'eux, il porte leur
 * nombre et l'identifiant du premier, qui est l'objet qu'il ouvre.
 */
const toGroupFeature = (group: readonly Scan[]): ScanFeature => {
  const [first] = group as [Scan];
  if (group.length === 1) return { id: first.id, x: first.x, y: first.y, label: first.name, rank: 1 };
  return {
    id: first.id,
    x: Math.round(group.reduce((sum, scan) => sum + scan.x, 0) / group.length),
    y: Math.round(group.reduce((sum, scan) => sum + scan.y, 0) / group.length),
    label: `${group.length} objets en 3D`,
    rank: 1,
    count: group.length,
  };
};

/** Un marqueur par lieu, un par groupe d'objets. */
const markers = (context: ScansContext): ScanFeature[] => [
  ...placeScans(context.scans).map((scan): ScanFeature => ({
    id: scan.id, x: scan.x, y: scan.y, label: scan.name, rank: 1,
    // seul un lieu dessiné dans la carte peut masquer son propre marqueur
    ...(scan.id === context.selectedId ? { minDistance: MARKER_CLEARANCE } : {}),
  })),
  ...groups(context).map(toGroupFeature),
];

/** Groupe dont le marqueur porte cet identifiant. */
const groupMarked = (context: ScansContext, id: string): Scan[] | undefined =>
  groups(context).find((group) => group[0]!.id === id);

/** Marqueur qui représente le scan sélectionné : le sien, ou celui de son groupe. */
const selectedMarker = (context: ScansContext): string | null => {
  const scan = selected(context);
  if (!scan) return null;
  return isObjectScan(scan) ? (groups(context).find((group) => group.includes(scan))?.[0]!.id ?? null) : scan.id;
};

/** Composition des groupes à un éloignement donné, en une chaîne comparable. */
const grouping = (scans: readonly Scan[], distance: number): string =>
  groupObjects(scans, scanGroupRadius(distance)).map((group) => group.map((scan) => scan.id).join('+')).join('|');

export const scansMachine = setup({
  types: {
    context: {} as ScansContext,
    events: {} as ScansEvent,
    input: {} as { visible?: boolean; distance?: number } | undefined,
  },
  actors: {
    loadScans: fromPromise<Scan[]>(({ signal }) => loadScans(signal)),
  },
  guards: {
    foundScans: ({ event }) => (event as unknown as { output: Scan[] }).output.length > 0,
    startsVisible: ({ context }) => context.startsVisible,
    picksPlace: ({ context, event }) =>
      event.type === 'scans.picked' && placeScans(context.scans).some((scan) => scan.id === event.id),
    picksObject: ({ context, event }) => event.type === 'scans.picked' && groupMarked(context, event.id) !== undefined,
    objectSelected: ({ context }) => { const scan = selected(context); return scan !== null && isObjectScan(scan); },
    /** Le nouvel éloignement réunit-il ou sépare-t-il des objets ? */
    regroups: ({ context, event }) =>
      event.type === 'scans.viewChanged'
      && grouping(context.scans, event.distance) !== grouping(context.scans, context.distance),
  },
  actions: {
    keepDistance: assign({
      distance: ({ context, event }) => (event.type === 'scans.viewChanged' ? event.distance : context.distance),
    }),
    selectPicked: assign({
      selectedId: ({ context, event }) => (event.type === 'scans.picked' ? event.id : context.selectedId),
    }),
    deselect: assign({ selectedId: null }),
    publish: sendParent(({ context }): ScansEmitted => ({ type: 'scans.changed', visible: true, features: markers(context) })),
    withdraw: sendParent((): ScansEmitted => ({ type: 'scans.changed', visible: false, features: [] })),
    announceSelection: sendParent(({ context }): ScansEmitted =>
      ({ type: 'scans.selectionChanged', scan: selected(context), markerId: selectedMarker(context) })),
    draw: sendParent(({ context }): ScansEmitted => ({ type: 'scans.drawn', scans: drawn(context) })),
    fly: sendParent(({ context }): ScansEmitted => ({ type: 'scans.flyRequested', scan: selected(context)! })),
    openObject: sendParent(({ context }): ScansEmitted => {
      const group = groupMarked(context, context.selectedId ?? '')!;
      return { type: 'scans.objectRequested', scan: group[0]!, group };
    }),
  },
}).createMachine({
  id: 'scans',
  context: ({ input }) => ({
    startsVisible: input?.visible ?? true,
    scans: [],
    selectedId: null,
    distance: input?.distance ?? 1800,
  }),
  initial: 'probing',
  // hors du calque allumé, l'éloignement est seulement retenu
  on: { 'scans.viewChanged': { actions: 'keepDistance' } },
  states: {
    probing: {
      invoke: {
        id: 'scans.manifest',
        src: 'loadScans',
        onDone: [
          { guard: 'foundScans', target: 'resolving', actions: assign({ scans: ({ event }) => event.output }) },
          { target: 'absent' },
        ],
        onError: 'absent',
      },
    },
    /** Aucun scan publié : le calque n'est même pas proposé. */
    absent: {},
    resolving: {
      always: [{ guard: 'startsVisible', target: 'visible' }, { target: 'hidden' }],
    },
    /** Calque éteint : ni marqueur, ni lieu dessiné, ni sélection. */
    hidden: {
      on: { 'scans.toggled': 'visible' },
    },
    visible: {
      entry: 'publish',
      exit: ['deselect', 'withdraw', 'draw', 'announceSelection'],
      on: {
        'scans.toggled': 'hidden',
        'scans.picked': [
          // un objet : son marqueur passe à l'or et sa visionneuse s'ouvre ; un lieu jusque-là dessiné se retire
          { guard: 'picksObject', actions: ['selectPicked', 'publish', 'draw', 'announceSelection', 'openObject'] },
          // un lieu : il est dessiné dans la carte et la caméra s'y rend — y compris s'il l'était déjà
          { guard: 'picksPlace', actions: ['selectPicked', 'publish', 'draw', 'announceSelection', 'fly'] },
        ],
        'scans.dismissed': { guard: 'objectSelected', actions: ['deselect', 'announceSelection'] },
        // les marqueurs ne sont reposés que si les groupes changent, pas à chaque mouvement
        'scans.viewChanged': [
          { guard: 'regroups', actions: ['keepDistance', 'publish', 'announceSelection'] },
          { actions: 'keepDistance' },
        ],
      },
    },
  },
});

/* ------------------------------------------------------------- lecture --- */

type ScansSnapshot = SnapshotFrom<typeof scansMachine>;

export const hasScans = (snapshot: ScansSnapshot): boolean =>
  snapshot.matches('hidden') || snapshot.matches('visible');

export const scansFeed = (snapshot: ScansSnapshot): LayerFeed =>
  snapshot.matches('visible') ? 'nominal' : 'off';

const NONE: Scan[] = [];

/** Lieux actuellement dessinés dans la carte : leurs auteurs doivent alors être crédités. */
export const shownScans = (snapshot: ScansSnapshot): Scan[] => {
  const scans = snapshot.matches('visible') ? drawn(snapshot.context) : NONE;
  return scans.length > 0 ? scans : NONE;
};
