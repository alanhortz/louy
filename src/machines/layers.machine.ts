/**
 * Orchestrateur des calques à sélection : il fait naître une machine par calque
 * décrit — toutes dérivées du même état générique (`selectionLayer.machine.ts`)
 * — puis sert d'aiguillage.
 *
 *   machine applicative ──▶ layers ──▶ le calque nommé        (toucher, feuilleter, éteindre)
 *   machine applicative ◀── layers ◀── n'importe quel calque  (marqueurs, sélection, activation)
 *
 * Ajouter un calque, c'est ajouter une description à la liste : ni cette
 * machine ni l'état générique ne changent.
 */

import { enqueueActions, sendParent, setup, type AnyActorLogic } from 'xstate';
import {
  createSelectionLayer, type LayerEmitted, type LayerEvent, type LayerInput, type LayerItem,
  type SelectionLayerRef, type SelectionLayerSpec,
} from './selectionLayer.machine.ts';

/** Un geste adressé à un calque : le même événement que le sien, plus son nom. */
type Addressed<E> = E extends { type: `layer.${infer Kind}` } ? Omit<E, 'type'> & { type: `layers.${Kind}`; layer: string } : never;

export type LayersEvent =
  | Addressed<Exclude<LayerEvent, { type: 'layer.viewChanged' }>>
  /** La vue concerne tous les calques : elle leur est diffusée. */
  | { type: 'layers.viewChanged'; distance: number }
  | LayerEmitted;

/** Ce que les calques annoncent, relayé tel quel sous le nom de l'orchestrateur. */
export type LayersEmitted<T extends LayerItem = LayerItem> =
  LayerEmitted<T> extends infer E ? (E extends { type: `layer.${infer Kind}` } ? Omit<E, 'type'> & { type: `layers.${Kind}` } : never) : never;

export interface LayersInput {
  /** Calques allumés à l'ouverture, par nom ; un calque absent d'ici est allumé. */
  visible?: Record<string, boolean>;
  distance?: number;
}

interface LayersContext { layers: Record<string, SelectionLayerRef> }

const GESTURES = ['toggled', 'picked', 'stepped', 'dismissed'] as const;
const REPORTS = ['listed', 'changed', 'selectionChanged', 'expandRequested', 'activated'] as const;

// `any` : chaque calque a son propre type d'élément, que l'orchestrateur n'a pas à connaître
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createLayersMachine(specs: readonly SelectionLayerSpec<any>[]) {
  return setup({
    types: {
      context: {} as LayersContext,
      events: {} as LayersEvent,
      input: {} as LayersInput | undefined,
    },
    actions: {
      /** Remet le geste au calque nommé, sous le nom que celui-ci connaît. Un calque inconnu : geste ignoré. */
      route: enqueueActions(({ context, event, enqueue }) => {
        if (!event.type.startsWith('layers.') || !('layer' in event)) return;
        const { layer, type, ...rest } = event as { layer: string; type: string };
        const target = context.layers[layer];
        if (target) enqueue.sendTo(target, { ...rest, type: type.replace('layers.', 'layer.') } as LayerEvent);
      }),
      broadcastView: enqueueActions(({ context, event, enqueue }) => {
        if (event.type !== 'layers.viewChanged') return;
        for (const layer of Object.values(context.layers)) enqueue.sendTo(layer, { type: 'layer.viewChanged', distance: event.distance });
      }),
      relay: sendParent(({ event }) => ({ ...event, type: event.type.replace('layer.', 'layers.') })),
    },
  }).createMachine({
    id: 'layers',
    context: ({ spawn, input }) => ({
      layers: Object.fromEntries(specs.map((spec) => {
        const settings: LayerInput = { visible: input?.visible?.[spec.name], distance: input?.distance };
        // les calques sont créés à la volée : leur type échappe au registre d'acteurs de `setup`, d'où la conversion
        const born = (spawn as unknown as (logic: AnyActorLogic, options: { id: string; input: LayerInput }) => unknown)(
          createSelectionLayer(spec as SelectionLayerSpec), { id: spec.name, input: settings });
        return [spec.name, born as SelectionLayerRef];
      })),
    }),
    on: {
      ...Object.fromEntries(GESTURES.map((kind) => [`layers.${kind}`, { actions: 'route' }])),
      'layers.viewChanged': { actions: 'broadcastView' },
      ...Object.fromEntries(REPORTS.map((kind) => [`layer.${kind}`, { actions: 'relay' }])),
    },
  });
}

/** Calque de l'orchestrateur, pour l'interface : `snapshot.context.layers[nom]`. */
export const layerRef = <T extends LayerItem>(snapshot: { context: LayersContext }, name: string): SelectionLayerRef<T> =>
  snapshot.context.layers[name] as unknown as SelectionLayerRef<T>;

