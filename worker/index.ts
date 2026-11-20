/**
 * Worker Cloudflare : sert le site statique et met en cache, au plus près du
 * visiteur, ce que le viewer demande au Géoportail de la Wallonie.
 *
 * Pourquoi un relais : les services du SPW répondent `Cache-Control: max-age=0`,
 * avec des emprises (bbox) en paramètres. Tels quels, ni le CDN ni le navigateur
 * ne peuvent les conserver. Le viewer demande donc des chemins stables —
 *
 *   /edge/v1/tiles/<service>/<px>/<niveau>/<i>/<j>.<png|jpg>
 *   /edge/v1/flights/<cx>/<cy>.json
 *   /edge/v1/streets/<cx>/<cy>.tsv
 *   /edge/v1/streets/search/<saisie>.json
 *   /edge/v1/cameras/<identifiant>.jpg
 *
 * — que ce Worker traduit en requête ArcGIS, puis rend avec une durée de vie
 * longue. Une campagne LiDAR datée ne change plus : sa tuile est immuable.
 *
 * Il relaie aussi `/edge/v1/aircraft.json`, les avions en vol : la réponse du
 * réseau adsb.fi est gardée quelques secondes, de sorte que le nombre de
 * requêtes vers ce réseau bénévole ne dépende pas du nombre de visiteurs.
 * De même `/edge/v1/aircraft/route/<indicatif>.json`, la liaison que dessert
 * un indicatif, demandée à la base ouverte adsbdb et gardée un jour.
 *
 * Et `/edge/v1/vessels/<décalage>.json`, les bateaux des voies navigables,
 * demandés page par page à EuRIS et gardés une demi-minute.
 *
 * Préchauffage : une tuile de photo aérienne demandée par le film du temps
 * (`?film`) et absente du cache annonce que la même tuile va être demandée à
 * tous les autres millésimes. Le Worker va les chercher sans attendre, en
 * arrière-plan : quand le navigateur y arrive, elles sont déjà là. Le SPW ne
 * reçoit rien de plus que ce que le film lui aurait demandé — seulement plus tôt.
 *
 * Et `/edge/v1/altitudes/<MNT|MNS>/<cx>/<cy>.json`, les altitudes exactes du LiDAR 2021-2022 sur un carré de
 * 16 m, demandées d'un coup au SPW (`identify`) et gardées sans fin (voir src/domain/altitudes.ts).
 *
 * Et `/edge/v1/relief/<MNT|MNS>/<niveau>/<i>/<j>.bin`, le relief exact d'une tuile entière du viewer (272 × 272
 * altitudes, voir src/domain/exactRelief.ts). La première demande reçoit « 202, en préparation » et le Worker
 * prépare la tuile en arrière-plan, par seize étapes qu'il s'adresse à lui-même (`?etape=k`, liaison SELF) : une
 * invocation ne lit qu'un seizième de tuile, ce qui tient dans le temps de calcul du plan gratuit. La tuile
 * assemblée est gardée sans fin. Le viewer, lui, dessine en attendant la tuile du service et revient un peu plus
 * tard. Un marqueur dans le cache fait qu'une tuile n'est jamais préparée deux fois en même temps, et quatre
 * « voies » bornent le nombre de tuiles en préparation à la fois : le SPW n'en reçoit jamais plus. Le marqueur
 * note l'étape due et l'instant du dernier pas : si la chaîne s'arrête, chaque nouvelle demande de la tuile
 * fait un pas de plus, si bien que la préparation aboutit même sans que le Worker parvienne à s'appeler.
 *
 * Enfin `/edge/v1/cameras/<identifiant>.jpg`, l'image d'une caméra routière : Trafiroutes
 * ne permet pas à un navigateur d'en lire les pixels, or le viewer en a besoin pour la
 * poser sur le relief. Elle est gardée deux minutes, la source la renouvelant toutes les six.
 *
 * Ce n'est pas un proxy ouvert : seuls les services, tailles et adresses de
 * tuiles que le viewer utilise réellement sont acceptés.
 */

