/**
 * Préchauffe le relief exact : demande au relais, l'une après l'autre et sans jamais le presser, les tuiles
 * que les visiteurs ne devraient pas avoir à attendre. Le relais fait le reste (seize étapes par tuile,
 * quatre tuiles à la fois) ; ce script ne fait que frapper à la porte et repasser.
 *
 *   node scripts/warm-relief.ts <relais> [--niveaux 2-7] [--zones 8-11:600] [--etat <fichier>]
 *
 *   <relais>   http://localhost:8787 (wrangler dev), http://localhost:5173 (Vite, qui relaie) ou https://louy.be
 *   --niveaux  toute la Wallonie, du niveau grossier au fin (défaut 2-7 : tuiles de 65 km à 2 km, ~5 000 tuiles)
 *   --zones    autour de chaque lieu du manifeste des scans, niveaux et rayon en mètres (défaut 8-11:600)
 *   --etat     où se souvenir des tuiles prêtes, pour reprendre (défaut scripts/.relief-prechauffe.json)
 *   --cadence  tuiles entamées par heure, au plus (défaut 120). Chaque tuile coûte au Worker une vingtaine
 *              d'invocations (seize étapes, l'appel, quelques passages) : sur le plan gratuit de Cloudflare,
 *              cent mille par jour, visiteurs compris — 120 tuiles par heure en laissent la moitié libre.
 *
 * Une tuile prête ne coûte plus rien ; une tuile « en préparation » est revérifiée toutes les quinze secondes.
 * Interrompu puis relancé, le script reprend où il en était. Il tourne des heures : lancez-le en arrière-plan
 * (`nohup … &`, ou une tâche launchd / planifiée), à la vitesse que le relais impose.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { EXACT_EDGE_ROOT, EXACT_LEVELS } from '../src/domain/exactRelief.ts';
import { intersectsCoverage, paddedExtent, ROOT_X0, ROOT_Y0, tileSize } from '../src/domain/tiling.ts';

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith('--'))?.replace(/\/$/, '');
if (!base) { console.error('relais manquant : node scripts/warm-relief.ts <relais> [--niveaux 2-7] [--zones 8-11:600]'); process.exit(1); }
const option = (name: string, fallback: string): string => { const at = args.indexOf(`--${name}`); return at === -1 ? fallback : args[at + 1] ?? fallback; };
const range = (text: string): [number, number] => { const [a, b] = text.split('-').map(Number); return [Math.max(EXACT_LEVELS.min, a!), Math.min(EXACT_LEVELS.max, b ?? a!)]; };
const [wideMin, wideMax] = range(option('niveaux', '2-7'));
const [zoneLevels, zoneRadius] = option('zones', '8-11:600').split(':');
const [zoneMin, zoneMax] = range(zoneLevels!);
const radius = Number(zoneRadius ?? 600);
const statePath = option('etat', 'scripts/.relief-prechauffe.json');
const perHour = Math.max(1, Number(option('cadence', '120')));

/** Autant de tuiles que le relais en prépare à la fois : au-delà, il répondrait « en préparation » sans rien faire. */
const LANES = 4;
const POLL_MS = 15_000;
const BETWEEN_MS = 500;
const MODEL = 'MNT';

type Key = string;
const key = (level: number, i: number, j: number): Key => `${level}/${i}/${j}`;

/** Les tuiles d'un niveau dont la marge touche la Wallonie, dans une emprise donnée (ou toute la couverture). */
function tilesOf(level: number, within?: { xmin: number; ymin: number; xmax: number; ymax: number }): Key[] {
  const size = tileSize(level), n = 2 ** level;
  const span = within ?? { xmin: -Infinity, ymin: -Infinity, xmax: Infinity, ymax: Infinity };
  const i0 = Math.max(0, Math.floor((span.xmin - ROOT_X0) / size)), i1 = Math.min(n - 1, Math.floor((span.xmax - ROOT_X0) / size));
  const j0 = Math.max(0, Math.floor((span.ymin - ROOT_Y0) / size)), j1 = Math.min(n - 1, Math.floor((span.ymax - ROOT_Y0) / size));
  const keys: Key[] = [];
  for (let j = Number.isFinite(j0) ? j0 : 0; j <= (Number.isFinite(j1) ? j1 : n - 1); j++) {
    for (let i = Number.isFinite(i0) ? i0 : 0; i <= (Number.isFinite(i1) ? i1 : n - 1); i++) {
      if (intersectsCoverage(paddedExtent({ level, i, j }))) keys.push(key(level, i, j));
    }
  }
  return keys;
}

