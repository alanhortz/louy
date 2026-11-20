/**
 * L'époque d'un lieu : un relevé reconstruit d'après des images anciennes (une vidéo de 2014…) ne se lit
 * bien que sur le relief et la photo aérienne de son temps. Tant qu'il est sélectionné, la carte les montre
 * autour de lui — dans un disque de quelques dizaines de mètres, fondu dans la scène du visiteur sur son
 * pourtour ; ailleurs, et dès qu'il ne l'est plus, c'est de nouveau la scène que le visiteur a choisie.
 * Le disque tient dans quatre tuiles, un carré de 256 m dont le lieu occupe le milieu : seules ces quatre
 * tuiles sont dessinées autrement.
 */

import { CAMPAIGNS, LATEST_VINTAGE, VINTAGES, type CampaignId } from './catalog.ts';
import type { Scan } from './scans.ts';
import { resolveScene, type Scene, type SceneSource } from './scene.ts';
import { ROOT_X0, ROOT_Y0, tileSize } from './tiling.ts';

/**
 * Niveau des quatre tuiles d'époque : 128 m de côté, juste de quoi entourer un lieu. Elles ne sont pas
 * subdivisées : quatre tuiles chargées, pas une de plus.
 */
export const PERIOD_LEVEL = 11;

/**
 * Le disque d'époque : plein jusqu'à `PERIOD_RADIUS` mètres du lieu, fondu dans la scène du visiteur sur les
 * `PERIOD_FEATHER` mètres suivants. Le lieu est à moins de 64 m du centre de ses quatre tuiles : le disque
 * et son fondu (70 m) restent dans leur carré de 128 m de demi-côté.
 */
export const PERIOD_RADIUS = 60;
export const PERIOD_FEATHER = 10;

/** Part de l'époque en un point : 1 dans le disque, 0 au-delà du fondu, adoucie entre les deux. */
export function periodWeight(distance: number, radius = PERIOD_RADIUS, feather = PERIOD_FEATHER): number {
  if (distance <= radius) return 1;
  if (distance >= radius + feather) return 0;
  const t = (distance - radius) / feather;
  return 1 - t * t * (3 - 2 * t);
}

/** Année d'une campagne ou d'un millésime : le milieu de sa période (« 2013–2014 » : 2013,5). */
export function periodYear(label: string): number | null {
  const years = (label.match(/\d{4}/g) ?? []).map(Number);
  if (years.length === 0) return null;
  return (Math.min(...years) + Math.max(...years)) / 2;
}

const nearest = <T>(items: readonly T[], yearOf: (item: T) => number | null, year: number): T | null => {
  let best: T | null = null, gap = Infinity;
  for (const item of items) {
    const at = yearOf(item);
    if (at === null) continue;
    // à égalité, la plus ancienne : un lieu filmé entre deux campagnes est montré sur celle d'avant lui
    if (Math.abs(at - year) < gap) { best = item; gap = Math.abs(at - year); }
  }
  return best;
};

/** La campagne LiDAR et le millésime d'orthophoto les plus proches d'une année. */
export function periodOf(year: number): { campaign: CampaignId; vintage: string } {
  const campaign = nearest(CAMPAIGNS, (c) => periodYear(c.label), year) ?? CAMPAIGNS[0]!;
  const vintage = nearest(VINTAGES.filter((v) => v.id !== LATEST_VINTAGE), (v) => periodYear(v.label), year);
  return { campaign: campaign.id, vintage: vintage?.id ?? LATEST_VINTAGE };
}

/** Quatre tuiles de la carte (un carré de 2 × 2) montrées à une autre époque que le reste. */
export interface PeriodPatch {
  level: number;
  /** La tuile du coin sud-ouest du carré. */
  i: number;
  j: number;
  source: SceneSource;
  /** Le lieu lui-même, centre du disque d'époque, en Lambert 2008. */
  centre: { x: number; y: number };
  /** Rayon du disque et largeur de son fondu, en mètres. */
  radius: number;
  feather: number;
}

/** Le carré de quatre tuiles dont le centre est le plus proche du lieu. */
export function periodBlock(x: number, y: number, level = PERIOD_LEVEL): { level: number; i: number; j: number } {
  const size = tileSize(level);
  return { level, i: Math.round((x - ROOT_X0) / size) - 1, j: Math.round((y - ROOT_Y0) / size) - 1 };
}

/** La tuile est-elle l'une des quatre ? */
export const inPeriod = (patch: PeriodPatch | null, tile: { level: number; i: number; j: number }): boolean =>
  patch !== null && tile.level === patch.level && tile.i - patch.i >= 0 && tile.i - patch.i <= 1 && tile.j - patch.j >= 0 && tile.j - patch.j <= 1;

/**
 * La région d'époque d'un lieu, dans la scène du visiteur : sa surface (terrain ou bâti) et son habillage
 * (photo, ombrage…) restent les siens, seules la campagne et l'année de la photo changent.
 * `null` : le lieu est de notre temps, ou la scène choisie est déjà la sienne.
 */
export function periodPatch(scan: Scan | null, scene: Scene): PeriodPatch | null {
  if (!scan || scan.year === undefined) return null;
  const period = periodOf(scan.year);
  const source = resolveScene({ ...scene, ...period });
  if (source.key === resolveScene(scene).key) return null;
  return { ...periodBlock(scan.x, scan.y), source, centre: { x: scan.x, y: scan.y }, radius: PERIOD_RADIUS, feather: PERIOD_FEATHER };
}

export const samePatch = (a: PeriodPatch | null, b: PeriodPatch | null): boolean =>
  a === b || (a !== null && b !== null && a.level === b.level && a.i === b.i && a.j === b.j && a.source.key === b.source.key
    && a.centre.x === b.centre.x && a.centre.y === b.centre.y && a.radius === b.radius && a.feather === b.feather);
