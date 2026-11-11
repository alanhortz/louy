#!/usr/bin/env node
/**
 * Enregistre l'instantané des noms de lieux : la réponse Overpass telle quelle,
 * pour chaque palier, dans `public/data/places-<palier>.csv`.
 *
 *   npm run places:harvest
 *
 * Le navigateur affiche cet instantané à la première visite, puis interroge
 * Overpass en direct pour se constituer son propre cache.
 * Données © contributeurs OpenStreetMap, licence ODbL.
 */

import { writeFile } from 'node:fs/promises';
import { PLACE_TIERS, parsePlaces, placesQuery, snapshotPath } from '../src/domain/places.ts';
import { overpass } from './overpass.mjs';

for (const tier of PLACE_TIERS) {
  console.log(`lecture du palier « ${tier} »…`);
  const csv = await overpass(placesQuery(tier));
  const count = parsePlaces(csv).length;
  if (count === 0) throw new Error(`palier « ${tier} » vide : réponse Overpass inattendue`);
  await writeFile(new URL(`../public${snapshotPath(tier)}`, import.meta.url), csv);
  console.log(`  ${count} lieux écrits`);
}
