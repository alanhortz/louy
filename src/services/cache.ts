/**
 * Cache persistant clef → valeur, avec durée de vie. Sert aux données publiques
 * lentes à obtenir et rarement modifiées (noms de lieux OpenStreetMap) : elles
 * ne sont demandées au réseau qu'à la première visite.
 */

import { STORES, transact } from './database.ts';

interface Entry<T> {
  key: string;
  storedAt: number;
  value: T;
}

export interface Cached<T> {
  value: T;
  storedAt: number;
}

export async function readCache<T>(key: string, maxAgeMs: number): Promise<Cached<T> | null> {
  try {
    const entry = await transact<Entry<T> | undefined>(STORES.cache, 'readonly', (store) => store.get(key));
    if (!entry || Date.now() - entry.storedAt > maxAgeMs) return null;
    return { value: entry.value, storedAt: entry.storedAt };
  } catch {
    return null; // navigation privée, quota : on se passe simplement du cache
  }
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
  const entry: Entry<T> = { key, storedAt: Date.now(), value };
  try {
    await transact(STORES.cache, 'readwrite', (store) => store.put(entry));
  } catch {
    // un cache qui refuse d'écrire ne doit jamais empêcher d'afficher la donnée
  }
}
