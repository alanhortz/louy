/** Dates de vol LiDAR sous le point visé, via le CDN ou directement au SPW. */

import { EDGE_PREFIX, TILE_ENDPOINT } from '../config/project.ts';
import {
  flightCellAt, flightDatesUrl, parseFlightDates, type FlightDates,
} from '../domain/acquisition.ts';

const memory = new Map<string, FlightDates | null>();

export async function loadFlightDates(x: number, y: number, signal: AbortSignal): Promise<FlightDates | null> {
  const cell = flightCellAt(x, y);
  const key = `${cell.cx}/${cell.cy}`;
  if (memory.has(key)) return memory.get(key)!;

  const url = TILE_ENDPOINT === 'edge' ? `${EDGE_PREFIX}/flights/${key}.json` : flightDatesUrl(cell);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Dates de vol indisponibles (${response.status})`);
  const dates = parseFlightDates(await response.json());
  memory.set(key, dates);
  return dates;
}
