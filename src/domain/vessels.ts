/**
 * Bateaux sur les voies navigables de Wallonie, d'après EuRIS, le portail
 * européen des gestionnaires de voies d'eau (eurisportal.eu).
 *
 * EuRIS publie les positions sous une forme anonyme : ni nom, ni numéro
 * d'identification, seulement où est le bateau, sa route, sa vitesse et ses
 * dimensions. En navigation intérieure un bateau est souvent un domicile ; le
 * site n'en demande pas davantage, et ne garde aucun trajet.
 */

import { toLambert } from './lambert2008.ts';
import { inWallonia } from './walloniaOutline.ts';
import { waterwayAt, type Waterway } from './waterways.ts';

export const VESSEL_SOURCE = 'EuRIS';
/** Mention demandée par EuRIS à qui réutilise ses services. */
export const VESSEL_ATTRIBUTION = 'Service « Tracks » incorporé depuis EuRIS (eurisportal.eu)';

/** Ce qu'un bateau fait, d'après son statut de navigation AIS. */
export type VesselState = 'underway' | 'moored' | 'anchored' | 'restricted' | 'aground' | 'unknown';

export interface Vessel {
  /** Numéro de piste attribué par EuRIS : il ne désigne pas le bateau, seulement sa trace du moment. */
  id: string;
  x: number;
  y: number;
  /** Longueur et largeur, en mètres ; `null` quand le bateau ne les annonce pas. */
  length: number | null;
  beam: number | null;
  /** Route suivie, en degrés depuis le nord. */
  course: number;
  /**
   * Sens dans lequel la coque est tournée, en degrés depuis le nord. EuRIS ne le
   * donne pas : en route, c'est la route suivie ; à l'arrêt, l'axe de la voie d'eau.
   */
  heading: number;
  /** Du récepteur de position au milieu de la coque, en mètres : vers l'avant, et vers tribord. */
  centre: { ahead: number; right: number };
  /** Vitesse sur le fond, en km/h. */
  speed: number;
  moving: boolean;
  state: VesselState;
  /** Lieu nommé par le gestionnaire de la voie d'eau (bief, écluse, quai), s'il y en a un. */
  place: string | null;
  /** Instant de la mesure, en millisecondes Unix. */
  seenAt: number;
}

/** Emprise demandée à EuRIS : la Wallonie, en degrés. */
export const VESSEL_BBOX = { minLat: 49.45, minLon: 2.8, maxLat: 50.85, maxLon: 6.45 };
/** EuRIS rend cent bateaux par page ; on n'en lit pas plus de quatre. */
export const VESSEL_PAGE = 100;
export const VESSEL_PAGES = 4;

/** Chemin du relais pour une page de bateaux, sous le préfixe `edge` : la page est désignée par son décalage. */
export const VESSEL_ROUTE = /^\/vessels\/(0|100|200|300)\.json$/;
export const vesselEdgePath = (skip: number): string => `/vessels/${skip}.json`;
export function vesselPageUrl(skip: number): string {
  const { minLat, minLon, maxLat, maxLon } = VESSEL_BBOX;
  return `https://www.eurisportal.eu/api/v3/tracks/bounding-box?minLat=${minLat}&minLon=${minLon}&maxLat=${maxLat}&maxLon=${maxLon}&%24skip=${skip}`;
}
/** Un bateau avance lentement : le relais ressert la même page une demi-minute. */
export const VESSEL_CACHE_SECONDS = 30;
export const VESSEL_POLL_MS = 30_000;
/** Une position plus vieille que cela n'est plus montrée : le bateau a quitté la couverture. */
const STALE_MS = 30 * 60_000;

const STATES: Record<number, VesselState> = { 0: 'underway', 8: 'underway', 1: 'anchored', 5: 'moored', 2: 'restricted', 3: 'restricted', 4: 'restricted', 6: 'aground' };

const STATE_LABELS: Record<VesselState, string> = {
  underway: 'En route', moored: 'Amarré', anchored: 'Au mouillage', restricted: 'Manœuvre restreinte', aground: 'Échoué', unknown: 'Statut non annoncé',
};
export const vesselStateLabel = (vessel: Vessel): string =>
  (vessel.state === 'underway' && !vessel.moving ? 'À l’arrêt' : STATE_LABELS[vessel.state]);

/** Une page de la réponse d'EuRIS : ses bateaux, et s'il en reste à lire. */
export interface VesselPage { vessels: Vessel[]; more: boolean }

/**
 * Lecture tolérante d'une page : ne retient que les bateaux situés en Wallonie,
 * à la position récente, et rien de ce qui les identifierait.
 */
