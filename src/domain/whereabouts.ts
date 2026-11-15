/**
 * Coordonnées géographiques : celles du point que la vue vise, à remettre au
 * visiteur, et celles de son appareil, à porter sur la carte.
 */

import { toLambert, toWgs84, type LambertPoint } from './lambert2008.ts';
import { inWallonia } from './walloniaOutline.ts';

/** Six décimales : une dizaine de centimètres, la finesse du relief. */
const DECIMALS = 6;

/**
 * Coordonnées d'un point Lambert 2008, telles qu'on les colle dans une carte ou
 * un GPS : latitude puis longitude, en degrés décimaux WGS84.
 */
export function formatCoordinates(x: number, y: number): string {
  const { lat, lon } = toWgs84(x, y);
  return `${lat.toFixed(DECIMALS)}, ${lon.toFixed(DECIMALS)}`;
}

/** Position de l'appareil sur la carte, avec l'incertitude annoncée par le navigateur. */
export interface DevicePosition extends LambertPoint {
  /** Rayon d'incertitude, en mètres. */
  accuracy: number;
}

export type LocationFailure = 'denied' | 'unavailable' | 'outside';

/** Porte une position du navigateur sur la carte ; `null` si elle tombe hors de Wallonie. */
export function devicePosition(latitude: number, longitude: number, accuracy: number): DevicePosition | null {
  const { x, y } = toLambert(latitude, longitude);
  return inWallonia(x, y) ? { x, y, accuracy } : null;
}

/** Hauteur de survol qui montre la position et son incertitude, sans descendre trop bas. */
export const locationHeight = (position: DevicePosition): number =>
  Math.min(4000, Math.max(260, position.accuracy * 4));

export const LOCATION_FAILURES: Record<LocationFailure, string> = {
  denied: 'Localisation refusée par le navigateur',
  unavailable: 'Position introuvable',
  outside: 'Vous êtes hors de Wallonie',
};
