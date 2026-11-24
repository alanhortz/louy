/**
 * Définition des relevés : comme le réglage de qualité d'un lecteur vidéo, pour
 * toute l'application. Un relevé peut exister en deux définitions — la standard,
 * légère, et la haute, tirée des images à leur pleine résolution. Le visiteur
 * choisit laquelle il regarde, et passe de l'une à l'autre pour comparer.
 *
 * Un relevé qui n'a pas de version haute reste affiché en standard. À défaut de choix, c'est la haute que
 * l'on montre sur un ordinateur : la précision d'abord.
 *
 * Un téléphone n'a ni la mémoire ni le réseau d'un ordinateur : chaque définition y descend d'un cran. La standard y
 * devient la version légère du relevé (quand il en a une), la haute y devient la standard ; et à défaut de choix,
 * c'est la standard — donc la légère — que l'on montre.
 */

import type { QualityProfileId } from './quality.ts';
import type { SatelliteImage } from './satellite.ts';
import type { Scan } from './scans.ts';

export type Definition = 'standard' | 'high';

/** Les deux définitions, dans l'ordre d'affichage ; libellé et explication : clefs `settings.<id>` et `settings.<id>Hint`. */
export const DEFINITIONS: readonly { id: Definition }[] = [
  { id: 'standard' },
  { id: 'high' },
];

export const isDefinition = (value: unknown): value is Definition => value === 'standard' || value === 'high';

/** Ce que l'on montre à qui n'a rien choisi : la haute sur un ordinateur, la standard sur un téléphone. */
export const defaultDefinition = (profile: QualityProfileId): Definition => (profile === 'mobile' ? 'standard' : 'high');

/** Le relevé tel qu'il se dessine dans la définition choisie, sur cet appareil. */
export function scanIn(scan: Scan, definition: Definition, profile: QualityProfileId = 'desktop'): Scan {
  if (profile === 'mobile') {
    // un cran plus bas : la haute y est la standard, la standard y est la légère
    return definition === 'standard' && scan.light ? { ...scan, splats: scan.light, more: undefined } : scan;
  }
  return definition === 'high' && scan.hd?.splats ? { ...scan, splats: scan.hd.splats, more: scan.hd.more } : scan;
}

/** De même pour une image de la vue satellite. */
export const satelliteIn = (image: SatelliteImage, definition: Definition): SatelliteImage =>
  (definition === 'high' && image.hd?.src ? { ...image, src: image.hd.src } : image);

/** Le relevé existe-t-il en haute définition ? */
export const hasHighDefinition = (scan: Scan): boolean => scan.hd?.splats !== undefined;
