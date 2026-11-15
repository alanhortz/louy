/**
 * Recherches récentes : les sites et les rues que le visiteur a déjà choisis
 * dans la palette, pour les lui proposer en premier la fois suivante.
 * Elles ne quittent pas son navigateur.
 */

export interface RecentSearch {
  kind: 'site' | 'street';
  id: string;
  name: string;
  /** Ce qui situe le résultat : catégorie et localité d'un site, localité d'une rue. */
  meta: string;
  x: number;
  y: number;
}

export const MAX_RECENT_SEARCHES = 8;

/** Identité d'un résultat dans la liste : un site et une rue peuvent porter le même identifiant. */
export const recentKey = (entry: Pick<RecentSearch, 'kind' | 'id'>): string => `${entry.kind}:${entry.id}`;

/** Place un choix en tête de liste ; déjà présent, il y remonte au lieu de s'y répéter. */
export function rememberSearch(list: readonly RecentSearch[], entry: RecentSearch): RecentSearch[] {
  return [entry, ...list.filter((known) => recentKey(known) !== recentKey(entry))].slice(0, MAX_RECENT_SEARCHES);
}

/** Lecture tolérante de la liste gardée dans le navigateur : toute entrée abîmée est écartée. */
export function parseRecentSearches(raw: unknown): RecentSearch[] {
  if (!Array.isArray(raw)) return [];
  const list: RecentSearch[] = [];
  for (const item of raw as Partial<RecentSearch>[]) {
    if (!item || (item.kind !== 'site' && item.kind !== 'street')) continue;
    if (typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.meta !== 'string') continue;
    if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;
    const entry = { kind: item.kind, id: item.id, name: item.name.slice(0, 120), meta: item.meta.slice(0, 120), x: item.x!, y: item.y! };
    if (!list.some((known) => recentKey(known) === recentKey(entry))) list.push(entry);
    if (list.length === MAX_RECENT_SEARCHES) break;
  }
  return list;
}

const fold = (text: string): string => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Les recherches récentes qui répondent à une saisie : toutes si elle est vide, sinon celles qui en contiennent chaque mot. */
export function matchRecentSearches(list: readonly RecentSearch[], input: string): RecentSearch[] {
  const words = fold(input).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...list];
  return list.filter((entry) => {
    const haystack = fold(`${entry.name} ${entry.meta}`);
    return words.every((word) => haystack.includes(word));
  });
}