export function parseVesselPage(payload: unknown, now: number): VesselPage {
  const root = payload as { items?: unknown; nextPageLink?: unknown } | null;
  if (!root || !Array.isArray(root.items)) return { vessels: [], more: false };
  const vessels: Vessel[] = [];
  for (const raw of root.items as Record<string, unknown>[]) {
    if (!raw || typeof raw.lat !== 'number' || typeof raw.lon !== 'number' || raw.isLost === true) continue;
    const { x, y } = toLambert(raw.lat, raw.lon);
    // l'emprise demandée à EuRIS est un rectangle : il déborde sur la Flandre et la France
    if (!inWallonia(x, y)) continue;
    const seenAt = Date.parse(String(raw.positionMeasuredAt));
    if (!Number.isFinite(seenAt) || now - seenAt > STALE_MS) continue;
    const size = (value: unknown) => (typeof value === 'number' && value > 0 && value < 400 ? value : null);
    // distances du récepteur à la proue, la poupe, bâbord et tribord : le milieu de la coque s'en déduit
    const span = (value: unknown) => (typeof value === 'number' && value >= 0 && value < 400 ? value : 0);
    const [bow, stern, port, starboard] = [span(raw.dimensionA), span(raw.dimensionB), span(raw.dimensionC), span(raw.dimensionD)];
    const course = typeof raw.courseGround === 'number' && raw.courseGround >= 0 && raw.courseGround < 360 ? raw.courseGround : 0;
    const speed = typeof raw.speedGround === 'number' && raw.speedGround >= 0 && raw.speedGround < 80 ? raw.speedGround : 0;
    vessels.push({
      id: String(raw.trackId),
      x: Math.round(x), y: Math.round(y),
      length: size(raw.length), beam: size(raw.beam),
      course, heading: course,
      centre: { ahead: (bow - stern) / 2, right: (starboard - port) / 2 },
      speed,
      moving: raw.isMoving === true || speed > 0.5,
      state: STATES[raw.navigationalStatus as number] ?? 'unknown',
      place: typeof raw.isrsPositionName === 'string' && raw.isrsPositionName.trim() ? raw.isrsPositionName.trim().slice(0, 80) : null,
      seenAt,
    });
  }
  return { vessels, more: typeof root.nextPageLink === 'string' && root.items.length >= VESSEL_PAGE };
}

/** Légende d'un bateau sur la carte : sa longueur, à défaut « Bateau ». */
export const vesselLabel = (vessel: Vessel): string => (vessel.length ? `${Math.round(vessel.length)} m` : 'Bateau');

const DEG = Math.PI / 180;

/**
 * Tourne chaque coque dans le bon sens. Un bateau en route suit sa route. Un
 * bateau à l'arrêt n'en annonce plus de fiable : il est couché le long de la
 * voie d'eau où il se trouve — des deux sens possibles, celui qui s'accorde le
 * mieux avec sa dernière route connue. Loin de toute voie, rien ne change.
 */
export function settleVessels(vessels: readonly Vessel[], ways: readonly Waterway[]): Vessel[] {
  return vessels.map((vessel) => {
    if (vessel.moving) return { ...vessel, heading: vessel.course };
    const way = waterwayAt(ways, vessel.x, vessel.y);
    if (!way) return { ...vessel, heading: vessel.course };
    const turn = Math.abs(((vessel.course - way.bearing + 540) % 360) - 180);
    return { ...vessel, heading: turn <= 90 ? way.bearing : way.bearing + 180, place: vessel.place ?? titleCase(way.name) };
  });
}

/** Les noms de voies du SPW sont en capitales : « CANAL ALBERT » se lit mieux « Canal Albert ». */
const titleCase = (name: string): string =>
  name.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase())
    .replace(/\b(De|Du|Des|La|Le|Les|Et|A|À|En|Au|Aux|D|L)\b(?!$)/g, (word, _w, at: number) => (at === 0 ? word : word.toLowerCase()))
    // le SPW écrit sans accent la préposition : « Canal du Centre à grand gabarit »
    .replace(/ a /g, ' à ');

/** Milieu de la coque, en Lambert 2008 : le récepteur de position est rarement au centre du bateau. */
export function vesselCentre(vessel: Vessel): { x: number; y: number } {
  const sin = Math.sin(vessel.heading * DEG), cos = Math.cos(vessel.heading * DEG);
  // vers l'avant : (sin, cos) ; vers tribord : (cos, −sin)
  return {
    x: vessel.x + vessel.centre.ahead * sin + vessel.centre.right * cos,
    y: vessel.y + vessel.centre.ahead * cos - vessel.centre.right * sin,
  };
}
