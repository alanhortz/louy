/**
 * Adresses des tuiles.
 *
 * Deux chemins mènent à la même image :
 *  - `direct` interroge l'`export` ArcGIS du SPW avec une emprise (bbox) ;
 *  - `edge` passe par un chemin stable `/edge/v1/tiles/<service>/<px>/<L>/<i>/<j>.<ext>`
 *    que le Worker Cloudflare traduit en bbox. Un chemin sans paramètre, identique
 *    pour tous les visiteurs, est ce qui rend la tuile cachable par le CDN — les
 *    services du SPW répondent `max-age=0`.
 */

import { paddedExtent, type Extent, type TileAddress } from './tiling.ts';

export const SPW_ARCGIS = 'https://geoservices.wallonie.be/arcgis/rest/services';

export type TileFormat = 'png' | 'jpg';

/** Tailles d'image admises : la grille, ou la grille suréchantillonnée ×2. */
export const TILE_SIZES = [272, 544] as const;

/** Services que le Worker accepte de relayer (jamais un proxy ouvert). */
export const SERVICE_PATTERN =
  /^(RELIEF\/WALLONIE_(MNT|MNS)_(2013_2014|2021_2022)(_HILLSHADE)?|IMAGERIE\/ORTHO_[0-9A-Z_]{4,24})$/;

/** Un service daté ne change plus jamais ; `ORTHO_LAST` est remplacé chaque année. */
export const isImmutableService = (service: string): boolean => !service.includes('ORTHO_LAST');

/** URL `export` ArcGIS pour une emprise Lambert 2008. */
export function exportUrl(service: string, extent: Extent, px: number, format: TileFormat): string {
  const query = new URLSearchParams({
    bbox: `${extent.xmin},${extent.ymin},${extent.xmax},${extent.ymax}`,
    bboxSR: '3812',
    imageSR: '3812',
    size: `${px},${px}`,
    format: format === 'png' ? 'png32' : 'jpg',
    f: 'image',
    transparent: 'true',
  });
  return `${SPW_ARCGIS}/${service}/MapServer/export?${query}`;
}

export interface TileRequest extends TileAddress {
  service: string;
  px: number;
  format: TileFormat;
  /** Demande au relais de préparer aussi cette tuile aux autres millésimes (film du temps). */
  warm?: boolean;
}

export type TileUrlBuilder = (request: TileRequest) => string;

export const directTileUrl: TileUrlBuilder = (request) =>
  exportUrl(request.service, paddedExtent(request), request.px, request.format);

/** Marque, dans l'adresse, d'une tuile demandée par le film du temps. Le cache du relais l'ignore. */
export const WARM_FLAG = 'film';

export const edgeTileUrl = (prefix: string): TileUrlBuilder => ({ service, px, level, i, j, format, warm }) =>
  `${prefix}/tiles/${service}/${px}/${level}/${i}/${j}.${format}${warm ? `?${WARM_FLAG}` : ''}`;

const ORTHO = 'IMAGERIE/ORTHO_';

/**
 * Les mêmes photos aériennes aux autres millésimes : ce que le film du temps
 * demandera juste après. Vide pour tout autre service que l'orthophoto.
 */
export function siblingVintages(service: string, suffixes: readonly string[]): string[] {
  if (!service.startsWith(ORTHO)) return [];
  const infrared = service.endsWith('_IR');
  const own = service.slice(ORTHO.length, infrared ? -3 : undefined);
  if (!suffixes.includes(own)) return [];
  return suffixes.filter((suffix) => suffix !== own).map((suffix) => `${ORTHO}${suffix}${infrared ? '_IR' : ''}`);
}

/** Lecture inverse d'un chemin `edge` ; `null` si le chemin n'est pas une tuile valide. */
export function parseTilePath(path: string): TileRequest | null {
  const match = /^\/tiles\/([A-Z]+\/[0-9A-Z_]+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\.(png|jpg)$/.exec(path);
  if (!match) return null;
  const [, service, px, level, i, j, format] = match as unknown as
    [string, string, string, string, string, string, TileFormat];
  return { service, px: Number(px), level: Number(level), i: Number(i), j: Number(j), format };
}
