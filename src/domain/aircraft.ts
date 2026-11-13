/**
 * Avions au-dessus de la Wallonie, en direct.
 *
 * Les positions viennent des transpondeurs ADS-B des appareils, captées par les
 * récepteurs bénévoles du réseau adsb.lol (données ouvertes, ODbL). Le site ne
 * les interroge pas directement : il passe par son propre relais, qui garde
 * chaque réponse quelques secondes — mille visiteurs ne font pas mille requêtes.
 *
 * Tout est converti ici, une fois : pieds, nœuds et pieds par minute deviennent
 * des mètres et des secondes, la position passe en Lambert 2008.
 */

import { toLambert } from './lambert2008.ts';
import { WALLONIA_EXTENT } from './tiling.ts';
import { POSE_LIMITS, type Pose } from './view.ts';

const FOOT = 0.3048;
const KNOT = 0.514444;
const FOOT_PER_MINUTE = FOOT / 60;
const DEG = Math.PI / 180;

/** Cercle interrogé : centré sur la Wallonie, assez large pour couvrir ses pointes. */
export const AIRCRAFT_FEED = { lat: 50.2, lon: 5.0, radiusNm: 100 } as const;
export const aircraftFeedUrl = (): string =>
  `https://api.adsb.lol/v2/lat/${AIRCRAFT_FEED.lat}/lon/${AIRCRAFT_FEED.lon}/dist/${AIRCRAFT_FEED.radiusNm}`;

/** Chemin du relais, sous le préfixe `edge`. */
export const AIRCRAFT_EDGE_PATH = '/aircraft.json';
/** Durée pendant laquelle le relais ressert la même réponse, en secondes. */
export const AIRCRAFT_CACHE_SECONDS = 5;
/** Cadence de rafraîchissement dans le navigateur. */
export const AIRCRAFT_POLL_MS = 8000;
/** Au-delà, une position n'est plus extrapolée : l'appareil a pu virer. */
export const MAX_EXTRAPOLATION_S = 25;

export interface Aircraft {
  /** Adresse OACI 24 bits du transpondeur, en hexadécimal. */
  id: string;
  /** Indicatif de vol (« RYR72HA »), ou l'immatriculation à défaut. */
  callsign: string;
  registration: string | null;
  /** Type OACI (« B738 »). */
  type: string | null;
  /** Position, en Lambert 2008. */
  x: number;
  y: number;
  /** Altitude au-dessus du niveau de la mer, en mètres ; `null` au sol. */
  altitude: number | null;
  onGround: boolean;
  /** Vitesse sol, en m/s. */
  speed: number;
  /** Route suivie, en degrés depuis le nord. */
  track: number;
  /** Vitesse verticale, en m/s (positive en montée). */
  verticalRate: number;
  squawk: string | null;
  /** Altitude affichée au pilote automatique, en mètres. */
  selectedAltitude: number | null;
  /** Vitesse indiquée, en m/s. */
  indicatedSpeed: number | null;
  mach: number | null;
  /** Vent rencontré : direction d'où il vient (degrés) et force (m/s). */
  wind: { from: number; speed: number } | null;
  /** Température extérieure, en °C. */
  temperature: number | null;
  /** Instant de la dernière position reçue, en millisecondes Unix. */
  seenAt: number;
}

const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** Marge autour de l'emprise : un avion en approche se voit avant de franchir la frontière. */
const MARGIN = 12_000;
const inWallonia = (x: number, y: number): boolean =>
  x >= WALLONIA_EXTENT.xmin - MARGIN && x <= WALLONIA_EXTENT.xmax + MARGIN
  && y >= WALLONIA_EXTENT.ymin - MARGIN && y <= WALLONIA_EXTENT.ymax + MARGIN;