import { FLIGHT_CELL, flightDatesUrl } from '../src/domain/acquisition.ts';
import { altitudeRequest, compactAltitudes, parseAltitudePath } from '../src/domain/altitudes.ts';
import { assembleExactTile, encodeExactValues, encodeExactValuesByPosition, EXACT_STAGES, exactStageRequest, parseExactPath, type ExactTile } from '../src/domain/exactRelief.ts';
import { AIRCRAFT_CACHE_SECONDS, AIRCRAFT_EDGE_PATH, AIRCRAFT_FEEDS, AIRCRAFT_SOURCE_HEADER } from '../src/domain/aircraft.ts';
import { CAMERA_EDGE_ROUTE, CAMERA_IMAGE_CACHE_SECONDS, cameraSourceUrl } from '../src/domain/cameraView.ts';
import { LATEST_VINTAGE, VINTAGES } from '../src/domain/catalog.ts';
import { VESSEL_CACHE_SECONDS, VESSEL_ROUTE, vesselPageUrl } from '../src/domain/vessels.ts';
import { ROUTE_CACHE_SECONDS, ROUTE_ROUTE, routeUrl } from '../src/domain/flightRoute.ts';
import {
  STREET_CELL, STREET_CELL_CACHE, STREET_EDGE_ROUTE, STREET_SEARCH_CACHE_SECONDS,
  buildStreetCell, streetCellUrl, streetSearchQuery, streetSearchUrl,
} from '../src/domain/streets.ts';
import {
  SERVICE_PATTERN, TILE_SIZES, WARM_FLAG, edgeTileUrl, exportUrl, isImmutableService, parseTilePath, siblingVintages,
} from '../src/domain/tiles.ts';
import { WALLONIA_EXTENT, isValidAddress, paddedExtent } from '../src/domain/tiling.ts';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Le Worker lui-même : chaque étape de préparation du relief exact est une invocation à part. */
  SELF: { fetch(request: Request): Promise<Response> };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface Upstream {
  url: string;
  /** Demande à envoyer en POST (formulaire) plutôt qu'en GET : celles du SPW dépassent la longueur d'une adresse. */
  form?: string;
  /** Sources équivalentes, essayées dans l'ordre quand elles existent ; celle qui répond est nommée dans la réponse. */
  alternatives?: readonly { name: string; url: string }[];
  /** Type attendu : ArcGIS signale ses erreurs en JSON avec un statut 200. */
  contentType: string;
  cacheControl: string;
  /**
   * Réponse à réduire avant de la servir et de la garder : le type rendu au
   * visiteur, et la conversion du corps reçu — `null` s'il n'est pas celui attendu.
   */
  reshape?: { contentType: string; convert(body: string): string | null };
}

const PREFIX = '/edge/v1';

const YEAR = 31_536_000;
const IMMUTABLE = `public, max-age=${YEAR}, immutable`;
/** `ORTHO_LAST` est remplacée chaque année : un jour chez le visiteur, une semaine au CDN. */
const ROLLING = 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000';

const CONTENT_TYPES = { png: 'image/png', jpg: 'image/jpeg' } as const;

function tileUpstream(path: string): Upstream | null {
  const tile = parseTilePath(path);
  if (!tile
      || !SERVICE_PATTERN.test(tile.service)
      || !(TILE_SIZES as readonly number[]).includes(tile.px)
      || !isValidAddress(tile)) return null;
  return {
    url: exportUrl(tile.service, paddedExtent(tile), tile.px, tile.format),
    contentType: CONTENT_TYPES[tile.format],
    cacheControl: isImmutableService(tile.service) ? IMMUTABLE : ROLLING,
  };
}

