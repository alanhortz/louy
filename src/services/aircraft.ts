import { EDGE_PREFIX } from '../config/project.ts';
import { AIRCRAFT_EDGE_PATH, parseAircraft, type Aircraft } from '../domain/aircraft.ts';

export const AIRCRAFT_SOURCE = 'adsb.lol';

/**
 * Avions actuellement au-dessus de la Wallonie. Toujours par le relais du site :
 * c'est lui qui garde la réponse quelques secondes et parle au réseau à notre place.
 */
export async function loadAircraft(signal: AbortSignal): Promise<Aircraft[]> {
  const response = await fetch(`${EDGE_PREFIX}${AIRCRAFT_EDGE_PATH}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Positions des avions indisponibles (${response.status})`);
  return parseAircraft(await response.json());
}
