/**
 * Calque à sélection : l'état générique que partagent les calques dont on
 * touche les marqueurs — les caméras routières en sont le modèle.
 *
 *   probing ─┬─▶ absent                    (rien à montrer : le calque n'est pas proposé)
 *            └─▶ hidden ⇄ visible          (éteint : rien sur la carte ; allumé : ses marqueurs)
 *                         visible : un élément au plus est sélectionné
 *                           picked    → sélectionne et active l'élément du marqueur touché
 *                                       (ou demande à s'approcher, si le marqueur rassemble trop)
 *                           stepped   → passe au voisin, parmi ceux que ce marqueur rassemblait
 *                           dismissed → désélectionne
 *
 * La machine ne sait rien de ce qu'elle montre. Ce qui distingue un calque d'un
 * autre tient dans sa description (`SelectionLayerSpec`) : d'où vient sa liste
 * et quels marqueurs poser. Quels marqueurs se recouvrent à l'écran, c'est la
 * carte qui le sait : en touchant un marqueur, elle dit tout ce qu'il rassemble. Elle ne décide
 * pas non plus de ce qu'« activer » veut dire — ouvrir un panneau, une
 * visionneuse, déplacer la caméra : elle l'annonce, son parent en fait ce qu'il veut.
 */

import { assign, fromPromise, sendParent, setup, type ActorRefFrom, type SnapshotFrom } from 'xstate';
import type { OverlayFeature } from '../engine/OverlayLayer.ts';
import type { LayerFeed } from './places.machine.ts';

export interface LayerItem { id: string; x: number; y: number }

/** Ce que les marqueurs peuvent dépendre de la vue : la sélection, et l'éloignement de la caméra. */
export interface LayerView { selectedId: string | null; distance: number; keptIds: readonly string[] }

export interface SelectionLayerSpec<T extends LayerItem = LayerItem> {
  /** Nom du calque : il étiquette tout ce que la machine annonce. */
  name: string;
  load(signal: AbortSignal): Promise<T[]>;
  /** Marqueurs à poser sur la carte, un par élément. La carte regroupe elle-même ceux qui se recouvrent. */
  markers(items: readonly T[], view: LayerView): OverlayFeature[];
  /**
   * Les éléments qu'un même marqueur rassemble s'ouvrent-ils ensemble, pour être feuilletés ?
   * Sinon, toucher ce marqueur ne sélectionne rien : la machine demande seulement à s'en
   * approcher, pour qu'il se défasse. Par défaut, oui.
   */
  opensTogether?(members: readonly T[]): boolean;
}

export type LayerEvent =
  | { type: 'layer.toggled' }
  /** `members` : tous les éléments que le marqueur touché rassemble à l'écran, celui-ci compris. */
  | { type: 'layer.picked'; id: string; members?: string[] }
  | { type: 'layer.stepped'; delta: 1 | -1 }
  | { type: 'layer.dismissed' }
  /** Garder cet élément à l'écran tant que le calque est allumé, même quand un autre est sélectionné — ou cesser. */
  | { type: 'layer.keepToggled'; id: string }
  | { type: 'layer.viewChanged'; distance: number };

export type LayerEmitted<T extends LayerItem = LayerItem> =
  /** La liste du calque vient d'arriver, qu'il soit allumé ou non : de quoi préparer ce qu'il montrera. */
  | { type: 'layer.listed'; layer: string; items: T[] }
  | { type: 'layer.changed'; layer: string; visible: boolean; features: OverlayFeature[] }
  /** `markerId` : le marqueur à mettre en valeur ; `siblings` : ceux qui partageaient son marqueur quand il a été touché. */
  | { type: 'layer.selectionChanged'; layer: string; item: T | null; siblings: T[]; markerId: string | null }
  /** Éléments que le visiteur garde à l'écran ; vide quand le calque est éteint. */
  | { type: 'layer.keptChanged'; layer: string; items: T[] }
  /** Le marqueur touché rassemble trop : il faut s'approcher de ces éléments pour les distinguer. */
  | { type: 'layer.expandRequested'; layer: string; items: T[] }
  /** Le visiteur vient de désigner cet élément : c'est le moment de l'ouvrir. */
  | { type: 'layer.activated'; layer: string; item: T; siblings: T[] };

