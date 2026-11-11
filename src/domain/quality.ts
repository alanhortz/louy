/**
 * Profils de rendu. Un téléphone n'a ni la mémoire graphique ni le budget
 * thermique d'un ordinateur : on y affiche moins de points, plus gros, et on
 * garde moins de tuiles en mémoire — le streaming reste le même.
 */

export type QualityProfileId = 'desktop' | 'mobile';

export interface QualityProfile {
  id: QualityProfileId;
  /** Seuil de subdivision du quadtree, en pixels d'écran. */
  screenSpaceError: number;
  /** Requêtes de tuiles simultanées. */
  maxConcurrent: number;
  workers: number;
  /** Plafond de points affichés. */
  maxPoints: number;
  /** Tuiles conservées hors champ (LRU), en nombre et en points. */
  cacheTiles: number;
  cachePoints: number;
  maxPixelRatio: number;
  pointSize: number;
  /** Suréchantillonnage couleur au dernier niveau (25 cm). */
  superSample: number;
}

const cores = () => (typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4);

export const QUALITY_PROFILES: Record<QualityProfileId, () => QualityProfile> = {
  desktop: () => ({
    id: 'desktop',
    screenSpaceError: 2.2,
    maxConcurrent: 8,
    workers: Math.max(2, Math.min(4, cores() - 1)),
    maxPoints: 9_000_000,
    cacheTiles: 900,
    cachePoints: 26_000_000,
    maxPixelRatio: 1.5,
    pointSize: 1.75,
    superSample: 2,
  }),
  mobile: () => ({
    id: 'mobile',
    screenSpaceError: 3.2,
    maxConcurrent: 6,
    workers: 2,
    maxPoints: 2_400_000,
    cacheTiles: 260,
    cachePoints: 6_000_000,
    maxPixelRatio: 1.25,
    pointSize: 2.1,
    superSample: 1,
  }),
};
