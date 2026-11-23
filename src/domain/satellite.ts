/**
 * Vue « Satellite » : des prises de vue faites à la verticale, redressées hors
 * ligne en images à plat (nord en haut), que la carte montre vue du dessus.
 *
 * Une image de drone n'est pas une carte — ce qui est haut y est déjeté vers
 * les bords. Le redressement remet chaque point à sa place d'après la surface
 * LiDAR ; l'image est ensuite tendue à l'horizontale, juste au-dessus du plus
 * haut point de ce relief, de sorte que rien ne la traverse.
 *
 * Emprises en Lambert 2008, altitudes en mètres.
 */

import type { Translations } from './localized.ts';
import type { ScanCredit } from './scans.ts';
import { POSE_LIMITS, type Pose } from './view.ts';

export interface SatelliteImage {
  /** Traductions des textes ci-dessus (voir domain/localized.ts). */
  i18n?: Translations;
  id: string;
  name: string;
  /** Adresse de l'image, transparente hors de la prise de vue. */
  src: string;
  west: number;
  south: number;
  east: number;
  north: number;
  /** Altitude du plus haut point du relief sous l'image. */
  top: number;
  /** La même image en haute définition, quand elle existe. */
  hd?: { src: string };
  credit: ScanCredit;
}

/** Marge au-dessus du plus haut point du relief : le relief du viewer n'est connu qu'à quelques mètres près. */
export const SATELLITE_CLEARANCE = 6;
/** Inclinaison de la vue satellite : à la verticale. */
export const SATELLITE_TILT = POSE_LIMITS.tilt.min;
/** Au-delà de cette distance de toute image, allumer la vue satellite y emmène. */
export const SATELLITE_NEAR = 1200;

const finite = (...values: unknown[]): boolean => values.every((value) => typeof value === 'number' && Number.isFinite(value));

export function isSatelliteImage(value: unknown): value is SatelliteImage {
  const image = value as Partial<SatelliteImage> | null;
  return typeof image === 'object' && image !== null
    && typeof image.id === 'string' && typeof image.name === 'string'
    // une adresse du site, jamais d'ailleurs
    && typeof image.src === 'string' && /^\/(?!\/)/.test(image.src)
    && (image.hd === undefined || (typeof image.hd?.src === 'string' && /^\/(?!\/)/.test(image.hd.src)))
    && finite(image.west, image.south, image.east, image.north, image.top)
    && image.east! > image.west! && image.north! > image.south!
    && typeof image.credit?.author === 'string' && typeof image.credit?.url === 'string' && typeof image.credit?.licence === 'string';
}

const centre = (image: SatelliteImage) => ({ x: (image.west + image.east) / 2, y: (image.south + image.north) / 2 });

/** Image la plus proche d'un point, et sa distance — nulle quand le point est dessus. */
export function nearestSatelliteImage(images: readonly SatelliteImage[], x: number, y: number): { image: SatelliteImage; distance: number } | null {
  let best: { image: SatelliteImage; distance: number } | null = null;
  for (const image of images) {
    const dx = Math.max(image.west - x, 0, x - image.east), dy = Math.max(image.south - y, 0, y - image.north);
    const distance = Math.hypot(dx, dy);
    if (!best || distance < best.distance) best = { image, distance };
  }
  return best;
}

/** Vue du dessus, nord en haut, qui montre une image entière. */
export function satelliteViewPose(image: SatelliteImage): Pose {
  const { x, y } = centre(image);
  return { x, y, distance: Math.max(image.east - image.west, image.north - image.south) * 1.5, azimuth: 0, tilt: SATELLITE_TILT };
}

/**
 * Où la vue doit aller quand on allume la vue satellite : rien si une image est déjà
 * à portée de la vue (`null`), sinon au-dessus de la plus proche.
 */
export function satelliteDestination(images: readonly SatelliteImage[], pose: Pose): Pose | null {
  const nearest = nearestSatelliteImage(images, pose.x, pose.y);
  if (!nearest || nearest.distance <= Math.max(SATELLITE_NEAR, pose.distance / 2)) return null;
  return satelliteViewPose(nearest.image);
}
