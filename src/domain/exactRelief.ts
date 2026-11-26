/**
 * Relief exact : le viewer lit les altitudes mesurées par le SPW au lieu de les déduire des tuiles colorées du
 * service, qui n'en donnent que des tranches de 3,5 m — et dont la surface reconstruite entre deux tranches
 * garde des marches, visibles de près comme des lignes crénelées dans les champs. Avec les altitudes mesurées,
 * deux tuiles voisines portent les mêmes valeurs sur leur marge commune : elles se raccordent exactement, à
 * tous les niveaux et sur tout le territoire.
 *
 * Chaque tuile exacte est un fichier de 272 × 272 entiers de 16 bits, première ligne au nord ; l'altitude vaut
 * `valeur × 0,02 − 200` mètres, et zéro dit qu'il n'y a pas de donnée. Deux provenances, même format :
 *
 *   - les tuiles **relevées d'avance** et publiées avec le site (`/relief/<service>/<niveau>/<i>/<j>.bin`), listées
 *     dans `/relief/index.json` : autour des objets scannés ;
 *   - les tuiles **préparées à la demande** par le relais (`/edge/v1/relief/<MNT|MNS>/<niveau>/<i>/<j>.bin`). Le SPW
 *     rend les altitudes mesurées par son interrogation ponctuelle (`identify`). Le relais la lui pose par étapes
 *     de 17 lignes (16 étapes par tuile), chacune dans une invocation à elle : lire d'un coup les 10 Mo que
 *     pèse une tuile entière dépasserait le temps de calcul accordé à une requête. Les étapes s'enchaînent, une
 *     à la fois, et la tuile assemblée est gardée sans fin — une campagne LiDAR datée ne change plus. Tant
 *     qu'elle n'est pas prête, le viewer dessine la tuile du service et revient plus tard.
 */

import { identifyUrl, type AltitudeModel } from './altitudes.ts';
import { intersectsCoverage, isValidAddress, MAX_LEVEL, paddedExtent, REQUEST_PX, tileSpacing, type Extent } from './tiling.ts';

export const EXACT_RELIEF_ROOT = '/relief';
export const EXACT_RELIEF_INDEX = `${EXACT_RELIEF_ROOT}/index.json`;
export const EXACT_EDGE_ROOT = '/edge/v1/relief';
/** Pas de codage des altitudes, et décalage : `z = valeur × EXACT_STEP + EXACT_OFFSET`. */
export const EXACT_STEP = 0.02;
export const EXACT_OFFSET = -200;
/**
 * Niveaux que le relais prépare : du niveau 2 (tuiles de 65 km) au plus fin, ce qui fait que les tuiles se
 * raccordent partout où l'on distingue le sol. Au-dessus, le SPW ne répond plus à l'interrogation ponctuelle
 * (rien au niveau 0, des bribes au niveau 1) : ces deux niveaux, vus de plus de 100 km de haut, gardent l'image.
 */
export const EXACT_LEVELS = { min: 2, max: MAX_LEVEL } as const;
/** Valeurs d'une tuile exacte. */
export const EXACT_COUNT = REQUEST_PX * REQUEST_PX;
/** Une tuile se demande au SPW en autant d'étapes, de `EXACT_STAGE_ROWS` lignes chacune. */
export const EXACT_STAGES = 16;
export const EXACT_STAGE_ROWS = REQUEST_PX / EXACT_STAGES;
/** Valeurs d'une étape. */
export const EXACT_STAGE_COUNT = EXACT_STAGE_ROWS * REQUEST_PX;
/** Seule campagne servie : le service 2013-2014 ne répond qu'au premier point d'une demande groupée. */
const CAMPAIGN = '2021_2022';
/**
 * Emprise de l'image de chaque modèle, telle que le SPW la déclare. Un point demandé au-delà ne reçoit rien, et
 * interrompt la réponse : tous les points suivants restent sans réponse, même ceux qui tombent dans l'image.
 */
export const MODEL_EXTENT: Readonly<Record<AltitudeModel, Extent>> = {
  MNT: { xmin: 542146.5, ymin: 521073.5, xmax: 795501.5, ymax: 668001.5 },
  MNS: { xmin: 542189.5, ymin: 520998.5, xmax: 795501.5, ymax: 667756.5 },
};
/**
 * Révision des tuiles qui débordent de l'emprise de leur modèle. Les premières, préparées avant que les points
 * hors de l'emprise soient écartés, n'avaient que la première ligne de chaque étape : elles sont gardées sans fin
 * dans les caches, d'où une adresse nouvelle. Les tuiles intérieures, justes, gardent la leur.
 */
const EDGE_REVISION = 'b2';

const inside = (e: Extent, x: number, y: number): boolean => x > e.xmin && x < e.xmax && y > e.ymin && y < e.ymax;

