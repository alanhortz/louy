/**
 * Calque à sélection : l'état générique que partagent les calques dont on
 * touche les marqueurs — les caméras routières en sont le modèle.
 *
 *   probing ─┬─▶ absent                    (rien à montrer : le calque n'est pas proposé)
 *            └─▶ hidden ⇄ visible          (éteint : rien sur la carte ; allumé : ses marqueurs)
 *                         visible : un élément au plus est sélectionné
 *                           picked    → sélectionne et active l'élément du marqueur touché
 *                                       (ou demande à s'approcher, si le marqueur rassemble trop)
 *                           stepped   → passe au voisin, parmi ceux du même marqueur
 *                           dismissed → désélectionne
 *
 * La machine ne sait rien de ce qu'elle montre. Ce qui distingue un calque d'un
 * autre tient dans sa description (`SelectionLayerSpec`) : d'où vient sa liste,
 * quels marqueurs poser, quels éléments un marqueur représente. Elle ne décide
 * pas non plus de ce qu'« activer » veut dire — ouvrir un panneau, une
 * visionneuse, déplacer la caméra : elle l'annonce, son parent en fait ce qu'il veut.
 */

import { assign, fromPromise, sendParent, setup, type ActorRefFrom, type SnapshotFrom } from 'xstate';
import type { OverlayFeature } from '../engine/OverlayLayer.ts';
import type { LayerFeed } from './places.machine.ts';

export interface LayerItem { id: string; x: number; y: number }

/** Ce que les marqueurs peuvent dépendre de la vue : la sélection, et l'éloignement de la caméra. */
export interface LayerView { selectedId: string | null; distance: number }

export interface SelectionLayerSpec<T extends LayerItem = LayerItem> {
  /** Nom du calque : il étiquette tout ce que la machine annonce. */
  name: string;
  load(signal: AbortSignal): Promise<T[]>;
  /** Marqueurs à poser sur la carte. Un marqueur peut représenter plusieurs éléments. */
  markers(items: readonly T[], view: LayerView): OverlayFeature[];
  /** Éléments que représente le marqueur `markerId` ; vide s'il n'existe pas. Le premier est celui qu'il sélectionne. */
  members(items: readonly T[], markerId: string, view: LayerView): T[];
  /**
   * Le marqueur rassemble-t-il des éléments qu'on ne peut pas ouvrir ensemble ? Le toucher ne sélectionne
   * alors rien : la machine demande seulement à s'en approcher, pour qu'il se défasse. Par défaut, jamais.
   */
  expands?(items: readonly T[], markerId: string, view: LayerView): boolean;
}

export type LayerEvent =
  | { type: 'layer.toggled' }
  | { type: 'layer.picked'; id: string }
  | { type: 'layer.stepped'; delta: 1 | -1 }
  | { type: 'layer.dismissed' }
  | { type: 'layer.viewChanged'; distance: number };

export type LayerEmitted<T extends LayerItem = LayerItem> =
  /** La liste du calque vient d'arriver, qu'il soit allumé ou non : de quoi préparer ce qu'il montrera. */
  | { type: 'layer.listed'; layer: string; items: T[] }
  | { type: 'layer.changed'; layer: string; visible: boolean; features: OverlayFeature[] }
  /** `markerId` : le marqueur à mettre en valeur — celui du groupe, pour un élément groupé. */
  | { type: 'layer.selectionChanged'; layer: string; item: T | null; siblings: T[]; markerId: string | null }
  /** Le marqueur touché rassemble trop : il faut s'approcher de ces éléments pour les distinguer. */
  | { type: 'layer.expandRequested'; layer: string; items: T[] }
  /** Le visiteur vient de désigner cet élément : c'est le moment de l'ouvrir. */
  | { type: 'layer.activated'; layer: string; item: T; siblings: T[] };

export interface LayerContext<T extends LayerItem = LayerItem> {
  startsVisible: boolean;
  items: T[];
  selectedId: string | null;
  distance: number;
}

export interface LayerInput { visible?: boolean; distance?: number }