function flightsUpstream(path: string): Upstream | null {
  const match = /^\/flights\/(\d{1,5})\/(\d{1,5})\.json$/.exec(path);
  if (!match) return null;
  const cx = Number(match[1]);
  const cy = Number(match[2]);
  const inside = cx * FLIGHT_CELL >= WALLONIA_EXTENT.xmin - FLIGHT_CELL && cx * FLIGHT_CELL <= WALLONIA_EXTENT.xmax
    && cy * FLIGHT_CELL >= WALLONIA_EXTENT.ymin - FLIGHT_CELL && cy * FLIGHT_CELL <= WALLONIA_EXTENT.ymax;
  if (!inside) return null;
  return { url: flightDatesUrl({ cx, cy }), contentType: 'application/json', cacheControl: IMMUTABLE };
}

/** Avions en vol : une seule adresse, sans paramètre — rien à valider, rien à détourner. */
function aircraftUpstream(path: string): Upstream | null {
  if (path !== AIRCRAFT_EDGE_PATH) return null;
  return {
    url: AIRCRAFT_FEEDS[0]!.url,
    alternatives: AIRCRAFT_FEEDS,
    contentType: 'application/json',
    cacheControl: `public, max-age=${AIRCRAFT_CACHE_SECONDS}, s-maxage=${AIRCRAFT_CACHE_SECONDS}`,
  };
}

/** Liaison d'un vol : seul un indicatif — lettres capitales et chiffres — entre dans l'adresse demandée. */
function routeUpstream(path: string): Upstream | null {
  const match = ROUTE_ROUTE.exec(path);
  if (!match) return null;
  return {
    url: routeUrl(match[1]!),
    contentType: 'application/json',
    cacheControl: `public, max-age=${ROUTE_CACHE_SECONDS}, s-maxage=${ROUTE_CACHE_SECONDS}`,
  };
}

/** Bateaux des voies navigables : une page de la réponse d'EuRIS, désignée par son décalage — quatre valeurs possibles. */
function vesselsUpstream(path: string): Upstream | null {
  const match = VESSEL_ROUTE.exec(path);
  if (!match) return null;
  return {
    url: vesselPageUrl(Number(match[1])),
    contentType: 'application/json',
    cacheControl: `public, max-age=${VESSEL_CACHE_SECONDS}, s-maxage=${VESSEL_CACHE_SECONDS}`,
  };
}

/** Image d'une caméra routière : seul son numéro entre dans l'adresse demandée. */
function cameraUpstream(path: string): Upstream | null {
  const match = CAMERA_EDGE_ROUTE.exec(path);
  if (!match) return null;
  return {
    url: cameraSourceUrl(match[1]!),
    contentType: 'image/jpeg',
    cacheControl: `public, max-age=${CAMERA_IMAGE_CACHE_SECONDS}, s-maxage=${CAMERA_IMAGE_CACHE_SECONDS}`,
  };
}

/** Altitudes exactes d'un carré de 16 m : la réponse du SPW, réduite aux altitudes en centimètres. */
function altitudeUpstream(path: string): Upstream | null {
  const cell = parseAltitudePath(path);
  if (!cell) return null;
  const { url, body } = altitudeRequest(cell);
  return {
    url,
    form: body,
    contentType: 'application/json',
    cacheControl: IMMUTABLE,
    reshape: {
      contentType: 'application/json',
      convert(text) {
        try { const values = compactAltitudes(JSON.parse(text)); return values && JSON.stringify(values); } catch { return null; }
      },
    },
  };
}

/** Noms de rues d'une dalle : la couche « Rues » d'ICAR, réduite à une ligne par rue. Hors de Wallonie, rien. */
function streetCellUpstream(path: string): Upstream | null {
  const match = STREET_EDGE_ROUTE.exec(path);
  if (!match) return null;
  const cell = { cx: Number(match[1]), cy: Number(match[2]) };
  const inside = (cell.cx + 1) * STREET_CELL > WALLONIA_EXTENT.xmin && cell.cx * STREET_CELL < WALLONIA_EXTENT.xmax
    && (cell.cy + 1) * STREET_CELL > WALLONIA_EXTENT.ymin && cell.cy * STREET_CELL < WALLONIA_EXTENT.ymax;
  if (!inside) return null;
  return {
    url: streetCellUrl(cell),
    contentType: 'application/json',
    cacheControl: STREET_CELL_CACHE,
    reshape: {
      contentType: 'text/tab-separated-values; charset=utf-8',
      convert(body) {
        try { return buildStreetCell(JSON.parse(body), cell); } catch { return null; }
      },
    },
  };
}

