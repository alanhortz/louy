import { EDGE_PREFIX } from '../config/project.ts';
import { VESSEL_PAGE, VESSEL_PAGES, parseVesselPage, settleVessels, vesselEdgePath, type Vessel } from '../domain/vessels.ts';
import { WATERWAYS_PATH, parseWaterways, type Waterway } from '../domain/waterways.ts';

let waterways: Promise<Waterway[]> | null = null;

/** Tracé des voies navigables, publié avec le site ; chargé une fois. Sans lui, les bateaux gardent leur route annoncée. */
function loadWaterways(): Promise<Waterway[]> {
  waterways ??= fetch(WATERWAYS_PATH)
    .then((response) => (response.ok ? response.json() : []))
    .then(parseWaterways)
    .catch(() => []);
  return waterways;
}

/**
 * Bateaux actuellement sur les voies navigables wallonnes. Toujours par le
 * relais du site, page après page tant qu'EuRIS dit qu'il en reste.
 */
export async function loadVessels(signal: AbortSignal): Promise<Vessel[]> {
  const vessels = new Map<string, Vessel>();
  for (let page = 0; page < VESSEL_PAGES; page++) {
    // jamais depuis le cache du navigateur : c'est le relais qui garde la page, une demi-minute
    const response = await fetch(`${EDGE_PREFIX}${vesselEdgePath(page * VESSEL_PAGE)}`, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`Positions des bateaux indisponibles (${response.status})`);
    const { vessels: found, more } = parseVesselPage(await response.json(), Date.now());
    for (const vessel of found) vessels.set(vessel.id, vessel);
    if (!more) break;
  }
  return settleVessels([...vessels.values()], await loadWaterways());
}
