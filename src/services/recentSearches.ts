import { parseRecentSearches, type RecentSearch } from '../domain/recentSearches.ts';

const KEY = 'louy:recherches';

export function readRecentSearches(): RecentSearch[] {
  try {
    return parseRecentSearches(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  } catch {
    // navigation privée ou contenu abîmé : on repart d'une liste vide
    return [];
  }
}

export function writeRecentSearches(list: readonly RecentSearch[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // navigation privée : les recherches ne seront pas retenues, sans autre conséquence
  }
}