/** Lit la réponse du réseau ; tolérant : tout appareil sans position exploitable est écarté. */
export function parseAircraft(payload: unknown): Aircraft[] {
  const root = payload as { ac?: unknown; now?: unknown } | null;
  if (!root || !Array.isArray(root.ac)) return [];
  const now = number(root.now) ?? Date.now();
  const list: Aircraft[] = [];
  for (const entry of root.ac as Record<string, unknown>[]) {
    const id = text(entry.hex);
    const lat = number(entry.lat), lon = number(entry.lon);
    if (!id || lat === null || lon === null) continue;
    const { x, y } = toLambert(lat, lon);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !inWallonia(x, y)) continue;

    const onGround = entry.alt_baro === 'ground';
    const feet = number(entry.alt_geom) ?? number(entry.alt_baro);
    const registration = text(entry.r);
    const windSpeed = number(entry.ws), windFrom = number(entry.wd);
    list.push({
      id,
      callsign: text(entry.flight) ?? registration ?? id.toUpperCase(),
      registration,
      type: text(entry.t),
      x: Math.round(x),
      y: Math.round(y),
      altitude: onGround || feet === null ? null : Math.round(feet * FOOT),
      onGround,
      speed: (number(entry.gs) ?? 0) * KNOT,
      track: number(entry.track) ?? number(entry.true_heading) ?? 0,
      verticalRate: (number(entry.baro_rate) ?? number(entry.geom_rate) ?? 0) * FOOT_PER_MINUTE,
      squawk: text(entry.squawk),
      selectedAltitude: number(entry.nav_altitude_mcp) === null ? null : Math.round(number(entry.nav_altitude_mcp)! * FOOT),
      indicatedSpeed: number(entry.ias) === null ? null : number(entry.ias)! * KNOT,
      mach: number(entry.mach),
      wind: windSpeed !== null && windFrom !== null ? { from: windFrom, speed: windSpeed * KNOT } : null,
      temperature: number(entry.oat),
      seenAt: now - (number(entry.seen_pos) ?? 0) * 1000,
    });
  }
  return list;
}

/* ------------------------------------------------------------- lecture --- */

export interface Airfield { code: string; name: string; x: number; y: number }

const airfield = (code: string, name: string, lat: number, lon: number): Airfield => {
  const { x, y } = toLambert(lat, lon);
  return { code, name, x: Math.round(x), y: Math.round(y) };
};

/** Aéroports et aérodromes wallons d'où l'on décolle et où l'on se pose. */
export const AIRFIELDS: readonly Airfield[] = [
  airfield('EBCI', 'Charleroi', 50.4592, 4.4538),
  airfield('EBLG', 'Liège', 50.6374, 5.4432),
  airfield('EBBE', 'Beauvechain', 50.7586, 4.7683),
  airfield('EBFS', 'Florennes', 50.2433, 4.6458),
  airfield('EBCV', 'Chièvres', 50.5758, 3.8310),
  airfield('EBNM', 'Namur', 50.4880, 4.7689),
  airfield('EBSP', 'Spa', 50.4825, 5.9103),
  airfield('EBSH', 'Saint-Hubert', 50.0358, 5.4042),
];

/** Rayon et plafond dans lesquels un appareil est tenu pour lié à un terrain. */
const TERMINAL_RADIUS = 35_000;
const TERMINAL_CEILING = 3_000;
/** En deçà, une vitesse verticale n'est que du palier. */
const LEVEL_RATE = 1.5;

export type AircraftPhase =
  | { kind: 'ground'; airfield: Airfield | null }
  | { kind: 'approach'; airfield: Airfield }
  | { kind: 'departure'; airfield: Airfield }
  | { kind: 'climb' } | { kind: 'descent' } | { kind: 'cruise' };

