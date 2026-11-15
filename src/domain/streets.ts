/**
 * Rues de Wallonie, d'après ICAR, l'inventaire officiel des rues et des
 * adresses du Service public de Wallonie.
 *
 * Deux services du Géoportail y répondent, tous deux dans le repère du site
 * (Lambert belge 2008) :
 *  - le géocodeur, pour la recherche : une saisie, des rues candidates ;
 *  - la couche « Rues », pour le calque : le tracé et le nom de chaque rue
 *    d'une emprise.
 *
 * Aucun des deux n'est appelé directement par le navigateur : le relais du
 * site les interroge et garde leurs réponses, de sorte qu'une même recherche
 * ou une même dalle ne soit demandée au SPW qu'une fois, quel que soit le
 * nombre de visiteurs.
 */

export const STREET_SOURCE = 'SPW · ICAR';

/** Une rue trouvée : son nom, sa localité, et où s'y rendre. */
export interface Street { id: string; name: string; near: string; x: number; y: number }

/* ------------------------------------------------------------ recherche --- */

/** En deçà, une saisie désigne des milliers de rues : on attend qu'elle se précise. */
export const MIN_STREET_QUERY = 3;
const MAX_STREET_QUERY = 60;
export const MAX_STREET_RESULTS = 20;

/**
 * La saisie telle qu'elle part au relais : minuscules, espaces simples, sans
 * autre signe que ceux d'un nom de rue. Deux saisies équivalentes donnent la
 * même forme, donc la même entrée de cache ; `null` si elle est trop courte.
 */
export function streetQuery(input: string): string | null {
  const clean = input.toLowerCase().normalize('NFC')
    .replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_STREET_QUERY).trim();
  return clean.length >= MIN_STREET_QUERY ? clean : null;
}

/** Chemin du relais pour une recherche, sous le préfixe `edge` : la saisie est dans le chemin, pas en paramètre. */
export const STREET_SEARCH_ROUTE = /^\/streets\/search\/([^/]{1,400})\.json$/;
export const streetSearchEdgePath = (query: string): string => `/streets/search/${encodeURIComponent(query)}.json`;

/** La saisie que désigne un chemin du relais ; `null` s'il n'est pas sous sa forme canonique. */
export function streetSearchQuery(path: string): string | null {
  const match = STREET_SEARCH_ROUTE.exec(path);
  if (!match) return null;
  let raw: string;
  try { raw = decodeURIComponent(match[1]!); } catch { return null; }
  return streetQuery(raw) === raw ? raw : null;
}

const GEOCODER = 'https://geoservices.wallonie.be/geocodeWS';
/** Niveau « rue » du géocodeur : ni commune, ni adresse. */
const STREET_LEVEL = 3;

export function streetSearchUrl(query: string): string {
  const params = new URLSearchParams({ address: query, levels: String(STREET_LEVEL), bbox: 'true', crs: 'EPSG:3812' });
  return `${GEOCODER}/searchAll?${params}`;
}

/** Une recherche se garde une semaine : une rue ne change pas de place. */
export const STREET_SEARCH_CACHE_SECONDS = 7 * 86_400;

/**
 * Lecture tolérante d'une réponse du géocodeur. Un candidat se nomme
 * « Rue des Brasseurs 5000 Namur » : le nom, le code postal, la localité ; son
 * emprise donne le point où se rendre.
 */