/** Recherche de rues : le géocodeur du SPW, pour une saisie sous sa forme canonique seulement. */
function streetSearchUpstream(path: string): Upstream | null {
  const query = streetSearchQuery(path);
  if (!query) return null;
  return {
    url: streetSearchUrl(query),
    contentType: 'application/json',
    cacheControl: `public, max-age=${STREET_SEARCH_CACHE_SECONDS}, s-maxage=${STREET_SEARCH_CACHE_SECONDS}`,
  };
}

const refusal = (status: number, message: string): Response =>
  new Response(message, { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });

/* ------------------------------------------------------------------------------------- relief exact --- */

/**
 * Durée du marqueur « en préparation » et de la voie qu'il occupe, renouvelée à chaque étape : une chaîne vivante
 * garde sa place, une chaîne morte la rend au bout de ce délai, et la préparation reprend là où elle en était.
 */
const PREPARING_SECONDS = 90;
/** Au-delà, le SPW ne répondra plus utilement : l'étape est abandonnée plutôt que de retenir sa voie. */
const IDENTIFY_TIMEOUT_MS = 25_000;
/** Ce que le viewer attend avant de redemander une tuile en préparation. */
const RETRY_AFTER_SECONDS = 15;
/** Paramètre d'une étape de préparation, que le Worker s'adresse à lui-même. */
const STAGE_FLAG = 'etape';
/** Une étape faite est gardée le temps d'assembler sa tuile ; la tuile, elle, l'est sans fin. */
const STAGE_CACHE = 'public, max-age=86400';
/**
 * Voies de préparation : autant de tuiles au plus se préparent en même temps (par point de présence). Une vue
 * neuve en demande cent d'un coup ; sans cela, le SPW recevrait autant de chaînes d'appels à la fois. Les tuiles
 * sans voie libre reçoivent « en préparation » sans que rien ne parte : le viewer les redemandera, et une voie
 * se sera libérée. Une voie se libère quand sa tuile est assemblée, ou d'elle-même passé PREPARING_SECONDS.
 */
const LANES = 4;
const LANE_FLAG = 'voie';

const accepted = (): Response => new Response(null, {
  status: 202,
  headers: { 'Cache-Control': 'no-store', 'Retry-After': String(RETRY_AFTER_SECONDS), 'Access-Control-Allow-Origin': '*' },
});
const done = (): Response => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

