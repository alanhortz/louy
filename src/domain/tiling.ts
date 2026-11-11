/**
 * Tuilage et projection — partagé par le viewer (navigateur) et par le Worker
 * Cloudflare, qui doivent calculer exactement la même emprise pour une tuile.
 *
 * Tout est exprimé en EPSG:3812 (ETRS89 / Belgian Lambert 2008), le système
 * natif des services du Géoportail de la Wallonie : les coordonnées sont
 * métriques et aucune reprojection n'a lieu côté client.
 */

export interface Extent {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export interface TileAddress {
  level: number;
  i: number;
  j: number;
}

/** Emprise publiée par le service MNT 2021-2022. */
export const WALLONIA_EXTENT: Extent = {
  xmin: 542146.5, ymin: 521073.5,
  xmax: 795501.5, ymax: 668001.5,
};

/** Racine du quadtree : carré puissance de deux centré sur l'emprise. */
export const ROOT_SIZE = 262144; // 2^18 m
export const ROOT_CX = (WALLONIA_EXTENT.xmin + WALLONIA_EXTENT.xmax) / 2;
export const ROOT_CY = (WALLONIA_EXTENT.ymin + WALLONIA_EXTENT.ymax) / 2;
export const ROOT_X0 = ROOT_CX - ROOT_SIZE / 2;
export const ROOT_Y0 = ROOT_CY - ROOT_SIZE / 2;

/**
 * Niveau maximal. À L=11 la tuile mesure 128 m ; avec une grille de 256 points
 * de côté, le pas au sol vaut 0,50 m — la résolution native du LiDAR 2021-2022.
 */
export const MAX_LEVEL = 11;

/**
 * Côté de la grille de points d'une tuile. 256 px est l'optimum mesuré sur le
 * serveur ArcGIS du SPW (~300 ms par rendu, contre ~1650 ms en 512 px).
 */
export const TILE_GRID = 256;

/**
 * Marge demandée autour de la tuile : elle donne du contexte au filtre de
 * reconstruction (pas de couture entre voisines) puis est recadrée.
 */
export const TILE_PAD = 8;

/** Taille, en pixels, de l'image demandée pour une tuile (grille + marges). */
export const REQUEST_PX = TILE_GRID + 2 * TILE_PAD;

/** Origine du repère monde (recentrage pour rester précis en float32). */
export const ORIGIN = { x: ROOT_CX, y: ROOT_CY };

/** Côté au sol d'une tuile, en mètres. */
export const tileSize = (level: number): number => ROOT_SIZE / 2 ** level;

/** Pas de la grille altimétrique d'une tuile, en mètres. */
export const tileSpacing = (level: number): number => tileSize(level) / TILE_GRID;

/** Emprise d'une tuile. */
export function tileExtent(level: number, i: number, j: number): Extent & { size: number } {
  const size = tileSize(level);
  const xmin = ROOT_X0 + i * size;
  const ymin = ROOT_Y0 + j * size;
  return { xmin, ymin, xmax: xmin + size, ymax: ymin + size, size };
}

/** Emprise réellement demandée au serveur : la tuile élargie de sa marge. */
export function paddedExtent({ level, i, j }: TileAddress): Extent {
  const e = tileExtent(level, i, j);
  const pad = TILE_PAD * tileSpacing(level);
  return { xmin: e.xmin - pad, ymin: e.ymin - pad, xmax: e.xmax + pad, ymax: e.ymax + pad };
}

/** Une emprise recouvre-t-elle la Wallonie ? Borne le quadtree. */
export function intersectsCoverage(e: Extent): boolean {
  return e.xmax > WALLONIA_EXTENT.xmin && e.xmin < WALLONIA_EXTENT.xmax
      && e.ymax > WALLONIA_EXTENT.ymin && e.ymin < WALLONIA_EXTENT.ymax;
}

/** Une adresse désigne-t-elle une tuile existante du quadtree ? */
export function isValidAddress({ level, i, j }: TileAddress): boolean {
  if (!Number.isInteger(level) || level < 0 || level > MAX_LEVEL) return false;
  const n = 2 ** level;
  return Number.isInteger(i) && Number.isInteger(j) && i >= 0 && j >= 0 && i < n && j < n;
}

/**
 * Suréchantillonnage au niveau le plus fin : le relief est natif à 50 cm mais
 * l'orthophoto à 25 cm. Au dernier niveau on génère donc `superSample` points
 * par cellule et par axe — l'altitude est interpolée, la couleur est native.
 */
export const levelSuper = (level: number, superSample: number): number =>
  (level >= MAX_LEVEL ? Math.max(1, superSample) : 1);
