/** Accès aux acteurs depuis React : l'acteur racine par contexte, ses enfants par identifiant. */

import { useSelector } from '@xstate/react';
import { createContext, use } from 'react';
import type { AppActor, AppSnapshot } from '../machines/app.machine.ts';
import { layerRef } from '../machines/layers.machine.ts';
import type { LayerItem, SelectionLayerRef } from '../machines/selectionLayer.machine.ts';

export const AppActorContext = createContext<AppActor | null>(null);

export function useApp(): AppActor {
  const app = use(AppActorContext);
  if (!app) throw new Error('AppActorContext manquant');
  return app;
}

type Children = AppSnapshot['children'];

/** Machine fille de l'application. N'existe que dans l'état `running`. */
export function useChild<K extends keyof Children>(id: K): NonNullable<Children[K]> {
  const child = useSelector(useApp(), (snapshot) => snapshot.children[id]);
  if (!child) throw new Error(`La machine « ${String(id)} » n'est pas démarrée`);
  return child;
}

/** Calque à sélection, né sous l'orchestrateur `layers`. */
export function useLayer<T extends LayerItem>(name: string): SelectionLayerRef<T> {
  return useSelector(useChild('layers'), (snapshot) => layerRef<T>(snapshot, name));
}
