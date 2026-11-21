import { isDefinition, type Definition } from '../domain/definition.ts';

const KEY = 'louy:definition';

/** Ce que l'on montre à qui n'a rien choisi : la haute définition, la précision d'abord. */
export const DEFAULT_DEFINITION: Definition = 'high';

/** Définition choisie lors d'une visite précédente ; la haute à défaut. */
export function readDefinition(): Definition {
  try {
    const stored = localStorage.getItem(KEY);
    return isDefinition(stored) ? stored : DEFAULT_DEFINITION;
  } catch { return DEFAULT_DEFINITION; }
}

export function storeDefinition(definition: Definition): void {
  try { localStorage.setItem(KEY, definition); } catch { /* navigation privée : le choix vaut pour cette visite */ }
}
