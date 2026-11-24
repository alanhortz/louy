import { defaultDefinition, isDefinition, type Definition } from '../domain/definition.ts';
import type { QualityProfileId } from '../domain/quality.ts';

const KEY = 'louy:definition';

/** Ce que l'on montre à qui n'a rien choisi : la haute définition, la précision d'abord. */
export const DEFAULT_DEFINITION: Definition = 'high';

/** Définition choisie lors d'une visite précédente ; à défaut, celle de l'appareil (haute sur ordinateur, standard sur téléphone). */
export function readDefinition(profile: QualityProfileId = 'desktop'): Definition {
  try {
    const stored = localStorage.getItem(KEY);
    return isDefinition(stored) ? stored : defaultDefinition(profile);
  } catch { return defaultDefinition(profile); }
}

export function storeDefinition(definition: Definition): void {
  try { localStorage.setItem(KEY, definition); } catch { /* navigation privée : le choix vaut pour cette visite */ }
}