/** La tuile élargie de sa marge déborde-t-elle de l'emprise de son modèle ? */
export function crossesEdge(tile: ExactTile): boolean {
  const p = paddedExtent(tile), e = MODEL_EXTENT[tile.model];
  return p.xmin < e.xmin || p.xmax > e.xmax || p.ymin < e.ymin || p.ymax > e.ymax;
}

/** Tuiles relevées d'avance, par service : des clefs « niveau/i/j ». */
export type ExactReliefIndex = ReadonlyMap<string, ReadonlySet<string>>;

/** Lit la liste publiée ; tolérante : ce qui n'a pas la forme attendue est ignoré. */
export function parseExactRelief(payload: unknown): ExactReliefIndex {
  const index = new Map<string, Set<string>>();
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return index;
  for (const [service, keys] of Object.entries(payload as Record<string, unknown>)) {
    if (!/^WALLONIE_(MNT|MNS)_\d{4}_\d{4}$/.test(service) || !Array.isArray(keys)) continue;
    index.set(service, new Set(keys.filter((key): key is string => typeof key === 'string' && /^\d{1,2}\/\d{1,6}\/\d{1,6}$/.test(key))));
  }
  return index;
}

/**
 * Adresse du relief exact d'une tuile : relevé d'avance s'il est publié, sinon préparé par le relais ; `null`
 * pour une campagne que le relais ne sert pas. `service` : « RELIEF/WALLONIE_MNT_2021_2022 ».
 */
export function exactReliefUrl(index: ExactReliefIndex, service: string, level: number, i: number, j: number): string | null {
  const name = service.split('/').pop()!;
  if (index.get(name)?.has(`${level}/${i}/${j}`)) return `${EXACT_RELIEF_ROOT}/${name}/${level}/${i}/${j}.bin`;
  const match = /^WALLONIE_(MNT|MNS)_(\d{4}_\d{4})$/.exec(name);
  if (!match || match[2] !== CAMPAIGN || level < EXACT_LEVELS.min || level > EXACT_LEVELS.max) return null;
  const tile = { model: match[1] as AltitudeModel, level, i, j };
  return `${EXACT_EDGE_ROOT}${exactTilePath(tile).slice(EXACT_RELIEF_ROOT.length)}`;
}

/* ------------------------------------------------------------------------------------- côté relais --- */

export const EXACT_ROUTE = /^\/relief\/(MNT|MNS)\/(\d{1,2})\/(\d{1,6})\/(\d{1,6})(\.b2)?\.bin$/;

export interface ExactTile { model: AltitudeModel; level: number; i: number; j: number }

/**
 * La tuile que désigne un chemin du relais, ou `null` : niveau hors de portée, adresse inexistante, hors de Wallonie,
 * ou révision qui n'est pas la sienne (une seule adresse par tuile, pour ne pas la préparer deux fois).
 */
export function parseExactPath(path: string): ExactTile | null {
  const match = EXACT_ROUTE.exec(path);
  if (!match) return null;
  const tile = { model: match[1] as AltitudeModel, level: Number(match[2]), i: Number(match[3]), j: Number(match[4]) };
  if (tile.level < EXACT_LEVELS.min || tile.level > EXACT_LEVELS.max || !isValidAddress(tile)) return null;
  if (!intersectsCoverage(paddedExtent(tile)) || (match[5] !== undefined) !== crossesEdge(tile)) return null;
  return tile;
}

export const exactTilePath = (tile: ExactTile): string =>
  `/relief/${tile.model}/${tile.level}/${tile.i}/${tile.j}${crossesEdge(tile) ? `.${EDGE_REVISION}` : ''}.bin`;

/** Un nombre au millimètre, sans traîne. */
const mm = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * Les centres des cellules d'une étape de la tuile élargie de sa marge : ses `EXACT_STAGE_ROWS` lignes, du
 * nord au sud, chacune d'ouest en est.
 */
export function exactStagePoints(tile: ExactTile, stage: number): [number, number][] {
  const { xmin, ymax } = paddedExtent(tile);
  const spacing = tileSpacing(tile.level);
  const points: [number, number][] = [];
  for (let row = stage * EXACT_STAGE_ROWS; row < (stage + 1) * EXACT_STAGE_ROWS; row++) {
    const y = mm(ymax - (row + 0.5) * spacing);
    for (let col = 0; col < REQUEST_PX; col++) points.push([mm(xmin + (col + 0.5) * spacing), y]);
  }
  return points;
}

/** Combien des points d'une étape tombent dans l'emprise de l'image de son modèle : tous, certains ou aucun. */
export function stageCoverage(tile: ExactTile, stage: number): 'all' | 'some' | 'none' {
  const points = exactStagePoints(tile, stage), e = MODEL_EXTENT[tile.model];
  const n = points.filter(([x, y]) => inside(e, x, y)).length;
  return n === points.length ? 'all' : n === 0 ? 'none' : 'some';
}

