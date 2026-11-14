/**
 * La quatrième dimension d'un vol : d'où l'appareil vient, et où il va.
 *
 * Le passé est réel : c'est la suite des positions que le site a lui-même
 * relevées, toutes les quelques secondes, depuis que le visiteur a ouvert le
 * calque des avions. Rien n'est demandé de plus au réseau : la trace d'un
 * appareil commence donc au moment où on l'a vu pour la première fois.
 *
 * L'avenir est une estimation : la route actuelle prolongée de quelques
 * minutes, en tenant compte du virage en cours et de l'altitude que l'équipage
 * a affichée au pilote automatique. Rien ne dit que l'avion ne virera pas : c'est
 * une tendance, dessinée en pointillé, pas un plan de vol.
 */

import type { Aircraft } from './aircraft.ts';

/** Un point d'une trajectoire : où, quand, à quelle altitude et à quelle vitesse. */
export interface TrackPoint {
  /** Instant, en millisecondes Unix. */
  at: number;
  x: number;
  y: number;
  /** Altitude au-dessus du niveau de la mer, en mètres ; `null` au sol. */
  altitude: number | null;
  /** Vitesse sol, en m/s. */
  speed: number;
}

const DEG = Math.PI / 180;

/** Les traces relevées par le site, par adresse de transpondeur. */
export type Tracks = ReadonlyMap<string, readonly TrackPoint[]>;

/** Silence au-delà duquel une trace repart de zéro : on ne relie pas deux positions sans savoir ce qui les sépare. */
const TRACK_GAP_MS = 2 * 60_000;
/** Durée de trace gardée pour chaque appareil. */
const TRACK_MEMORY_MS = 2 * 3_600_000;

/**
 * Ajoute un relevé aux traces : chaque appareil présent gagne sa position du
 * moment, et ceux qui ont quitté le relevé sont oubliés.
 */
export function recordTracks(tracks: Tracks, list: readonly Aircraft[], now: number): Map<string, TrackPoint[]> {
  const next = new Map<string, TrackPoint[]>();
  for (const aircraft of list) {
    const known = tracks.get(aircraft.id) ?? [];
    const last = known.at(-1);
    // le réseau n'a rien entendu de neuf : la trace ne bouge pas
    if (last && aircraft.seenAt <= last.at) { next.set(aircraft.id, [...known]); continue; }
    const kept = last && aircraft.seenAt - last.at > TRACK_GAP_MS ? [] : known.filter((point) => point.at >= now - TRACK_MEMORY_MS);
    next.set(aircraft.id, [...kept, { at: aircraft.seenAt, x: aircraft.x, y: aircraft.y, altitude: aircraft.altitude, speed: aircraft.speed }]);
  }
  return next;
}

/** Horizon de l'estimation, et pas entre deux points, en secondes. */
export const AHEAD_SECONDS = 600;
const AHEAD_STEP = 20;
/** Un virage en cours est tenu pour durer au plus ce temps : au-delà, l'estimation file droit. */
const TURN_SECONDS = 60;
/** Sans altitude affichée, une montée ou une descente est prolongée ce temps-là, puis le vol est tenu en palier. */
const VERTICAL_SECONDS = 180;

/**
 * Trajectoire estimée devant l'appareil, à partir de l'instant `now`. Vide pour
 * un appareil au sol ou presque arrêté.
 */
export function projectAhead(
  aircraft: Pick<Aircraft, 'x' | 'y' | 'altitude' | 'speed' | 'track' | 'verticalRate' | 'turnRate' | 'selectedAltitude' | 'onGround' | 'seenAt'>,
  now: number,
): TrackPoint[] {
  if (aircraft.onGround || aircraft.altitude === null || aircraft.speed < 20) return [];
  // on repart de là où l'appareil est maintenant, pas de son dernier relevé
  const late = Math.max(0, (now - aircraft.seenAt) / 1000);
  let x = aircraft.x + aircraft.speed * Math.sin(aircraft.track * DEG) * late;
  let y = aircraft.y + aircraft.speed * Math.cos(aircraft.track * DEG) * late;
  let altitude = aircraft.altitude + aircraft.verticalRate * late;
  let track = aircraft.track;
  const target = aircraft.selectedAltitude;
  // l'altitude affichée n'est un but que si l'appareil s'en approche
  const towards = target !== null && Math.sign(target - altitude) === Math.sign(aircraft.verticalRate) && aircraft.verticalRate !== 0;
  const points: TrackPoint[] = [{ at: now, x: Math.round(x), y: Math.round(y), altitude: Math.round(altitude), speed: aircraft.speed }];
  for (let t = AHEAD_STEP; t <= AHEAD_SECONDS; t += AHEAD_STEP) {
    if (t <= TURN_SECONDS) track += (aircraft.turnRate ?? 0) * AHEAD_STEP;
    x += aircraft.speed * Math.sin(track * DEG) * AHEAD_STEP;
    y += aircraft.speed * Math.cos(track * DEG) * AHEAD_STEP;
    if (towards) {
      const next = altitude + aircraft.verticalRate * AHEAD_STEP;
      // l'altitude affichée atteinte, le vol se met en palier
      altitude = aircraft.verticalRate > 0 ? Math.min(target, next) : Math.max(target, next);
    } else if (t <= VERTICAL_SECONDS) {
      altitude = Math.max(0, altitude + aircraft.verticalRate * AHEAD_STEP);
    }
    points.push({ at: now + t * 1000, x: Math.round(x), y: Math.round(y), altitude: Math.round(altitude), speed: aircraft.speed });
  }
  return points;
}

/** Position sur une trajectoire à l'instant `at`, entre les deux points qui l'encadrent ; `null` hors de ses bornes. */
export function pointAt(points: readonly TrackPoint[], at: number): TrackPoint | null {
  if (points.length === 0 || at < points[0]!.at || at > points.at(-1)!.at) return null;
  let after = points.findIndex((point) => point.at >= at);
  if (after <= 0) after = Math.min(1, points.length - 1);
  const a = points[after - 1] ?? points[after]!, b = points[after]!;
  const share = b.at === a.at ? 0 : (at - a.at) / (b.at - a.at);
  const mix = (from: number, to: number) => from + (to - from) * share;
  return {
    at,
    x: Math.round(mix(a.x, b.x)), y: Math.round(mix(a.y, b.y)),
    altitude: a.altitude === null || b.altitude === null ? (share < 0.5 ? a.altitude : b.altitude) : Math.round(mix(a.altitude, b.altitude)),
    speed: mix(a.speed, b.speed),
  };
}

/**
 * Allège une trajectoire pour le tracé : pas plus de `limit` points, en gardant
 * le premier et le dernier.
 */
export function thin<P>(points: readonly P[], limit = 600): P[] {
  if (points.length <= limit) return [...points];
  const step = (points.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, k) => points[Math.round(k * step)]!);
}