export interface LayerContext<T extends LayerItem = LayerItem> {
  startsVisible: boolean;
  items: T[];
  selectedId: string | null;
  /** Éléments que rassemblait le marqueur touché, dans l'ordre où on les feuillette. */
  siblingIds: string[];
  /** Éléments gardés à l'écran : retenus même calque éteint, pour les retrouver en le rallumant. */
  keptIds: string[];
  distance: number;
}

export interface LayerInput { visible?: boolean; distance?: number }

/** Dérive la machine d'un calque à partir de sa description. */
export function createSelectionLayer<T extends LayerItem>(spec: SelectionLayerSpec<T>) {
  type Context = LayerContext<T>;
  const view = ({ selectedId, distance, keptIds }: Context): LayerView => ({ selectedId, distance, keptIds });
  const kept = (context: Context): T[] => context.items.filter((item) => context.keptIds.includes(item.id));
  const selected = (context: Context): T | null => context.items.find((item) => item.id === context.selectedId) ?? null;

  /** Éléments désignés par un toucher : ceux que le marqueur rassemble, à défaut le seul élément touché. */
  const picked = (context: Context, event: LayerEvent): T[] => {
    if (event.type !== 'layer.picked') return [];
    const ids = event.members?.length ? event.members : [event.id];
    return ids.flatMap((id) => context.items.find((item) => item.id === id) ?? []);
  };

  /** L'élément sélectionné et ceux qui partageaient son marqueur. */
  const home = (context: Context): { markerId: string | null; siblings: T[] } => {
    const item = selected(context);
    if (!item) return { markerId: null, siblings: [] };
    const siblings = context.siblingIds.flatMap((id) => context.items.find((other) => other.id === id) ?? []);
    return { markerId: item.id, siblings: siblings.includes(item) ? siblings : [item] };
  };

  return setup({
    types: {
      context: {} as Context,
      events: {} as LayerEvent,
      input: {} as LayerInput | undefined,
    },
    actors: {
      load: fromPromise<T[]>(({ signal }) => spec.load(signal)),
    },
    guards: {
      foundItems: ({ event }) => (event as unknown as { output: T[] }).output.length > 0,
      startsVisible: ({ context }) => context.startsVisible,
      picksMarker: ({ context, event }) =>
        event.type === 'layer.picked' && context.items.some((item) => item.id === event.id),
      picksCluster: ({ context, event }) => {
        const members = picked(context, event);
        return members.length > 1 && spec.opensTogether?.(members) === false;
      },
      hasSelection: ({ context }) => selected(context) !== null,
      keepsKnown: ({ context, event }) => event.type === 'layer.keepToggled' && context.items.some((item) => item.id === event.id),
      /** Le voisin demandé existe-t-il ? On ne boucle pas : le feuilletage s'arrête aux deux bouts. */
      canStep: ({ context, event }) => {
        const item = selected(context);
        if (event.type !== 'layer.stepped' || !item) return false;
        const { siblings } = home(context);
        const next = siblings.indexOf(item) + event.delta;
        return next >= 0 && next < siblings.length;
      },
    },
    actions: {
      keepDistance: assign({
        distance: ({ context, event }) => (event.type === 'layer.viewChanged' ? event.distance : context.distance),
      }),
      selectPicked: assign(({ context, event }) => {
        const members = picked(context, event);
        // le marqueur touché ouvre son premier élément ; les autres se feuillettent
        return { selectedId: members[0]?.id ?? context.selectedId, siblingIds: members.map((item) => item.id) };
      }),
      selectNeighbour: assign({
        selectedId: ({ context, event }) => {
          const item = selected(context)!;
          const { siblings } = home(context);
          return siblings[siblings.indexOf(item) + (event.type === 'layer.stepped' ? event.delta : 0)]!.id;
        },
      }),
      deselect: assign({ selectedId: null, siblingIds: [] }),
      toggleKeep: assign({
        keptIds: ({ context, event }) => {
          if (event.type !== 'layer.keepToggled') return context.keptIds;
          return context.keptIds.includes(event.id)
            ? context.keptIds.filter((id) => id !== event.id) : [...context.keptIds, event.id];
        },
      }),
      announceKept: sendParent(({ context }): LayerEmitted<T> => ({ type: 'layer.keptChanged', layer: spec.name, items: kept(context) })),
      announceNoneKept: sendParent((): LayerEmitted<T> => ({ type: 'layer.keptChanged', layer: spec.name, items: [] })),
      announceList: sendParent(({ context }): LayerEmitted<T> => ({ type: 'layer.listed', layer: spec.name, items: context.items })),
      publish: sendParent(({ context }): LayerEmitted<T> => ({
        type: 'layer.changed', layer: spec.name, visible: true, features: spec.markers(context.items, view(context)),
      })),
      withdraw: sendParent((): LayerEmitted<T> => ({ type: 'layer.changed', layer: spec.name, visible: false, features: [] })),
      announceSelection: sendParent(({ context }): LayerEmitted<T> =>
        ({ type: 'layer.selectionChanged', layer: spec.name, item: selected(context), ...home(context) })),
      requestExpand: sendParent(({ context, event }): LayerEmitted<T> => ({
        type: 'layer.expandRequested',
        layer: spec.name,
        items: picked(context, event),
      })),
      activate: sendParent(({ context }): LayerEmitted<T> =>
        ({ type: 'layer.activated', layer: spec.name, item: selected(context)!, siblings: home(context).siblings })),
    },
  }).createMachine({
    id: spec.name,
    context: ({ input }) => ({
      startsVisible: input?.visible ?? true,
      items: [],
      selectedId: null,
      siblingIds: [],
      keptIds: [],
      distance: input?.distance ?? 1800,
    }),
    initial: 'probing',
    // l'éloignement est retenu pour les calques dont les marqueurs en dépendent
    on: { 'layer.viewChanged': { actions: 'keepDistance' } },
    states: {
      probing: {
        invoke: {
          id: `${spec.name}.list`,
          src: 'load',
          onDone: [
            { guard: 'foundItems', target: 'resolving', actions: [assign({ items: ({ event }) => event.output }), 'announceList'] },
            { target: 'absent' },
          ],
          onError: 'absent',
        },
      },
      /** Rien à montrer : le calque n'est même pas proposé. */
      absent: {},
      resolving: {
        always: [{ guard: 'startsVisible', target: 'visible' }, { target: 'hidden' }],
      },
      /** Calque éteint : ni marqueur, ni sélection. */
      hidden: {
        on: { 'layer.toggled': 'visible' },
      },
      visible: {
        entry: ['publish', 'announceKept'],
        exit: ['deselect', 'withdraw', 'announceSelection', 'announceNoneKept'],
        on: {
          'layer.toggled': 'hidden',
          // toucher de nouveau l'élément sélectionné le réactive : son panneau se rouvre, la caméra y retourne
          'layer.picked': [
            { guard: 'picksCluster', actions: 'requestExpand' },
            { guard: 'picksMarker', actions: ['selectPicked', 'publish', 'announceSelection', 'activate'] },
          ],
          'layer.stepped': { guard: 'canStep', actions: ['selectNeighbour', 'publish', 'announceSelection', 'activate'] },
          'layer.dismissed': { guard: 'hasSelection', actions: ['deselect', 'publish', 'announceSelection'] },
          'layer.keepToggled': { guard: 'keepsKnown', actions: ['toggleKeep', 'publish', 'announceKept'] },
        },
      },
    },
  });
}

