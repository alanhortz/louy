import { parseScans, SCAN_MANIFEST, type Scan } from '../domain/scans.ts';

/** Scans publiés avec le site. Sans manifeste lisible, il n'y en a simplement aucun. */
export async function loadScans(signal: AbortSignal): Promise<Scan[]> {
  try {
    // La liste est toujours revalidée auprès du serveur : gardée en cache un jour comme les gros
    // fichiers qu'elle annonce, elle cachait les scans ajoutés depuis la dernière visite.
    const response = await fetch(SCAN_MANIFEST, { signal, cache: 'no-cache' });
    return response.ok ? parseScans(await response.json()) : [];
  } catch {
    return [];
  }
}
