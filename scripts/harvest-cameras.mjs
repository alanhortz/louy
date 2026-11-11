#!/usr/bin/env node
/**
 * Récolte les caméras du réseau routier wallon (SPW Trafiroutes) et écrit
 * `public/data/cameras.json`.
 *
 *   npm run cameras:harvest
 *
 * Pourquoi un script : le site Trafiroutes n'envoie aucun en-tête CORS, sa page
 * est donc illisible depuis un navigateur. Les images, elles, se chargent très
 * bien dans une balise `img` — seule la liste pose problème.
 *
 * ## Où est chaque caméra ?
 *
 * Aucune source ne publie leurs coordonnées. Mais chaque image porte, incrusté
 * en haut à gauche, un bandeau du type `A015_SPY_061.400_(+)` : la route, le
 * lieu, et le **point kilométrique**. Le SPW publie par ailleurs les bornes
 * hectométriques de son réseau, avec leurs coordonnées. Le script :
 *
 *   1. lit le bandeau de chaque image (OCR du système, macOS) ;
 *   2. retrouve les deux bornes qui encadrent ce point kilométrique ;
 *   3. interpole entre elles — la caméra est placée à quelques mètres près.
 *
 * Les bandeaux lus sont conservés dans `scripts/camera-stamps.json` : une caméra
 * ne bouge pas, on ne relit donc que les nouvelles, et la récolte reste
 * possible sur une machine sans OCR.
 *
 * En dernier recours — bandeau illisible, route absente du référentiel — la
 * caméra est rattachée à la localité de son libellé et marquée `approximate`.
 * Une direction (« > Namur ») n'est jamais prise pour un emplacement.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const OUTPUT = new URL('../public/data/cameras.json', import.meta.url);
const STAMPS = new URL('./camera-stamps.json', import.meta.url);
const OCR = new URL('./read-stamps.swift', import.meta.url);

const CAMERAS = 'https://trafiroutes.wallonie.be/trafiroutes/cameras/';
const IMAGE = (id) => `https://trafiroutes.wallonie.be/images_uploaded/cameras/${id}.jpg`;
const SPW = 'https://geoservices.wallonie.be/arcgis/rest/services';
const PLACES = `${SPW}/DONNEES_BASE/FDC_SPW_ANNOTATIONS/MapServer`;
/** Bornes hectométriques du réseau routier régional. */
const MARKERS = `${SPW}/MOBILITE/RES_ROUTIER_REGIONAL/MapServer/1/query`;
const USER_AGENT = 'louy-harvest/1.0 (+https://github.com/alanhortz/louy)';

/** Fenêtre de recherche des bornes autour du point kilométrique, en mètres. */
const MARKER_WINDOW = 500;
const CONCURRENCY = 6;

const run = promisify(execFile);

async function request(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response;
}

/** Applique `work` à chaque élément, quelques-uns à la fois : on ménage les services publics. */
async function mapPool(items, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const at = next++;
      results[at] = await work(items[at]);
    }
  }));
  return results;
}

const normalize = (text) =>
  text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z]/g, '');

const decodeEntities = (text) => text
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
  .replace(/&eacute;/g, 'é').replace(/&egrave;/g, 'è').replace(/&agrave;/g, 'à').replace(/&ecirc;/g, 'ê')
  .replace(/&ccedil;/g, 'ç').replace(/&ocirc;/g, 'ô').replace(/&acirc;/g, 'â').replace(/&icirc;/g, 'î').replace(/&nbsp;/g, ' ');

/* ------------------------------------------------------------- la liste --- */

/** { id, label, route } pour chaque caméra ; elles sont groupées par route dans un <legend>. */
async function scrape() {
  const page = await (await request(CAMERAS)).text();
  const cameras = [];
  const groups = /cameraGroupFieldsetLegend">([^<]*)<\/legend>([\s\S]*?)(?=cameraGroupFieldsetLegend"|$)/g;
  for (const [, route, block] of page.matchAll(groups)) {
    for (const [, id, label] of block.matchAll(/cameras\/(\d+)_mini\.jpg"[\s\S]*?cameraLibelle">([^<]+)</g)) {
      cameras.push({ id, label: decodeEntities(label).trim(), route: decodeEntities(route).trim() });
    }
  }
  return cameras;
}

/* ----------------------------------------------------------- le bandeau --- */

/** Lettres que l'OCR confond dans ces bandeaux : le « А » cyrillique, et « O » pour zéro. */
const latin = (text) => text.replaceAll('А', 'A').replaceAll('О', 'O');
const digits = (text) => text.replace(/[Oo]/g, '0');

