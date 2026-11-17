import { isSatelliteImage, type SatelliteImage } from '../domain/satellite.ts';

/** Images de la vue « Satellite » publiées par le site ; aucune si le fichier manque. */
export async function loadSatelliteImages(signal: AbortSignal): Promise<SatelliteImage[]> {
  const response = await fetch('/data/satellite.json', { signal });
  if (!response.ok) return [];
  const list: unknown = await response.json();
  // une image mise de côté (`disabled`) n'est ni listée ni chargée, comme un relevé mis de côté
  return Array.isArray(list) ? list.filter((entry) => (entry as { disabled?: unknown } | null)?.disabled !== true).filter(isSatelliteImage) : [];
}
