/**
 * Noms de villes et de villages, issus d'OpenStreetMap (© contributeurs
 * OpenStreetMap, licence ODbL).
 *
 * Trois provenances, de la plus rapide à la plus fraîche :
 *  1. le cache du navigateur, rempli à la première visite ;
 *  2. un instantané statique servi avec le site — l'affichage ne dépend ainsi
 *     jamais de la disponibilité d'un service tiers ;
 *  3. l'API publique Overpass, interrogée en arrière-plan pour rafraîchir le
 *     cache. C'est un service bénévole, souvent saturé : on borne l'attente et
 *     on ne l'appelle qu'une fois par visiteur et par mois.
 */

import { parsePlaces, placesQuery, snapshotPath, type Place, type PlaceTier } from '../domain/places.ts';
import { readCache, writeCache } from './cache.ts';

export type PlaceOrigin = 'cache' | 'snapshot' | 'network';

export interface PlaceBatch {
  tier: PlaceTier;
  places: Place[];
  origin: PlaceOrigin;
  /** Date d'obtention ; `null` pour l'instantané, dont l'âge n'est pas connu du navigateur. */
  storedAt: number | null;
}

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const cacheKey = (tier: PlaceTier) => `places:v1:${tier}`;

/** Instances publiques, essayées dans l'ordre jusqu'à la première réponse valide. */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const ENDPOINT_TIMEOUT_MS = 15_000;

/** Signal qui s'interrompt avec `parent`, ou de lui-même après `ms` millisecondes. */
function deadline(parent: AbortSignal, ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  parent.addEventListener('abort', () => controller.abort(), { once: true });
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return controller.signal;
}

/** Affichage immédiat : le cache s'il existe, sinon l'instantané. */
export async function loadPlaces(tier: PlaceTier, signal: AbortSignal): Promise<PlaceBatch> {
  const cached = await readCache<Place[]>(cacheKey(tier), CACHE_TTL_MS);
  if (cached) return { tier, places: cached.value, origin: 'cache', storedAt: cached.storedAt };

  const response = await fetch(snapshotPath(tier), { signal });
  if (!response.ok) throw new Error(`Instantané des lieux indisponible (${response.status})`);
  return { tier, places: parsePlaces(await response.text()), origin: 'snapshot', storedAt: null };
}

/** Interroge Overpass en direct et met le résultat en cache dans le navigateur. */
export async function refreshPlaces(tier: PlaceTier, signal: AbortSignal): Promise<PlaceBatch> {
  let failure: unknown = new Error('Overpass injoignable');
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: placesQuery(tier) }),
        signal: deadline(signal, ENDPOINT_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Overpass ${response.status}`);
      const places = parsePlaces(await response.text());
      // une instance saturée répond parfois 200 avec un corps vide : on passe à la suivante
      if (places.length === 0) throw new Error('Réponse Overpass vide');
      await writeCache(cacheKey(tier), places);
      return { tier, places, origin: 'network', storedAt: Date.now() };
    } catch (error) {
      if (signal.aborted) throw error;
      failure = error;
    }
  }
  throw failure;
}
