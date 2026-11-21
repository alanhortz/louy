/**
 * Définition des relevés : comme le réglage de qualité d'un lecteur vidéo, pour
 * toute l'application. Un relevé peut exister en deux définitions — la standard,
 * légère, et la haute, tirée des images à leur pleine résolution. Le visiteur
 * choisit laquelle il regarde, et passe de l'une à l'autre pour comparer.
 *
 * Un relevé qui n'a pas de version haute reste affiché en standard. À défaut de choix, c'est la haute que
 * l'on montre : la précision d'abord.
 */

import type { SatelliteImage } from './satellite.ts';
import type { Scan } from './scans.ts';

export type Definition = 'standard' | 'high';

/** Les deux définitions, dans l'ordre d'affichage ; libellé et explication : clefs `settings.<id>` et `settings.<id>Hint`. */
export const DEFINITIONS: readonly { id: Definition }[] = [
  { id: 'standard' },
  { id: 'high' },
];

export const isDefinition = (value: unknown): value is Definition => value === 'standard' || value === 'high';

/** Le relevé tel qu'il se dessine dans la définition choisie. */
export const scanIn = (scan: Scan, definition: Definition): Scan =>
  (definition === 'high' && scan.hd?.splats ? { ...scan, splats: scan.hd.splats, more: scan.hd.more } : scan);

/** De même pour une image de la vue satellite. */
export const satelliteIn = (image: SatelliteImage, definition: Definition): SatelliteImage =>
  (definition === 'high' && image.hd?.src ? { ...image, src: image.hd.src } : image);

/** Le relevé existe-t-il en haute définition ? */
export const hasHighDefinition = (scan: Scan): boolean => scan.hd?.splats !== undefined;
