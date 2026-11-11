#!/usr/bin/env node
/**
 * Récolte les sites touristiques de Wallonie dans OpenStreetMap et écrit
 * `public/data/sites.json`, le fichier statique que parcourt la recherche.
 *
 *   npm run sites:harvest
 *
 * Sont retenus les objets nommés qu'un visiteur chercherait : châteaux, musées,
 * points de vue, abbayes, grottes, sites archéologiques, parcs… Chaque site est
 * rattaché à la localité la plus proche, ce qui permet de chercher « Dinant ».
 * Données © contributeurs OpenStreetMap, licence ODbL.
 */

import { writeFile } from 'node:fs/promises';
import { toLambert } from '../src/domain/lambert2008.ts';
import { overpass } from './overpass.mjs';

const OUTPUT = new URL('../public/data/sites.json', import.meta.url);

const SITES_QUERY = `[out:json][timeout:170];
area["ISO3166-2"="BE-WAL"]->.w;
(
  nwr(area.w)["tourism"~"^(attraction|museum|viewpoint|theme_park|zoo|aquarium)$"]["name"];
  nwr(area.w)["historic"~"^(castle|fort|citadel|abbey|monastery|ruins|archaeological_site|battlefield|mine)$"]["name"];
  nwr(area.w)["heritage:operator"="whc"]["name"];
  nwr(area.w)["natural"~"^(cave_entrance|peak)$"]["name"]["wikidata"];
  nwr(area.w)["waterway"="waterfall"]["name"];
  nwr(area.w)["man_made"="tower"]["tower:type"="observation"]["name"];
);
out tags center qt;`;

const PLACES_QUERY = `[out:csv(::lat,::lon,name;false)][timeout:90];
area["ISO3166-2"="BE-WAL"]->.w;
node(area.w)["place"~"^(city|town|village)$"]["name"];
out;`;

/** Catégorie lisible, par ordre de priorité : la première clef reconnue l'emporte. */
const KINDS = [
  ['historic', { castle: 'Château', fort: 'Fort', citadel: 'Citadelle', abbey: 'Abbaye', monastery: 'Abbaye',
    archaeological_site: 'Site archéologique', battlefield: 'Champ de bataille', mine: 'Site minier', ruins: 'Ruines' }],
  ['tourism', { museum: 'Musée', viewpoint: 'Point de vue', theme_park: 'Parc d’attractions', zoo: 'Parc animalier',
    aquarium: 'Aquarium', attraction: 'Attraction' }],
  ['natural', { cave_entrance: 'Grotte', peak: 'Sommet' }],
  ['waterway', { waterfall: 'Cascade' }],
  ['man_made', { tower: 'Tour panoramique' }],
];

const kindOf = (tags) => {
  for (const [key, labels] of KINDS) {
    const label = labels[tags[key]];
    if (label) return label;
  }
  return tags['heritage:operator'] === 'whc' ? 'Patrimoine mondial' : null;
};

const fold = (text) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

console.log('lecture des localités…');
const places = (await overpass(PLACES_QUERY)).split('\n').flatMap((line) => {
  const [lat, lon, name] = line.split('\t');
  return name ? [{ name, ...toLambert(Number(lat), Number(lon)) }] : [];
});
console.log(`  ${places.length} localités`);

const nearestPlace = (x, y) => {
  let best = '', bestDistance = Infinity;
  for (const place of places) {
    const distance = (place.x - x) ** 2 + (place.y - y) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = place.name; }
  }
  return best;
};

console.log('lecture des sites…');
const { elements } = JSON.parse(await overpass(SITES_QUERY));
console.log(`  ${elements.length} objets OpenStreetMap`);

/** Un même lieu est souvent cartographié deux fois (point + contour) : on dédoublonne par maille de 400 m. */
const seen = new Set();
const sites = [];
for (const element of elements) {
  const tags = element.tags ?? {};
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  const kind = kindOf(tags);
  const name = (tags['name:fr'] ?? tags.name ?? '').trim();
  if (!kind || !name || lat === undefined) continue;

  const { x, y } = toLambert(lat, lon);
  const key = `${fold(name)}|${Math.round(x / 400)}|${Math.round(y / 400)}`;
  if (seen.has(key)) continue;
  seen.add(key);

  sites.push({
    id: `${element.type[0]}${element.id}`,
    name,
    kind,
    near: nearestPlace(x, y),
    x: Math.round(x),
    y: Math.round(y),
    notable: Boolean(tags.wikidata || tags.wikipedia),
  });
}

sites.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
await writeFile(OUTPUT, `${JSON.stringify(sites)}\n`);
console.log(`${sites.length} sites écrits (${sites.filter((site) => site.notable).length} notoires)`);
