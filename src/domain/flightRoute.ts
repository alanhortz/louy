/**
 * D'où vient un vol, et où il va.
 *
 * Un avion ne diffuse pas sa destination. On la déduit de son indicatif : la
 * base ouverte adsbdb associe à chaque indicatif de ligne régulière la liaison
 * qu'il dessert. C'est donc la liaison habituelle de ce vol, pas une
 * information venue de l'appareil ; un vol privé, militaire ou affrété n'en a pas.
 */

/** Un aéroport d'une liaison. */
export interface RouteAirport {
  /** Code IATA, à défaut code OACI. */
  code: string;
  city: string;
  name: string;
  /** Code ISO du pays, deux lettres. */
  country: string;
  lat: number;
  lon: number;
}

export interface FlightRoute {
  airline: string | null;
  origin: RouteAirport;
  destination: RouteAirport;
}

export const ROUTE_SOURCE = 'adsbdb';

/** Chemin du relais pour la liaison d'un indicatif, sous le préfixe `edge`. */
export const ROUTE_ROUTE = /^\/aircraft\/route\/([A-Z0-9]{3,8})\.json$/;
export const routeEdgePath = (callsign: string): string => `/aircraft/route/${callsign}.json`;
export const routeUrl = (callsign: string): string => `https://api.adsbdb.com/v0/callsign/${callsign}`;
/** Une liaison ne change pas d'un jour à l'autre : le relais la garde longtemps. */
export const ROUTE_CACHE_SECONDS = 86_400;

/** L'indicatif tel que le relais l'accepte ; `null` s'il ne peut désigner aucune ligne. */
export function routeCallsign(callsign: string | null): string | null {
  const clean = (callsign ?? '').trim().toUpperCase();
  // une ligne régulière : trois lettres de compagnie, puis un numéro de vol
  return /^[A-Z]{3}[0-9][A-Z0-9]{0,4}$/.test(clean) ? clean : null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim().slice(0, 80) : '');

function airport(value: unknown): RouteAirport | null {
  const raw = value as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') return null;
  const code = text(raw.iata_code) || text(raw.icao_code);
  const city = text(raw.municipality) || text(raw.name);
  const { latitude: lat, longitude: lon } = raw;
  if (!code || !city || typeof lat !== 'number' || typeof lon !== 'number') return null;
  return { code, city, name: text(raw.name) || city, country: text(raw.country_iso_name).slice(0, 2), lat, lon };
}

/** Lecture tolérante d'une réponse d'adsbdb ; `null` si la liaison n'y est pas, ou incomplète. */
export function parseRoute(payload: unknown): FlightRoute | null {
  const route = (payload as { response?: { flightroute?: Record<string, unknown> } } | null)?.response?.flightroute;
  if (!route || typeof route !== 'object') return null;
  const origin = airport(route.origin);
  const destination = airport(route.destination);
  if (!origin || !destination) return null;
  return { airline: text((route.airline as Record<string, unknown> | null)?.name) || null, origin, destination };
}

const RAD = Math.PI / 180;
/** Distance entre deux points du globe, en kilomètres. */
function distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const h = Math.sin(((b.lat - a.lat) * RAD) / 2) ** 2
    + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(((b.lon - a.lon) * RAD) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Détour toléré par rapport à la ligne droite : une part de la liaison, plus une marge pour les approches. */
const DETOUR_SHARE = 0.25;
const DETOUR_MARGIN_KM = 150;

/**
 * La liaison est-elle crédible pour un appareil vu à cet endroit ? La base se
 * trompe parfois d'indicatif : un vol annoncé d'Almaty à Hong Kong n'a rien à
 * faire au-dessus de Liège. On ne garde que les liaisons dont l'appareil ne
 * s'écarte pas trop.
 */
export function isPlausibleRoute(route: FlightRoute, position: { lat: number; lon: number }): boolean {
  const direct = distance(route.origin, route.destination);
  const through = distance(route.origin, position) + distance(position, route.destination);
  return through <= direct * (1 + DETOUR_SHARE) + DETOUR_MARGIN_KM;
}
