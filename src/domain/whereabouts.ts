/**
 * Coordonnées géographiques : celles du point que la vue vise, à remettre au
 * visiteur, et celles de son appareil, à porter sur la carte.
 */

import { t } from '../i18n/index.ts';
import { toLambert, toWgs84, type LambertPoint } from './lambert2008.ts';
import { inWallonia } from './walloniaOutline.ts';

/** Six décimales : une dizaine de centimètres, la finesse du relief. */
const DECIMALS = 6;

/**
 * Coordonnées d'un point Lambert 2008, telles qu'on les colle dans une carte ou
 * un GPS : latitude puis longitude, en degrés décimaux WGS84.
 */
export function formatCoordinates(x: number, y: number, azimuth?: number): string {
  const { lat, lon } = toWgs84(x, y);
  const place = `${lat.toFixed(DECIMALS)}, ${lon.toFixed(DECIMALS)}`;
  // avec un cap — celui du regard d'un promeneur — en degrés depuis le nord, dans le sens des aiguilles d'une montre
  return azimuth === undefined ? place : `${place}, ${Math.round(((azimuth % 360) + 360) % 360) % 360}°`;
}

/** Position de l'appareil sur la carte, avec l'incertitude annoncée par le navigateur. */
export interface DevicePosition extends LambertPoint {
  /** Rayon d'incertitude, en mètres. */
  accuracy: number;
  /** Vitesse de déplacement, en km/h, quand l'appareil la mesure ou qu'elle se déduit de deux positions. */
  speed?: number;
  /** Instant du relevé, en millisecondes. */
  at?: number;
}

/**
 * Rayon, autour de l'appareil, dans lequel aucune coordonnée n'est écrite nulle part :
 * ni dans le journal local, ni dans l'adresse de la page. La position du visiteur — et
 * ce qu'il regarde tout près d'elle — n'existe qu'en mémoire, le temps de la visite.
 */
export const PRIVATE_RADIUS = 1000;

/** Le point est-il assez près de l'appareil pour le trahir ? */
export const nearDevice = (device: LambertPoint | null, x: number, y: number): boolean =>
  device !== null && Math.hypot(x - device.x, y - device.y) < PRIVATE_RADIUS;

export type LocationFailure = 'denied' | 'unavailable' | 'outside';

/** Porte une position du navigateur sur la carte ; `null` si elle tombe hors de Wallonie. */
export function devicePosition(latitude: number, longitude: number, accuracy: number): DevicePosition | null {
  const { x, y } = toLambert(latitude, longitude);
  return inWallonia(x, y) ? { x, y, accuracy } : null;
}

/** En dessous, l'appareil est tenu pour immobile : le bruit d'un récepteur à l'arrêt ne fait pas une vitesse. */
const STILL_KMH = 1.5;

/**
 * Vitesse à afficher pour un relevé, en km/h. Celle que mesure l'appareil (`measured`, en m/s) d'abord ;
 * à défaut, la distance parcourue depuis le relevé précédent — si les deux sont assez précis pour qu'elle
 * ait un sens. `undefined` quand rien ne permet de la dire.
 */
export function speedKmh(previous: DevicePosition | null, next: DevicePosition, measured: number | null): number | undefined {
  let speed: number | undefined;
  if (measured !== null && Number.isFinite(measured) && measured >= 0) speed = measured * 3.6;
  else if (previous?.at !== undefined && next.at !== undefined) {
    const seconds = (next.at - previous.at) / 1000;
    const moved = Math.hypot(next.x - previous.x, next.y - previous.y);
    // deux relevés trop rapprochés, ou un déplacement noyé dans leur incertitude : on ne dit rien
    if (seconds >= 1 && moved > Math.max(previous.accuracy, next.accuracy) * 0.5) speed = (moved / seconds) * 3.6;
    else if (seconds >= 1) speed = 0;
  }
  return speed === undefined ? undefined : speed < STILL_KMH ? 0 : Math.round(speed);
}

/** Ce que dit le repère : où l'on est, et à quelle vitesse quand elle est connue. */
export const locationLabel = (position: DevicePosition): string =>
  (position.speed === undefined ? t('location.here') : t('location.hereSpeed', { speed: position.speed }));

/** Hauteur de survol qui montre la position et son incertitude, sans descendre trop bas. */
export const locationHeight = (position: DevicePosition): number =>
  Math.min(4000, Math.max(260, position.accuracy * 4));

/** Clefs de traduction de ce que l'on dit au visiteur quand on ne l'a pas trouvé. */
export const LOCATION_FAILURES = {
  denied: 'location.denied',
  unavailable: 'location.unavailable',
  outside: 'location.outside',
} as const satisfies Record<LocationFailure, string>;
