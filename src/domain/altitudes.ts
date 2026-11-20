/**
 * Altitudes exactes du LiDAR : la valeur mesurée par le SPW, au demi-mètre, et non la couleur arrondie par
 * tranches de 3,5 m que rendent ses images.
 *
 * Le SPW les donne par son interrogation ponctuelle (`identify`), sans durée de vie ni adresse stable. Le relais
 * les demande par carrés de 16 m (32 × 32 points, une seule demande au SPW) et les garde sans fin : une campagne
 * LiDAR datée ne change plus.
 *
 *   /edge/v1/altitudes/<MNT|MNS>/<cx>/<cy>.json  →  [altitude en centimètres | null, …] (1024 valeurs)
 *
 * Le carré (cx, cy) couvre [cx × 16, cx × 16 + 16[ en x (Lambert 2008), de même en y ; ses points sont les centres
 * des cellules de 50 cm, ligne par ligne du sud au nord, d'ouest en est.
 *
 * Seule la campagne 2021-2022 : le service 2013-2014 ne répond qu'au premier point d'une demande groupée.
 * Données : © Service public de Wallonie, CC BY 4.0.
 */

import { WALLONIA_EXTENT } from './tiling.ts';

export const ALTITUDE_CELL = 16;
export const ALTITUDE_STEP = 0.5;
export const ALTITUDE_GRID = ALTITUDE_CELL / ALTITUDE_STEP;
export type AltitudeModel = 'MNT' | 'MNS';

export const ALTITUDE_ROUTE = /^\/altitudes\/(MNT|MNS)\/(\d{4,5})\/(\d{4,5})\.json$/;

/** L'interrogation ponctuelle du SPW pour un modèle de la campagne 2021-2022. */
export const identifyUrl = (model: AltitudeModel): string =>
  `https://geoservices.wallonie.be/arcgis/rest/services/RELIEF/WALLONIE_${model}_2021_2022/MapServer/identify`;

export interface AltitudeCell { model: AltitudeModel; cx: number; cy: number }

export function parseAltitudePath(path: string): AltitudeCell | null {
  const match = ALTITUDE_ROUTE.exec(path);
  if (!match) return null;
  const cell = { model: match[1] as AltitudeModel, cx: Number(match[2]), cy: Number(match[3]) };
  const x = cell.cx * ALTITUDE_CELL, y = cell.cy * ALTITUDE_CELL;
  // hors de Wallonie, rien à demander
  if (x + ALTITUDE_CELL <= WALLONIA_EXTENT.xmin || x >= WALLONIA_EXTENT.xmax || y + ALTITUDE_CELL <= WALLONIA_EXTENT.ymin || y >= WALLONIA_EXTENT.ymax) return null;
  return cell;
}

export const altitudeCellPath = ({ model, cx, cy }: AltitudeCell): string => `/altitudes/${model}/${cx}/${cy}.json`;

/** Les centres des 1024 cellules de 50 cm du carré, dans l'ordre de la réponse. */
export function altitudePoints({ cx, cy }: AltitudeCell): [number, number][] {
  const points: [number, number][] = [];
  for (let row = 0; row < ALTITUDE_GRID; row++) {
    for (let col = 0; col < ALTITUDE_GRID; col++) {
      points.push([cx * ALTITUDE_CELL + (col + 0.5) * ALTITUDE_STEP, cy * ALTITUDE_CELL + (row + 0.5) * ALTITUDE_STEP]);
    }
  }
  return points;
}

/** La demande au SPW : tous les points du carré à la fois. */
export function altitudeRequest(cell: AltitudeCell): { url: string; body: string } {
  const x = cell.cx * ALTITUDE_CELL, y = cell.cy * ALTITUDE_CELL;
  const body = new URLSearchParams({
    geometry: JSON.stringify({ points: altitudePoints(cell), spatialReference: { wkid: 3812 } }),
    geometryType: 'esriGeometryMultipoint',
    sr: '3812',
    layers: 'all',
    tolerance: '1',
    returnGeometry: 'false',
    f: 'json',
    imageDisplay: '400,400,96',
    mapExtent: `${x - 5},${y - 5},${x + ALTITUDE_CELL + 5},${y + ALTITUDE_CELL + 5}`,
  });
  return { url: identifyUrl(cell.model), body: body.toString() };
}

/**
 * La réponse du SPW, réduite aux altitudes en centimètres. `null` si elle n'a pas autant de résultats que de
 * points demandés : une réponse partielle ne doit pas être gardée.
 */
export function compactAltitudes(answer: unknown): (number | null)[] | null {
  const results = (answer as { results?: unknown } | null)?.results;
  if (!Array.isArray(results) || results.length !== ALTITUDE_GRID * ALTITUDE_GRID) return null;
  return results.map((result) => {
    const value = Number((result as { attributes?: Record<string, unknown> })?.attributes?.['Stretch.Pixel Value']);
    return Number.isFinite(value) && value > -100 && value < 1000 ? Math.round(value * 100) : null;
  });
}
