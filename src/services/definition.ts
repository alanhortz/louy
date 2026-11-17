import { isDefinition, type Definition } from '../domain/definition.ts';

const KEY = 'louy:definition';

/** Définition choisie lors d'une visite précédente ; standard à défaut. */
export function readDefinition(): Definition {
  try {
    const stored = localStorage.getItem(KEY);
    return isDefinition(stored) ? stored : 'standard';
  } catch { return 'standard'; }
}

export function storeDefinition(definition: Definition): void {
  try { localStorage.setItem(KEY, definition); } catch { /* navigation privée : le choix vaut pour cette visite */ }
}