/** Les lieux du manifeste des scans : chacun vaut une zone à préparer finement. */
function places(): { name: string; x: number; y: number }[] {
  try {
    const manifest = JSON.parse(readFileSync('public/scans/index.json', 'utf8')) as { id: string; x: number; y: number }[];
    return manifest.map((scan) => ({ name: scan.id, x: scan.x, y: scan.y }));
  } catch { return []; }
}

const plan: Key[] = [];
const seen = new Set<Key>();
const push = (k: Key) => { if (!seen.has(k)) { seen.add(k); plan.push(k); } };
// d'abord les lieux, de près : c'est là que l'on regarde ; puis toute la Wallonie, du grossier au fin
for (const place of places()) {
  const within = { xmin: place.x - radius, ymin: place.y - radius, xmax: place.x + radius, ymax: place.y + radius };
  for (let level = zoneMin; level <= zoneMax; level++) for (const k of tilesOf(level, within)) push(k);
}
for (let level = wideMin; level <= wideMax; level++) for (const k of tilesOf(level)) push(k);

const state: { ready: Key[]; refused: Key[] } = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { ready: [], refused: [] };
const ready = new Set(state.ready), refused = new Set(state.refused);
const save = () => writeFileSync(statePath, JSON.stringify({ ready: [...ready], refused: [...refused] }));
const todo = plan.filter((k) => !ready.has(k) && !refused.has(k));
console.log(`${plan.length} tuiles au plan (${places().length} lieux aux niveaux ${zoneMin}-${zoneMax}, Wallonie aux niveaux ${wideMin}-${wideMax}) ; ${ready.size} déjà prêtes, ${todo.length} à préparer, via ${base}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const url = (k: Key) => `${base}${EXACT_EDGE_ROOT}/${MODEL}/${k}.bin`;

/** Frappe à la porte d'une tuile : prête, en préparation, ou refusée. */
async function knock(k: Key): Promise<'ready' | 'preparing' | 'refused'> {
  try {
    const response = await fetch(url(k), { headers: { 'User-Agent': 'louy.be (préchauffage du relief exact)' } });
    await response.arrayBuffer();
    if (response.status === 200) return 'ready';
    if (response.status === 202) return 'preparing';
    if (response.status === 404) return 'refused';
    return 'preparing';
  } catch { return 'preparing'; }
}

const started = Date.now();
let done = 0;
const inFlight = new Map<Key, number>();   // tuile -> instant du dernier passage
let cursor = 0;
while (cursor < todo.length || inFlight.size > 0) {
  // remplir les voies, sans dépasser la cadence
  while (inFlight.size < LANES && cursor < todo.length && (cursor + 1) / Math.max((Date.now() - started) / 3_600_000, 1 / 60) <= perHour) {
    const k = todo[cursor++]!;
    const verdict = await knock(k);
    if (verdict === 'ready') { ready.add(k); done++; }
    else if (verdict === 'refused') refused.add(k);
    else inFlight.set(k, Date.now());
    await sleep(BETWEEN_MS);
  }
  // repasser sur ce qui se prépare
  for (const [k, at] of [...inFlight]) {
    if (Date.now() - at < POLL_MS) continue;
    const verdict = await knock(k);
    if (verdict === 'ready') { inFlight.delete(k); ready.add(k); done++; }
    else if (verdict === 'refused') { inFlight.delete(k); refused.add(k); }
    else inFlight.set(k, Date.now());
    await sleep(BETWEEN_MS);
  }
  if (done > 0 && done % 10 === 0) {
    save();
    const minutes = (Date.now() - started) / 60_000;
    console.log(`${ready.size} prêtes (${done} depuis le départ, ${(done / Math.max(minutes, 0.1)).toFixed(1)} par minute) ; ${todo.length - cursor + inFlight.size} restantes`);
  }
  await sleep(1000);
}
save();
console.log(`fini : ${ready.size} tuiles prêtes, ${refused.size} refusées, en ${((Date.now() - started) / 60_000).toFixed(0)} min`);