const binary = (values: Uint16Array, cacheControl: string): Response => new Response(values.buffer as ArrayBuffer, {
  headers: {
    'Content-Type': 'application/octet-stream',
    'Cache-Control': cacheControl,
    'Access-Control-Allow-Origin': '*',
    'Timing-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  },
});

const stageRequest = (origin: string, route: string, stage: number, lane: number): Request =>
  new Request(`${origin}${PREFIX}${route}?${STAGE_FLAG}=${stage}&${LANE_FLAG}=${lane}`);
/** La clef d'une voie dans le cache : un chemin que le relais ne sert jamais. */
const laneKey = (origin: string, lane: number): Request => new Request(`${origin}${PREFIX}/relief/voie/${lane}`);
/** L'étape, hors voie : la clef sous laquelle ses valeurs sont gardées ne dépend pas de la voie empruntée. */
const stageKey = (origin: string, route: string, stage: number): Request => new Request(`${origin}${PREFIX}${route}?${STAGE_FLAG}=${stage}`);

/** Un appel `identify` au SPW ; `null` s'il n'a pas répondu normalement. */
async function identify(request: { url: string; body: string }): Promise<string | null> {
  try {
    const answer = await fetch(request.url, {
      method: 'POST', body: request.body, headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(IDENTIFY_TIMEOUT_MS),
    });
    if (!answer.ok) return null;
    const text = await answer.text();
    return text.startsWith('{"results"') ? text : null;
  } catch { return null; }
}

/** Où en est une tuile en préparation : sa voie, l'étape due, et l'instant du dernier pas. */
interface Preparing { lane: number; next: number; at: number }

const markerKey = (origin: string, route: string): Request => new Request(`${origin}${PREFIX}${route}?preparation`);

/**
 * Une chaîne qui n'a pas fait de pas depuis ce délai est tenue pour arrêtée (une étape dure au plus
 * IDENTIFY_TIMEOUT_MS) : la prochaine demande de la tuile fait alors elle-même l'étape due. La préparation ne
 * dépend ainsi pas seulement du Worker qui s'appelle lui-même : chaque visiteur, chaque passage du préchauffeur
 * la fait avancer d'un pas si elle s'est arrêtée.
 */
const STALL_MS = 30_000;

/** Pose ou renouvelle le marqueur d'une tuile en préparation et sa voie, pour PREPARING_SECONDS, en notant l'étape due. */
async function holdLane(origin: string, route: string, lane: number, next: number, cache: Cache): Promise<void> {
  const hold = (body: string) => new Response(body, { headers: { 'Cache-Control': `public, max-age=${PREPARING_SECONDS}` } });
  await cache.put(laneKey(origin, lane), hold(route));
  await cache.put(markerKey(origin, route), hold(JSON.stringify({ lane, next, at: Date.now() } satisfies Preparing)));
}

/** Le marqueur d'une tuile, s'il est là et lisible. */
async function preparing(origin: string, route: string, cache: Cache): Promise<Preparing | null> {
  const kept = await cache.match(markerKey(origin, route));
  if (!kept) return null;
  try {
    const state = JSON.parse(await kept.text()) as Partial<Preparing>;
    return Number.isInteger(state.lane) && Number.isInteger(state.next) && Number.isFinite(state.at) ? state as Preparing : null;
  } catch { return null; }
}

/** Rend la voie et retire le marqueur : la préparation s'arrête là, la tuile pourra repartir aussitôt. */
async function release(origin: string, route: string, lane: number, cache: Cache): Promise<void> {
  await cache.delete(laneKey(origin, lane));
  await cache.delete(markerKey(origin, route));
}

/**
 * Les valeurs d'une étape : du cache si elle est faite, sinon demandées au SPW et rangées. Un appel ; un second,
 * avec la position de chaque point, seulement au bord de la couverture, où la première réponse est incomplète.
 * `null` si le SPW n'a pas répondu.
 */
async function stageValues(tile: ExactTile, stage: number, key: Request, cache: Cache): Promise<Uint16Array | null> {
  const kept = await cache.match(key);
  if (kept) return new Uint16Array(await kept.arrayBuffer());
  const whole = await identify(exactStageRequest(tile, stage));
  if (whole === null) return null;
  let values = encodeExactValues(whole);
  if (!values) {
    const placed = await identify(exactStageRequest(tile, stage, true));
    if (placed === null) return null;
    try { values = encodeExactValuesByPosition(JSON.parse(placed), tile, stage); } catch { return null; }
  }
  await cache.put(key, binary(values, STAGE_CACHE));
  return values;
}

/**
 * Une étape de la préparation d'une tuile, dans une invocation à elle : ses valeurs, puis l'étape suivante, que
 * le Worker se demande à lui-même ; la dernière assemble la tuile. Chaque invocation ne lit ainsi qu'un
 * seizième de tuile, ce qui tient dans le temps de calcul accordé à une requête.
 */
async function reliefStage(tile: ExactTile, stage: number, lane: number, origin: string, route: string, cache: Cache, env: Env, context: ExecutionContext): Promise<Response> {
  // la chaîne fait un pas : elle garde sa voie et son marqueur, qui disent l'étape en cours
  await holdLane(origin, route, lane, stage, cache);
  const values = await stageValues(tile, stage, stageKey(origin, route, stage), cache);
  if (!values) {
    // la chaîne s'arrête ; la tuile, redemandée, reprendra là où elle en était : ses étapes faites sont gardées
    await release(origin, route, lane, cache);
    return refusal(502, 'Le SPW n’a pas rendu cette étape du relief');
  }
  const onward = async (next: number) => {
    await holdLane(origin, route, lane, next, cache);
    context.waitUntil(env.SELF.fetch(stageRequest(origin, route, next, lane)));
    return done();
  };
  if (stage + 1 < EXACT_STAGES) return onward(stage + 1);
  const stages: Uint16Array[] = [];
  for (let k = 0; k < EXACT_STAGES; k++) {
    if (k === stage) { stages.push(values); continue; }
    const kept = await cache.match(stageKey(origin, route, k));
    // une étape sortie du cache entre-temps : on la refait, et la chaîne repassera par ici
    if (!kept) return onward(k);
    stages.push(new Uint16Array(await kept.arrayBuffer()));
  }
  await cache.put(new Request(origin + PREFIX + route), binary(assembleExactTile(stages), IMMUTABLE));
  await release(origin, route, lane, cache);
  return done();
}

/**
 * Le relief exact d'une tuile : servi du cache quand il y est ; sinon « en préparation », et la première étape
 * part en arrière-plan — une fois : un marqueur, lui aussi dans le cache, retient que la préparation est en cours.
 */
async function reliefRelay(route: string, url: URL, cache: Cache, env: Env, context: ExecutionContext): Promise<Response | null> {
  const tile = parseExactPath(route);
  if (!tile) return null;
  const { origin } = url;
  const stage = url.searchParams.get(STAGE_FLAG);
  if (stage !== null) {
    const k = Number(stage), lane = Number(url.searchParams.get(LANE_FLAG));
    if (!Number.isInteger(k) || k < 0 || k >= EXACT_STAGES || !Number.isInteger(lane) || lane < 0 || lane >= LANES) return refusal(404, 'Étape inconnue');
    return reliefStage(tile, k, lane, origin, route, cache, env, context);
  }
  const ready = await cache.match(new Request(origin + PREFIX + route));
  if (ready) return ready;
  // déjà en préparation : la chaîne avance d'elle-même ; arrêtée, cette demande fait l'étape due
  const state = await preparing(origin, route, cache);
  if (state) {
    if (Date.now() - state.at > STALL_MS) context.waitUntil(reliefStage(tile, state.next, state.lane, origin, route, cache, env, context));
    return accepted();
  }
  // une voie libre, sinon rien ne part : la tuile attendra d'être redemandée
  let lane = -1;
  for (let k = 0; k < LANES && lane === -1; k++) if (!(await cache.match(laneKey(origin, k)))) lane = k;
  if (lane === -1) return accepted();
  // la première étape se fait dans cette invocation même ; les suivantes s'enchaînent de l'une à l'autre
  await holdLane(origin, route, lane, 0, cache);
  context.waitUntil(reliefStage(tile, 0, lane, origin, route, cache, env, context));
  return accepted();
}

/**
 * Demande une ressource à sa source ; `null` si la réponse n'est pas celle attendue. `refusals` recueille alors
 * ce que la source a répondu : sans journal sous la main, c'est la seule façon de savoir pourquoi elle refuse.
 */
async function fetchUpstream(upstream: Upstream, refusals: string[] = []): Promise<Response | null> {
  if (upstream.alternatives) {
    for (const { name, url } of upstream.alternatives) {
      const { alternatives: _others, ...single } = upstream;
      const tried: string[] = [];
      const response = await fetchUpstream({ ...single, url }, tried).catch((error: unknown) => { tried.push(String(error)); return null; });
      if (response) { response.headers.set(AIRCRAFT_SOURCE_HEADER, name); return response; }
      refusals.push(`${name} : ${tried.join(' ') || 'réponse illisible'}`);
    }
    return null;
  }
  const answer = await fetch(upstream.url, upstream.form
    ? { method: 'POST', body: upstream.form, headers: { Accept: upstream.contentType, 'Content-Type': 'application/x-www-form-urlencoded' } }
    : { headers: { Accept: upstream.contentType } });
  const type = answer.headers.get('Content-Type') ?? '';
  if (!answer.ok || !type.startsWith(upstream.contentType)) {
    refusals.push(`statut ${answer.status}, type ${type || 'absent'}`);
    return null;
  }
  const body = upstream.reshape ? upstream.reshape.convert(await answer.text()) : answer.body;
  if (body === null) return null;
  return new Response(body, {
    headers: {
      'Content-Type': upstream.reshape?.contentType ?? upstream.contentType,
      'Cache-Control': upstream.cacheControl,
      'Access-Control-Allow-Origin': '*',
      'Timing-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Millésimes datés : ceux que le film du temps parcourt. */
const FILM_SUFFIXES = VINTAGES.filter((vintage) => vintage.id !== LATEST_VINTAGE).map((vintage) => vintage.suffix);
const siblingPath = edgeTileUrl('');

/**
 * Va chercher la même tuile aux autres millésimes et la range dans le cache.
 * L'une après l'autre : une tuile ne pèse jamais plus d'une requête à la fois
 * sur le SPW, et l'ensemble reste sous le plafond de sous-requêtes d'un Worker.
 */
async function warmSiblings(cache: Cache, origin: string, route: string): Promise<void> {
  const tile = parseTilePath(route);
  if (!tile) return;
  for (const service of siblingVintages(tile.service, FILM_SUFFIXES)) {
    const path = siblingPath({ ...tile, service });
    const upstream = tileUpstream(path);
    if (!upstream) continue;
    try {
      const response = await fetchUpstream(upstream);
      if (response) await cache.put(new Request(origin + PREFIX + path), response);
    } catch { /* un millésime manqué sera simplement demandé plus tard, par le chemin ordinaire */ }
  }
}

async function relay(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const { origin, pathname, searchParams } = url;
  const route = pathname.slice(PREFIX.length);
  const cache = (caches as unknown as { default: Cache }).default;
  const exact = await reliefRelay(route, url, cache, env, context);
  if (exact) return exact;
  const upstream = tileUpstream(route) ?? flightsUpstream(route) ?? aircraftUpstream(route) ?? routeUpstream(route)
    ?? streetCellUpstream(route) ?? streetSearchUpstream(route) ?? vesselsUpstream(route) ?? cameraUpstream(route) ?? altitudeUpstream(route);
  if (!upstream) return refusal(404, 'Ressource inconnue');

  // la clef ignore la chaîne de requête : impossible de fragmenter le cache par des paramètres
  const key = new Request(origin + pathname);
  const cached = await cache.match(key);
  // déjà en cache : ses millésimes voisins ont été préparés avec elle
  if (cached) return cached;

  const refusals: string[] = [];
  const response = await fetchUpstream(upstream, refusals);
  if (!response) return refusal(502, `La source n’a pas rendu cette ressource (${refusals.join(' ; ') || 'réponse inattendue'})`);

  context.waitUntil(cache.put(key, response.clone()));
  if (searchParams.has(WARM_FLAG)) context.waitUntil(warmSiblings(cache, origin, route));
  return response;
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    if (!new URL(request.url).pathname.startsWith(`${PREFIX}/`)) return env.ASSETS.fetch(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') return refusal(405, 'Méthode non autorisée');
    return relay(request, env, context);
  },
};