/** Dérive la machine d'un calque à partir de sa description. */
export function createSelectionLayer<T extends LayerItem>(spec: SelectionLayerSpec<T>) {
  type Context = LayerContext<T>;
  const view = ({ selectedId, distance }: Context): LayerView => ({ selectedId, distance });
  const selected = (context: Context): T | null => context.items.find((item) => item.id === context.selectedId) ?? null;

  /** Marqueur qui représente l'élément sélectionné, et les éléments qu'il rassemble. */
  const home = (context: Context): { markerId: string | null; siblings: T[] } => {
    const item = selected(context);
    if (!item) return { markerId: null, siblings: [] };
    for (const marker of spec.markers(context.items, view(context))) {
      const members = spec.members(context.items, marker.id, view(context));
      if (members.includes(item)) return { markerId: marker.id, siblings: members };
    }
    return { markerId: null, siblings: [item] };
  };

  /** Disposition des marqueurs à un éloignement donné, en une chaîne comparable. */
  const layout = (context: Context, distance: number): string =>
    spec.markers(context.items, { selectedId: context.selectedId, distance })
      .map((marker) => `${marker.id}@${marker.x},${marker.y}`).join('|');

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
        event.type === 'layer.picked' && spec.members(context.items, event.id, view(context)).length > 0,
      picksCluster: ({ context, event }) =>
        event.type === 'layer.picked' && (spec.expands?.(context.items, event.id, view(context)) ?? false),
      hasSelection: ({ context }) => selected(context) !== null,
      /** Le voisin demandé existe-t-il ? On ne boucle pas : le feuilletage s'arrête aux deux bouts. */
      canStep: ({ context, event }) => {
        const item = selected(context);
        if (event.type !== 'layer.stepped' || !item) return false;
        const { siblings } = home(context);
        const next = siblings.indexOf(item) + event.delta;
        return next >= 0 && next < siblings.length;
      },
      /** Le nouvel éloignement change-t-il la disposition des marqueurs (groupes qui se font ou se défont) ? */
      rearranges: ({ context, event }) =>
        event.type === 'layer.viewChanged' && layout(context, event.distance) !== layout(context, context.distance),
    },
    actions: {
      keepDistance: assign({
        distance: ({ context, event }) => (event.type === 'layer.viewChanged' ? event.distance : context.distance),
      }),
      selectPicked: assign({
        selectedId: ({ context, event }) =>
          (event.type === 'layer.picked' ? spec.members(context.items, event.id, view(context))[0]!.id : context.selectedId),
      }),
      selectNeighbour: assign({
        selectedId: ({ context, event }) => {
          const item = selected(context)!;
          const { siblings } = home(context);
          return siblings[siblings.indexOf(item) + (event.type === 'layer.stepped' ? event.delta : 0)]!.id;
        },
      }),
      deselect: assign({ selectedId: null }),
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
        items: spec.members(context.items, event.type === 'layer.picked' ? event.id : '', view(context)),
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
      distance: input?.distance ?? 1800,
    }),
    initial: 'probing',
    // hors du calque allumé, l'éloignement est seulement retenu
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
        entry: 'publish',
        exit: ['deselect', 'withdraw', 'announceSelection'],
        on: {
          'layer.toggled': 'hidden',
          // toucher de nouveau l'élément sélectionné le réactive : son panneau se rouvre, la caméra y retourne
          'layer.picked': [
            { guard: 'picksCluster', actions: 'requestExpand' },
            { guard: 'picksMarker', actions: ['selectPicked', 'publish', 'announceSelection', 'activate'] },
          ],
          'layer.stepped': { guard: 'canStep', actions: ['selectNeighbour', 'publish', 'announceSelection', 'activate'] },
          'layer.dismissed': { guard: 'hasSelection', actions: ['deselect', 'publish', 'announceSelection'] },
          // les marqueurs ne sont reposés que si leur disposition change, pas à chaque mouvement
          'layer.viewChanged': [
            { guard: 'rearranges', actions: ['keepDistance', 'publish', 'announceSelection'] },
            { actions: 'keepDistance' },
          ],
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
