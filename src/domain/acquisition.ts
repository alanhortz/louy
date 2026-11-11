/**
 * Mailles de vol du LiDAR 2021-2022 : le SPW publie, pour chaque dalle de
 * 500 m, les dates du premier et du dernier passage de l'avion.
 */

/** Côté d'une maille, en mètres. */
export const FLIGHT_CELL = 500;

export interface FlightCell { cx: number; cy: number }

export interface FlightDates {
  /** Millisecondes Unix. */
  first: number;
  last: number;
}

export const flightCellAt = (x: number, y: number): FlightCell => ({
  cx: Math.floor(x / FLIGHT_CELL),
  cy: Math.floor(y / FLIGHT_CELL),
});

const SERVICE =
  'https://geoservices.wallonie.be/arcgis/rest/services/RELIEF/LIDAR_MAILLES/MapServer/0/query';

/** Requête ArcGIS interrogeant la maille par son centre. */
export function flightDatesUrl({ cx, cy }: FlightCell): string {
  const query = new URLSearchParams({
    geometry: `${(cx + 0.5) * FLIGHT_CELL},${(cy + 0.5) * FLIGHT_CELL}`,
    geometryType: 'esriGeometryPoint',
    inSR: '3812',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'DATE_FIRST,DATE_LAST',
    returnGeometry: 'false',
    f: 'json',
  });
  return `${SERVICE}?${query}`;
}

/** Extrait les dates de la réponse ArcGIS ; `null` hors couverture. */
export function parseFlightDates(payload: unknown): FlightDates | null {
  const attributes = (payload as { features?: { attributes?: Record<string, unknown> }[] })
    ?.features?.[0]?.attributes;
  const first = attributes?.DATE_FIRST;
  const last = attributes?.DATE_LAST;
  return typeof first === 'number' && typeof last === 'number' ? { first, last } : null;
}