export function parseStreetSearch(payload: unknown): Street[] {
  const candidates = (payload as { candidates?: unknown } | null)?.candidates;
  if (!Array.isArray(candidates)) return [];
  const streets = new Map<string, Street>();
  for (const candidate of candidates as { geotag?: { ident?: unknown; level?: unknown; name?: unknown; bbox?: unknown } }[]) {
    const tag = candidate?.geotag;
    if (!tag || tag.level !== STREET_LEVEL || typeof tag.name !== 'string' || !Array.isArray(tag.bbox)) continue;
    const [x0, y0, x1, y1] = tag.bbox as number[];
    const x = Math.round((x0! + x1!) / 2);
    const y = Math.round((y0! + y1!) / 2);
    const named = /^(.+?)\s+(\d{4})\s+(.+)$/.exec(tag.name.trim());
    if (!named || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const street = { id: `${String(tag.ident)}|${named[3]}`, name: named[1]!, near: `${named[2]} ${named[3]}`, x, y };
    if (!streets.has(street.id)) streets.set(street.id, street);
    if (streets.size === MAX_STREET_RESULTS) break;
  }
  return [...streets.values()];
}

/* -------------------------------------------------------------- calque --- */

/** Côté d'une dalle d'étiquettes, en mètres. */
export const STREET_CELL = 2000;
/** Éloignement de la caméra au-delà duquel les noms de rues ne sont plus proposés. */
export const STREET_MAX_DISTANCE = 1800;

export interface StreetCell { cx: number; cy: number }

export const streetCellAt = (x: number, y: number): StreetCell =>
  ({ cx: Math.floor(x / STREET_CELL), cy: Math.floor(y / STREET_CELL) });

export const streetCellKey = ({ cx, cy }: StreetCell): string => `${cx}_${cy}`;

/** Les neuf dalles autour d'un point : de quoi couvrir la vue à la distance où les noms s'affichent. */
export function streetCellsAround(x: number, y: number): StreetCell[] {
  const { cx, cy } = streetCellAt(x, y);
  const cells: StreetCell[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cells.push({ cx: cx + dx, cy: cy + dy });
  return cells;
}

/**
 * Une étiquette de rue, posée sur la carte. `rank` : 3 = grand axe, 0 = desserte.
 * `curve` : le tracé de la rue de part et d'autre de l'étiquette, en mètres
 * relatifs à son point (x, y, x, y…) — la ligne que le nom doit épouser.
 */
export interface StreetLabel { id: string; label: string; x: number; y: number; rank: number; curve: number[]; maxDistance: number }

/** Tracé d'une étiquette : des paires de mètres ; abîmé ou absent, il se réduit à un trait horizontal. */
function parseCurve(text: string | undefined): number[] {
  const values = (text ?? '').split(/[ ,]/).map(Number);
  return values.length >= 4 && values.length % 2 === 0 && values.every(Number.isFinite) ? values : [-CURVE_REACH, 0, CURVE_REACH, 0];
}

/** Lit une dalle telle que le relais la sert : une ligne par rue — nom, position, importance, tracé. */
export function parseStreetCell(tsv: string, cell: StreetCell): StreetLabel[] {
  const labels: StreetLabel[] = [];
  for (const line of tsv.split('\n')) {
    const [name, x, y, rank, curve] = line.split('\t');
    if (!name) continue;
    const label = {
      id: `${streetCellKey(cell)}:${name}`, label: name, x: Number(x), y: Number(y), rank: Number(rank) || 0, curve: parseCurve(curve),
      maxDistance: STREET_MAX_DISTANCE,
    };
    if (Number.isFinite(label.x) && Number.isFinite(label.y)) labels.push(label);
  }
  return labels;
}

/* ------------------------------------------------- dalles par le relais --- */

/** Chemin du relais pour une dalle, sous le préfixe `edge`. */
export const STREET_EDGE_ROUTE = /^\/streets\/(\d{1,4})\/(\d{1,4})\.tsv$/;
export const streetEdgePath = ({ cx, cy }: StreetCell): string => `/streets/${cx}/${cy}.tsv`;

const ICAR_STREETS = 'https://geoservices.wallonie.be/arcgis/rest/services/DONNEES_BASE/ICAR_ADR_PT/MapServer/4/query';

/** Requête à la couche « Rues » : les rues en vigueur qui touchent une dalle, tracé arrondi au mètre. */
export function streetCellUrl({ cx, cy }: StreetCell): string {
  const x0 = cx * STREET_CELL, y0 = cy * STREET_CELL;
  const params = new URLSearchParams({
    where: "RUE_VALIDE='O'",
    geometry: `${x0},${y0},${x0 + STREET_CELL},${y0 + STREET_CELL}`,
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    inSR: '3812',
    outSR: '3812',
    outFields: 'RUE_NM',
    returnGeometry: 'true',
    geometryPrecision: '0',
    f: 'json',
  });
  return `${ICAR_STREETS}?${params}`;
}

/** Une dalle de rues change peu : un jour chez le visiteur, un mois au CDN. */
export const STREET_CELL_CACHE = 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=2592000';

/** Longueur de tracé, dans la dalle, à partir de laquelle une rue gagne un rang d'importance. */
const RANK_LENGTHS = [250, 600, 1200];
/** Pas de découpe d'un tracé, en mètres. */
const TRACE_STEP = 100;
/** Tracé gardé pour une étiquette : cette longueur de part et d'autre de son point, un sommet tous les `CURVE_STEP` mètres. */
const CURVE_REACH = 250;
const CURVE_STEP = 50;

/** Un point du tracé d'une rue : où, sur quel chemin, et à quelle abscisse le long de ce chemin. */
interface Sample { x: number; y: number; path: number[][]; arc: number }
interface Trace { length: number; samples: Sample[] }

/** Le point d'un chemin à une abscisse donnée ; au-delà de ses bouts, le chemin est prolongé tout droit. */
function alongPath(path: number[][], arc: number): [number, number] {
  let from = 0;
  for (let at = 1; at < path.length; at++) {
    const [ax, ay] = path[at - 1]!, [bx, by] = path[at]!;
    const length = Math.hypot(bx! - ax!, by! - ay!);
    // le dernier segment sert aussi à prolonger au-delà de la fin ; le premier, en deçà du début
    if (length > 0 && (arc <= from + length || at === path.length - 1)) {
      const t = (arc - from) / length;
      return [ax! + (bx! - ax!) * t, ay! + (by! - ay!) * t];
    }
    from += length;
  }
  return [path[0]![0]!, path[0]![1]!];
}

/**
 * Réduit la réponse d'ICAR à la dalle telle que le calque la lit : une ligne par
 * rue — nom, position, importance, tracé. L'étiquette se pose sur le tracé, au
 * plus près du milieu de ce que la dalle en contient, et garde le bout de rue
 * qui l'entoure pour que le nom puisse en suivre la courbe. L'importance se
 * déduit de la longueur du tracé, ICAR ne classant pas ses rues. `null` si la
 * réponse n'est pas celle attendue.
 */
export function buildStreetCell(payload: unknown, cell: StreetCell): string | null {
  const features = (payload as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return null;
  const x0 = cell.cx * STREET_CELL, y0 = cell.cy * STREET_CELL;
  const inside = (x: number, y: number) => x >= x0 && x < x0 + STREET_CELL && y >= y0 && y < y0 + STREET_CELL;

  const streets = new Map<string, Trace>();
  for (const feature of features as { attributes?: { RUE_NM?: unknown }; geometry?: { paths?: unknown } }[]) {
    const name = typeof feature?.attributes?.RUE_NM === 'string' ? feature.attributes.RUE_NM.replace(/\s+/g, ' ').trim() : '';
    const paths = feature?.geometry?.paths;
    if (!name || !Array.isArray(paths)) continue;
    const trace = streets.get(name) ?? { length: 0, samples: [] };
    for (const path of paths as number[][][]) {
      let arc = 0;
      for (let at = 1; at < path.length; at++) {
        const [ax, ay] = path[at - 1]!, [bx, by] = path[at]!;
        const length = Math.hypot(bx! - ax!, by! - ay!);
        // découpé en pas courts : seule la part du tracé qui est dans la dalle compte,
        // même pour un long segment dont les deux bouts sont dehors
        const steps = Math.max(1, Math.ceil(length / TRACE_STEP));
        for (let step = 0; step < steps; step++) {
          const t = (step + 0.5) / steps;
          const x = ax! + (bx! - ax!) * t, y = ay! + (by! - ay!) * t;
          if (!inside(x, y)) continue;
          trace.length += length / steps;
          trace.samples.push({ x, y, path, arc: arc + length * t });
        }
        arc += length;
      }
    }
    if (trace.samples.length > 0) streets.set(name, trace);
  }

  const rows = [...streets].map(([name, { length, samples }]) => {
    const mx = samples.reduce((sum, p) => sum + p.x, 0) / samples.length;
    const my = samples.reduce((sum, p) => sum + p.y, 0) / samples.length;
    const at = samples.reduce((best, p) => ((p.x - mx) ** 2 + (p.y - my) ** 2 < (best.x - mx) ** 2 + (best.y - my) ** 2 ? p : best));
    const x = Math.round(at.x), y = Math.round(at.y);
    const curve: string[] = [];
    for (let offset = -CURVE_REACH; offset <= CURVE_REACH; offset += CURVE_STEP) {
      const [px, py] = alongPath(at.path, at.arc + offset);
      curve.push(`${Math.round(px - x)},${Math.round(py - y)}`);
    }
    const rank = RANK_LENGTHS.filter((limit) => length >= limit).length;
    return `${name}\t${x}\t${y}\t${rank}\t${curve.join(' ')}`;
  }).sort((a, b) => a.localeCompare(b, 'fr'));
  return rows.length === 0 ? '' : `${rows.join('\n')}\n`;
}
