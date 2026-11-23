/**
 * Vols de drone : le trajet d'un drone dans l'espace, pose par pose, et ce que sa
 * caméra voyait. Chaque vol vient de la reconstruction de la vidéo qu'il a tournée :
 * la position et le regard de la caméra y sont connus image par image.
 */

import type { Translations } from './localized.ts';
import { isClip, type ClipKey } from './clips.ts';
import type { ScanCredit } from './scans.ts';

/** Clef de traduction du nom du calque. */
export const DRONES_LABEL = 'layer.drones';

export interface DroneFlight {
  /** Traductions des textes ci-dessus (voir domain/localized.ts). */
  i18n?: Translations;
  id: string;
  name: string;
  /** Où le marqueur se pose : le point de départ du vol, en Lambert 2008. */
  x: number;
  y: number;
  /** Lieu reconstruit à partir de ce vol, s'il y en a un : c'est lui que l'on voit depuis la caméra. */
  scanId?: string;
  /** Modèle du drone, tel que l'auteur l'indique. */
  drone: string;
  /** Champ vertical de la caméra, en degrés, et rapport largeur / hauteur de son image. */
  fov: number;
  aspect: number;
  credit: ScanCredit;
  /** Ce que la caméra a filmé pendant ce vol : une séquence servie par le site, calée sur le trajet. */
  video?: string;
  /** Quand le vol a eu lieu, tel qu'on le sait — un jour, ou seulement une période. L'heure, elle, n'est pas connue. */
  date?: string;
  track: ClipKey[];
}

export function isDroneFlight(value: unknown): value is DroneFlight {
  const flight = value as Partial<DroneFlight> | null;
  return typeof flight === 'object' && flight !== null
    && typeof flight.id === 'string' && typeof flight.name === 'string' && typeof flight.drone === 'string'
    && Number.isFinite(flight.x) && Number.isFinite(flight.y)
    && (flight.scanId === undefined || typeof flight.scanId === 'string')
    && (flight.video === undefined || (typeof flight.video === 'string' && /^\/(?!\/)/.test(flight.video)))
    && (flight.date === undefined || typeof flight.date === 'string')
    && typeof flight.credit?.author === 'string' && typeof flight.credit?.url === 'string' && typeof flight.credit?.licence === 'string'
    // même forme qu'une séquence filmée : un champ, un rapport, des poses par instants croissants
    && isClip({ id: flight.id, name: flight.name, src: '/vol', fov: flight.fov, aspect: flight.aspect, track: flight.track })
    && flight.track!.length >= 2;
}

export const flightDuration = (flight: DroneFlight): number => flight.track[flight.track.length - 1]!.t;

/** Pause entre deux passages du même vol, en secondes. */
export const FLIGHT_REST = 2.5;

/** Où en est un vol qui se rejoue en boucle, à l'horloge `now` (secondes) : la carte et le panneau lisent la même. */
export const flightTime = (flight: DroneFlight, now: number): number =>
  Math.min(flightDuration(flight), now % (flightDuration(flight) + FLIGHT_REST));

/** Vitesse du drone à l'instant `t`, en km/h, d'après les deux poses qui l'encadrent. */
export function flightSpeed(flight: DroneFlight, t: number): number {
  let after = 1;
  while (after < flight.track.length - 1 && flight.track[after]!.t < t) after++;
  const a = flight.track[after - 1]!, b = flight.track[after]!;
  return (Math.hypot(b.x - a.x, b.y - a.y, b.altitude - a.altitude) / Math.max(b.t - a.t, 1e-3)) * 3.6;
}

/** Distance parcourue, en mètres, et vitesse moyenne, en km/h. */
export function flightSummary(flight: DroneFlight): { metres: number; kmh: number; seconds: number } {
  let metres = 0;
  for (let at = 1; at < flight.track.length; at++) {
    const a = flight.track[at - 1]!, b = flight.track[at]!;
    metres += Math.hypot(b.x - a.x, b.y - a.y, b.altitude - a.altitude);
  }
  const seconds = flightDuration(flight);
  return { metres, seconds, kmh: seconds > 0 ? (metres / seconds) * 3.6 : 0 };
}