/**
 * La demande au SPW pour une étape : tous ses points à la fois. Le service ne répond qu'aux points qui ont une
 * donnée, dans l'ordre demandé : sans géométrie, la réponse ne se lit que si elle est complète. `withGeometry`
 * fait rendre chaque point avec sa position, pour les étapes qui débordent de la couverture ; seuls y sont
 * demandés les points dans l'emprise de l'image, un point au-delà coupant la réponse.
 * Le corps est écrit directement, sans passer par un objet : c'est ce qui coûte le plus en calcul.
 */
export function exactStageRequest(tile: ExactTile, stage: number, withGeometry = false): { url: string; body: string } {
  const { xmin, ymin, xmax, ymax } = paddedExtent(tile);
  const spacing = tileSpacing(tile.level);
  const image = MODEL_EXTENT[tile.model];
  let geometry = '{"points":[';
  for (let row = stage * EXACT_STAGE_ROWS; row < (stage + 1) * EXACT_STAGE_ROWS; row++) {
    const y = mm(ymax - (row + 0.5) * spacing);
    for (let col = 0; col < REQUEST_PX; col++) {
      const x = mm(xmin + (col + 0.5) * spacing);
      if (!withGeometry || inside(image, x, y)) geometry += `[${x},${y}],`;
    }
  }
  geometry = `${geometry.slice(0, -1)}],"spatialReference":{"wkid":3812}}`;
  const body = `geometry=${encodeURIComponent(geometry)}&geometryType=esriGeometryMultipoint&sr=3812&layers=all&tolerance=1`
    + `&returnGeometry=${withGeometry}&f=json&imageDisplay=400,400,96&mapExtent=${xmin - 5},${ymin - 5},${xmax + 5},${ymax + 5}`;
  return { url: identifyUrl(tile.model), body };
}

/** Une altitude codée sur 16 bits ; 0 pour l'absence de donnée. */
const encode = (z: number): number => (Number.isFinite(z) && z > -100 && z < 1000 ? Math.min(65535, Math.max(1, Math.round((z - EXACT_OFFSET) / EXACT_STEP))) : 0);

const VALUE_MARK = '"Stretch.Pixel Value":"';

/**
 * Une réponse complète du SPW, codée : une valeur par point, dans l'ordre demandé. Lue d'un seul passage, sans
 * en faire un objet. `null` si elle n'a pas autant de résultats que de points — un résultat manquant
 * décalerait tous les suivants.
 */
export function encodeExactValues(text: string, count = EXACT_STAGE_COUNT): Uint16Array | null {
  const values = new Uint16Array(count);
  let found = 0;
  for (let at = text.indexOf(VALUE_MARK); at !== -1; at = text.indexOf(VALUE_MARK, at)) {
    at += VALUE_MARK.length;
    const end = text.indexOf('"', at);
    if (end === -1) return null;
    if (found < count) values[found] = encode(Number(text.slice(at, end)));
    found++;
    at = end;
  }
  return found === count ? values : null;
}

/**
 * La réponse avec géométrie d'une étape, codée en replaçant chaque résultat dans sa cellule : pour les étapes
 * au bord de la couverture, dont des points n'ont rien rendu. Ce qui tombe hors de l'étape est ignoré.
 */
export function encodeExactValuesByPosition(answer: unknown, tile: ExactTile, stage: number): Uint16Array {
  const values = new Uint16Array(EXACT_STAGE_COUNT);
  const results = (answer as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return values;
  const { xmin, ymax } = paddedExtent(tile);
  const spacing = tileSpacing(tile.level);
  for (const result of results as { attributes?: Record<string, unknown>; geometry?: { x?: unknown; y?: unknown } }[]) {
    const x = Number(result?.geometry?.x), y = Number(result?.geometry?.y);
    const col = Math.floor((x - xmin) / spacing), row = Math.floor((ymax - y) / spacing) - stage * EXACT_STAGE_ROWS;
    if (!(col >= 0 && col < REQUEST_PX && row >= 0 && row < EXACT_STAGE_ROWS)) continue;
    values[row * REQUEST_PX + col] = encode(Number(result.attributes?.['Stretch.Pixel Value']));
  }
  return values;
}

/** La tuile entière, ses étapes mises bout à bout dans l'ordre. */
export function assembleExactTile(stages: readonly Uint16Array[]): Uint16Array {
  const tile = new Uint16Array(EXACT_COUNT);
  stages.forEach((values, stage) => tile.set(values.subarray(0, EXACT_STAGE_COUNT), stage * EXACT_STAGE_COUNT));
  return tile;
}
