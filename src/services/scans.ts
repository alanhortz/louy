import { parseScans, SCAN_MANIFEST, type Scan } from '../domain/scans.ts';

/**
 * Scans disponibles sur ce poste. Une liste vide est la situation normale :
 * hors développement on ne cherche même pas, et sans manifeste il n'y a rien.
 */
export async function loadScans(signal: AbortSignal): Promise<Scan[]> {
  if (!import.meta.env.DEV) return [];
  try {
    const response = await fetch(SCAN_MANIFEST, { signal });
    return response.ok ? parseScans(await response.json()) : [];
  } catch {
    return [];
  }
}
