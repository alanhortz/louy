import { EDGE_PREFIX } from '../config/project.ts';
import { VESSEL_PAGE, VESSEL_PAGES, parseVesselPage, vesselEdgePath, type Vessel } from '../domain/vessels.ts';

/**
 * Bateaux actuellement sur les voies navigables wallonnes. Toujours par le
 * relais du site, page après page tant qu'EuRIS dit qu'il en reste.
 */
export async function loadVessels(signal: AbortSignal): Promise<Vessel[]> {
  const vessels = new Map<string, Vessel>();
  for (let page = 0; page < VESSEL_PAGES; page++) {
    const response = await fetch(`${EDGE_PREFIX}${vesselEdgePath(page * VESSEL_PAGE)}`, { signal });
    if (!response.ok) throw new Error(`Positions des bateaux indisponibles (${response.status})`);
    const { vessels: found, more } = parseVesselPage(await response.json(), Date.now());
    for (const vessel of found) vessels.set(vessel.id, vessel);
    if (!more) break;
  }
  return [...vessels.values()];
}