/** « A15 SPY (> Namur) » → « A015 » : le code de route tel qu'il figure dans un bandeau. */
export function routeCode(label) {
  const match = /^\s*([ANR])\s?(\d{1,3})\b/i.exec(label);
  return match ? `${match[1].toUpperCase()}${match[2].padStart(3, '0')}` : null;
}

/**
 * `A015_SPY_061.400_(+) 10:46:57` → { code: 'A015', place: 'SPY', km: 61.4 }.
 *
 * La lecture tolère ce que l'OCR abîme (séparateurs mangés, « O » pour « 0 »),
 * mais reste stricte sur l'essentiel : le bandeau doit commencer par le code de
 * route attendu d'après le libellé de la caméra. Un bandeau mal lu échoue ici
 * plutôt que de placer une caméra sur la mauvaise route.
 */
export function parseStamp(text, expectedCode) {
  // l'heure (« 10:46:57 ») termine le bandeau : rien d'utile au-delà
  const body = latin(text).trim().split(/\s\(?\d{1,2}:\d{2}/)[0];
  const head = /^([A-Z4])\s?([\dOo]{3})(?=\D|$)/.exec(body);
  const km = /(?:^|[_\s])(\d{1,3})[.,](\d{3})/.exec(body.slice(head?.[0].length ?? 0));
  if (!head || !km) return null;

  // « 4 » est un « A » mal lu : la lettre n'est fiable que si le libellé la confirme
  const code = expectedCode ?? `${head[1]}${digits(head[2])}`;
  if (!/^[ANR]\d{3}$/.test(code) || code.slice(1) !== digits(head[2])) return null;

  const place = body.slice(head[0].length, head[0].length + km.index).replace(/[_\s.]+/g, ' ').trim();
  return { code, place, km: Number(`${km[1]}.${km[2]}`) };
}

/** Lit les bandeaux des caméras données avec l'OCR de macOS ; rend { id: texte }. */
async function readStamps(ids) {
  if (ids.length === 0) return {};
  if (process.platform !== 'darwin') {
    console.warn(`  ${ids.length} bandeaux non lus : l'OCR utilise Vision, disponible sur macOS seulement`);
    return {};
  }
  const directory = await mkdtemp(join(tmpdir(), 'louy-cameras-'));
  try {
    const paths = (await mapPool(ids, async (id) => {
      try {
        const path = join(directory, `${id}.jpg`);
        await writeFile(path, Buffer.from(await (await request(IMAGE(id))).arrayBuffer()));
        return path;
      } catch {
        return null; // caméra hors service : pas d'image aujourd'hui
      }
    })).filter(Boolean);
    const { stdout } = await run('swift', [OCR.pathname, ...paths], { maxBuffer: 1 << 24 });
    return Object.fromEntries(stdout.trim().split('\n').map((line) => {
      const [path, text = ''] = line.split('\t');
      return [path.match(/(\d+)\.jpg$/)[1], text];
    }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/* ------------------------------------------------- du kilomètre au point --- */

/** Interpole la position d'un point kilométrique entre les bornes qui l'encadrent. */
export function interpolate(markers, metres) {
  const sorted = [...markers].sort((a, b) => a.at - b.at);
  const after = sorted.findIndex((marker) => marker.at >= metres);
  if (after === -1) return sorted.at(-1) ?? null;     // au-delà de la dernière borne connue
  if (after === 0) return sorted[0];
  const [a, b] = [sorted[after - 1], sorted[after]];
  const t = (metres - a.at) / (b.at - a.at);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

async function locateOnRoad({ code, km }) {
  const metres = km * 1000;
  // l'axe principal d'une route porte le code du bandeau suivi de « 000 »
  const where = `CODE_ROUTE='${code}000' AND CUMULEE BETWEEN ${metres - MARKER_WINDOW} AND ${metres + MARKER_WINDOW}`;
  const query = new URLSearchParams({ where, outFields: 'CUMULEE', outSR: '3812', f: 'json' });
  const { features = [] } = await (await request(`${MARKERS}?${query}`)).json();
  return interpolate(features.map(({ attributes, geometry }) => ({ at: attributes.CUMULEE, ...geometry })), metres);
}

/* ------------------------------------------- repli : la localité nommée --- */

/** Mots des libellés qui ne désignent pas un lieu. */
const STOP_WORDS = new Set(['ptz', 'autoroute', 'sortie', 'entree', 'vers', 'pont', 'tunnel', 'viaduc', 'ring',
  'echangeur', 'aire', 'bretelle', 'acces', 'nord', 'sud', 'est', 'ouest', 'camera']);

/** Référentiel de lieux du fond de carte SPW : communes et zones d'adresse, en Lambert 2008. */
async function loadPlaces() {
  const places = new Map();
  for (const layer of [4, 6]) {
    const query = new URLSearchParams({ where: '1=1', outFields: 'NAME', returnGeometry: 'true', outSR: '3812', f: 'json' });
    const { features = [] } = await (await request(`${PLACES}/${layer}/query?${query}`)).json();
    for (const { attributes, geometry } of features) {
      const key = attributes?.NAME && normalize(attributes.NAME);
      if (key && geometry && !places.has(key)) places.set(key, { name: attributes.NAME, x: geometry.x, y: geometry.y });
    }
  }
  return places;
}

/** « A15 SPY (> Namur) » est à Spy et regarde vers Namur : on retire la direction. */
const withoutDirection = (label) => label.replace(/\([^)]*[<>][^)]*\)?/g, ' ').replace(/[<>].*$/, ' ');

/**
 * Cherche un lieu dans un texte. Les noms composés — « Grâce-Hollogne » — sont
 * testés en recollant les mots consécutifs ; les noms courts (« Spy », « Huy »)
 * sont de vraies localités, seuls codes de route et mots-outils sont écartés.
 */
function findPlace(text, places) {
  const words = withoutDirection(text).split(/[\s\-/(),.']+/).filter(Boolean);
  for (const size of [4, 3, 2, 1]) {
    for (let at = 0; at + size <= words.length; at++) {
      const group = words.slice(at, at + size);
      if (size === 1 && (group[0].length < 3 || /\d/.test(group[0]) || STOP_WORDS.has(normalize(group[0])))) continue;
      const hit = places.get(normalize(group.join('')));
      if (hit) return hit;
    }
  }
  return null;
}

const titleCase = (text) => text.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toUpperCase());

/* ------------------------------------------------------------- récolte --- */

async function main() {
  console.log('lecture de la liste des caméras…');
  const scraped = await scrape();
  console.log(`  ${scraped.length} caméras`);

  console.log('lecture des bandeaux…');
  const stamps = JSON.parse(await readFile(STAMPS, 'utf8').catch(() => '{}'));
  const read = ({ id, label }) => parseStamp(stamps[id] ?? '', routeCode(label));
  const unread = scraped.filter((camera) => !read(camera)).map((camera) => camera.id);
  Object.assign(stamps, await readStamps(unread));
  // seuls les bandeaux exploitables sont conservés : les autres seront relus à la prochaine récolte
  const known = Object.fromEntries(scraped.filter(read).map(({ id }) => [id, stamps[id]]).sort(([a], [b]) => a - b));
  await writeFile(STAMPS, `${JSON.stringify(known, null, 1)}\n`);
  console.log(`  ${Object.keys(known).length} bandeaux lisibles (${unread.length} lus à l'instant)`);

  console.log('lecture du référentiel de lieux…');
  const places = await loadPlaces();

  console.log('placement sur le réseau routier…');
  const located = await mapPool(scraped, async ({ id, label, route }) => {
    const stamp = read({ id, label });
    const named = findPlace(label, places);
    const point = stamp && await locateOnRoad(stamp).catch(() => null);
    if (point) {
      return {
        id, label, route,
        place: named?.name ?? titleCase(stamp.place),
        x: Math.round(point.x), y: Math.round(point.y),
        km: stamp.km,
        approximate: false,
      };
    }
    return named && { id, label, route, place: named.name, x: Math.round(named.x), y: Math.round(named.y), approximate: true };
  });

  const cameras = located.filter(Boolean);
  if (cameras.length === 0) throw new Error('aucune caméra localisée : la page source a sans doute changé');
  cameras.sort((a, b) => a.route.localeCompare(b.route, 'fr', { numeric: true }) || a.label.localeCompare(b.label, 'fr'));
  await writeFile(OUTPUT, `${JSON.stringify(cameras)}\n`);

  const exact = cameras.filter((camera) => !camera.approximate).length;
  console.log(`${cameras.length}/${scraped.length} caméras écrites : ${exact} au point kilométrique, `
    + `${cameras.length - exact} à la localité`);
  const missing = scraped.filter((camera) => !cameras.some((kept) => kept.id === camera.id));
  if (missing.length) console.log(`non localisées : ${missing.map((camera) => camera.label).join(' · ')}`);
}

// exécuté directement, et non importé par les tests
if (import.meta.url === `file://${process.argv[1]}`) await main();
