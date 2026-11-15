#!/usr/bin/env node
/**
 * Récolte l'axe des voies navigables de Wallonie (SPW, couche « Voies » du
 * service VOIESNAVIGABLES) et écrit `public/data/waterways.json`.
 *
 *   npm run waterways:harvest
 *
 * Pourquoi : un bateau à l'arrêt n'annonce pas dans quel sens il est tourné.
 * Le site le couche alors le long de la voie d'eau où il se trouve, ce qui
 * demande de connaître son tracé. Celui-ci ne change pas : il est récolté une
 * fois et publié avec le site.
 */

import { writeFileSync } from 'node:fs';

const SERVICE = 'https://geoservices.wallonie.be/arcgis/rest/services/MOBILITE/VOIESNAVIGABLES/MapServer/4/query';
const params = new URLSearchParams({
  where: '1=1', outFields: 'AXE_NOM', returnGeometry: 'true',
  // Lambert belge 2008, au mètre, simplifié à cinq mètres près
  outSR: '3812', geometryPrecision: '0', maxAllowableOffset: '5', f: 'json',
});

const answer = await fetch(`${SERVICE}?${params}`);
if (!answer.ok) throw new Error(`Voies navigables indisponibles (${answer.status})`);
const { features, error } = await answer.json();
if (error || !Array.isArray(features)) throw new Error(`Réponse inattendue : ${JSON.stringify(error)}`);

const ways = [];
for (const feature of features) {
  const name = String(feature.attributes?.AXE_NOM ?? '').replace(/\s+/g, ' ').trim();
  for (const path of feature.geometry?.paths ?? []) {
    if (path.length >= 2) ways.push({ name, points: path.flat().map(Math.round) });
  }
}
ways.sort((a, b) => a.name.localeCompare(b.name, 'fr') || a.points[0] - b.points[0]);

writeFileSync(new URL('../public/data/waterways.json', import.meta.url), `${JSON.stringify(ways)}\n`);
const vertices = ways.reduce((sum, way) => sum + way.points.length / 2, 0);
console.log(`${ways.length} tronçons, ${vertices} sommets, ${new Set(ways.map((way) => way.name)).size} voies nommées`);
