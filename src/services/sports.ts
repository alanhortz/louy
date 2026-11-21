import { isSportSequence, type SportSequence } from '../domain/sports.ts';

/** Séquences sportives publiées par le site ; aucune si le fichier manque. */
export async function loadSports(signal: AbortSignal): Promise<SportSequence[]> {
  const response = await fetch('/data/sports.json', { signal, cache: 'no-cache' });
  if (!response.ok) return [];
  const list: unknown = await response.json();
  return Array.isArray(list) ? list.filter(isSportSequence) : [];
}