/** Ce que fait l'appareil : au sol, en approche d'un terrain wallon, au départ, ou en survol. */
export function aircraftPhase(aircraft: Aircraft): AircraftPhase {
  let nearest: Airfield | null = null;
  let best = Infinity;
  for (const field of AIRFIELDS) {
    const distance = Math.hypot(field.x - aircraft.x, field.y - aircraft.y);
    if (distance < best) { best = distance; nearest = field; }
  }
  const terminal = nearest !== null && best <= TERMINAL_RADIUS;
  if (aircraft.onGround) return { kind: 'ground', airfield: best <= 6000 ? nearest : null };
  const low = (aircraft.altitude ?? Infinity) <= TERMINAL_CEILING;
  if (terminal && low && aircraft.verticalRate <= -LEVEL_RATE) return { kind: 'approach', airfield: nearest! };
  if (terminal && low && aircraft.verticalRate >= LEVEL_RATE) return { kind: 'departure', airfield: nearest! };
  if (aircraft.verticalRate >= LEVEL_RATE) return { kind: 'climb' };
  if (aircraft.verticalRate <= -LEVEL_RATE) return { kind: 'descent' };
  return { kind: 'cruise' };
}

export function phaseLabel(phase: AircraftPhase): string {
  switch (phase.kind) {
    case 'ground': return phase.airfield ? `Au sol à ${phase.airfield.name}` : 'Au sol';
    case 'approach': return `En approche de ${phase.airfield.name}`;
    case 'departure': return `Au départ de ${phase.airfield.name}`;
    case 'climb': return 'En montée';
    case 'descent': return 'En descente';
    case 'cruise': return 'En palier';
  }
}

/** Vitesse d'un appareil, composante par composante, dans le repère Lambert (m/s). */
export const aircraftVelocity = (aircraft: Aircraft) => ({
  vx: aircraft.speed * Math.sin(aircraft.track * DEG),
  vy: aircraft.speed * Math.cos(aircraft.track * DEG),
  vz: aircraft.onGround ? 0 : aircraft.verticalRate,
});

/**
 * Position estimée à l'instant `at` : la dernière position connue, prolongée
 * sur sa route. C'est ce qui fait avancer l'avion entre deux relevés.
 */
export function aircraftAt(aircraft: Aircraft, at: number): { x: number; y: number; altitude: number | null } {
  const dt = Math.min(MAX_EXTRAPOLATION_S, Math.max(0, (at - aircraft.seenAt) / 1000));
  const { vx, vy, vz } = aircraftVelocity(aircraft);
  return {
    x: aircraft.x + vx * dt,
    y: aircraft.y + vy * dt,
    altitude: aircraft.altitude === null ? null : aircraft.altitude + vz * dt,
  };
}

/** Recherche d'un vol : indicatif, immatriculation, type ou adresse du transpondeur. */
export function searchAircraft(list: readonly Aircraft[], query: string): Aircraft[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = words.length === 0 ? [...list] : list.filter((aircraft) => {
    const haystack = `${aircraft.callsign} ${aircraft.registration ?? ''} ${aircraft.type ?? ''} ${aircraft.id}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  return matches.sort((a, b) => a.callsign.localeCompare(b.callsign, 'fr'));
}

/* ------------------------------------------------------------- cockpit --- */

/** Inclinaison du regard depuis le poste de pilotage : dix degrés sous l'horizon. */
export const COCKPIT_TILT = 80;
/** Hauteur minimale au-dessus du sol : au roulage, la vue ne s'enfonce pas dans le relief. */
const COCKPIT_MIN_HEIGHT = 40;

/**
 * Vue depuis le poste de pilotage : la caméra est à la place de l'avion et
 * regarde sur sa route. Le viewer visant toujours un point du sol, on lui donne
 * celui que le regard atteint, à la distance qui ramène la caméra sur l'avion.
 */
export function cockpitPose(position: { x: number; y: number; altitude: number | null }, track: number, ground: number): Pose {
  const height = Math.max(COCKPIT_MIN_HEIGHT, (position.altitude ?? ground) - ground);
  const tilt = Math.min(COCKPIT_TILT, POSE_LIMITS.tilt.max);
  const distance = height / Math.cos(tilt * DEG);
  const reach = distance * Math.sin(tilt * DEG);
  return {
    x: position.x + reach * Math.sin(track * DEG),
    y: position.y + reach * Math.cos(track * DEG),
    distance,
    azimuth: ((track % 360) + 360) % 360,
    tilt,
  };
}
