import { parseScans, SCAN_MANIFEST, type Scan } from '../domain/scans.ts';

/** Scans publiés avec le site. Sans manifeste lisible, il n'y en a simplement aucun. */
export async function loadScans(signal: AbortSignal): Promise<Scan[]> {
  try {
    const response = await fetch(SCAN_MANIFEST, { signal });
    return response.ok ? parseScans(await response.json()) : [];
  } catch {
    return [];
  }
}