/* ------------------------------------------------------------- lecture --- */

export type SelectionLayerMachine<T extends LayerItem = LayerItem> = ReturnType<typeof createSelectionLayer<T>>;
export type SelectionLayerRef<T extends LayerItem = LayerItem> = ActorRefFrom<SelectionLayerMachine<T>>;
type LayerSnapshot<T extends LayerItem> = SnapshotFrom<SelectionLayerMachine<T>>;

/** Le calque a-t-il quelque chose à montrer ? Sinon sa ligne n'apparaît pas dans le panneau. */
export const layerAvailable = <T extends LayerItem>(snapshot: LayerSnapshot<T>): boolean =>
  snapshot.matches('hidden') || snapshot.matches('visible');

export const layerFeed = <T extends LayerItem>(snapshot: LayerSnapshot<T>): LayerFeed =>
  (snapshot.matches('visible') ? 'nominal' : 'off');

export const layerSelection = <T extends LayerItem>(snapshot: LayerSnapshot<T>): T | null =>
  snapshot.context.items.find((item) => item.id === snapshot.context.selectedId) ?? null;

/** Éléments que le visiteur garde à l'écran. */
export const layerKept = <T extends LayerItem>(snapshot: LayerSnapshot<T>): readonly string[] => snapshot.context.keptIds;
