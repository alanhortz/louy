import { isDroneFlight, type DroneFlight } from '../domain/droneFlights.ts';

/** Vols de drone publiés par le site ; aucun si le fichier manque. */
export async function loadDroneFlights(signal: AbortSignal): Promise<DroneFlight[]> {
  const response = await fetch('/data/drone-flights.json', { signal });
  if (!response.ok) return [];
  const list: unknown = await response.json();
  return Array.isArray(list) ? list.filter(isDroneFlight) : [];
}
