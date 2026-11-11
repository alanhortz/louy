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
 *
 * — que ce Worker traduit en requête ArcGIS, puis rend avec une durée de vie
 * longue. Une campagne LiDAR datée ne change plus : sa tuile est immuable.
 *
 * Ce n'est pas un proxy ouvert : seuls les services, tailles et adresses de
 * tuiles que le viewer utilise réellement sont acceptés.
 */

import { FLIGHT_CELL, flightDatesUrl } from '../src/domain/acquisition.ts';
import {
  SERVICE_PATTERN, TILE_SIZES, exportUrl, isImmutableService, parseTilePath,
} from '../src/domain/tiles.ts';
import { WALLONIA_EXTENT, isValidAddress, paddedExtent } from '../src/domain/tiling.ts';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface Upstream {
  url: string;
  /** Type attendu : ArcGIS signale ses erreurs en JSON avec un statut 200. */
  contentType: string;
  cacheControl: string;
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

const refusal = (status: number, message: string): Response =>
  new Response(message, { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });

async function relay(request: Request, context: ExecutionContext): Promise<Response> {
  const { origin, pathname } = new URL(request.url);
  const route = pathname.slice(PREFIX.length);
  const upstream = tileUpstream(route) ?? flightsUpstream(route);
  if (!upstream) return refusal(404, 'Ressource inconnue');

  // la clef ignore la chaîne de requête : impossible de fragmenter le cache par des paramètres
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(origin + pathname);
  const cached = await cache.match(key);
  if (cached) return cached;

  const answer = await fetch(upstream.url, { headers: { Accept: upstream.contentType } });
  const type = answer.headers.get('Content-Type') ?? '';
  if (!answer.ok || !type.startsWith(upstream.contentType)) {
    return refusal(502, 'Le Géoportail de la Wallonie n’a pas rendu cette ressource');
  }

  const response = new Response(answer.body, {
    headers: {
      'Content-Type': upstream.contentType,
      'Cache-Control': upstream.cacheControl,
      'Access-Control-Allow-Origin': '*',
      'Timing-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    },
  });
  context.waitUntil(cache.put(key, response.clone()));
  return response;
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    if (!new URL(request.url).pathname.startsWith(`${PREFIX}/`)) return env.ASSETS.fetch(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') return refusal(405, 'Méthode non autorisée');
    return relay(request, context);
  },
};
