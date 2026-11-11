/**
 * Noms de lieux OpenStreetMap : la requête Overpass et la lecture de sa réponse.
 *
 * Partagé par le navigateur (interrogation en direct) et par le script de
 * récolte, qui enregistre la même réponse comme instantané de départ.
 */

import { toLambert } from './lambert2008.ts';

/** Palier de chargement : les villes d'abord, les villages en s'approchant. */
export type PlaceTier = 'major' | 'villages';
export type PlaceKind = 'city' | 'town' | 'village';

export const PLACE_TIERS: readonly PlaceTier[] = ['major', 'villages'];

export interface Place {
  id: string;
  /** Position Lambert 2008, en mètres. */
  x: number;
  y: number;
  label: string;
  kind: PlaceKind;
  /** Importance : à type égal, le lieu le plus peuplé passe devant. */
  rank: number;
  /** Distance caméra au-delà de laquelle le lieu n'est plus proposé. */
  maxDistance: number;
}

const TIER_FILTER: Record<PlaceTier, string> = {
  major: '^(city|town)$',
  villages: '^village$',
};

const VISIBILITY: Record<PlaceKind, { rank: number; maxDistance: number }> = {
  city: { rank: 3_000_000, maxDistance: Infinity },
  town: { rank: 2_000_000, maxDistance: 80_000 },
  village: { rank: 1_000_000, maxDistance: 14_000 },
};

/** Sortie CSV : dix fois plus compacte que le JSON pour quelques colonnes. */
export const placesQuery = (tier: PlaceTier): string =>
  `[out:csv(::id,::lat,::lon,name,place,population;false)][timeout:60];
area["ISO3166-2"="BE-WAL"]->.wallonia;
node(area.wallonia)["place"~"${TIER_FILTER[tier]}"]["name"];
out;`;

/** Chemin de l'instantané statique d'un palier. */
export const snapshotPath = (tier: PlaceTier): string => `/data/places-${tier}.csv`;

export function parsePlaces(csv: string): Place[] {
  const places: Place[] = [];
  for (const line of csv.split('\n')) {
    const [id, lat, lon, name, kind, population] = line.split('\t');
    if (!id || !name || !kind || !(kind in VISIBILITY)) continue;
    const { x, y } = toLambert(Number(lat), Number(lon));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const { rank, maxDistance } = VISIBILITY[kind as PlaceKind];
    places.push({
      id: `osm:${id}`,
      x: Math.round(x),
      y: Math.round(y),
      label: name,
      kind: kind as PlaceKind,
      rank: rank + Math.min(999_999, Number(population) || 0),
      maxDistance,
    });
  }
  return places;
}
