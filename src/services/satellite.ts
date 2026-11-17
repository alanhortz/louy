import { isSatelliteImage, type SatelliteImage } from '../domain/satellite.ts';

/** Images de la vue « Satellite » publiées par le site ; aucune si le fichier manque. */
export async function loadSatelliteImages(signal: AbortSignal): Promise<SatelliteImage[]> {
  const response = await fetch('/data/satellite.json', { signal });
  if (!response.ok) return [];
  const list: unknown = await response.json();
  return Array.isArray(list) ? list.filter(isSatelliteImage) : [];
}
