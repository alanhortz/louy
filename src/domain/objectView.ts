/**
 * Visionneuse d'objet : le point de vue d'où l'on examine un scan maillé, et
 * les gestes qui le changent. Logique pure, partagée par la machine et le moteur.
 */

export interface ObjectPose {
  /** Tour autour de l'objet, en degrés. */
  azimuth: number;
  /** Hauteur du regard, en degrés depuis la verticale : 0 = du dessus, 90 = à l'horizontale. */
  polar: number;
  /** Éloignement, en rayons de l'objet : 1 = sa sphère englobante remplit la vue. */
  distance: number;
}

/** Ce que le visiteur fait à la vue : la faire tourner ou s'en approcher. */
export type ObjectGesture = 'rotate' | 'zoom';

export const OBJECT_POSE_LIMITS = {
  polar: { min: 8, max: 88 },
  distance: { min: 0.35, max: 4 },
} as const;

/** Vue d'ouverture : de trois quarts, un peu au-dessus, l'objet entier dans le cadre. */
export const DEFAULT_OBJECT_POSE: ObjectPose = { azimuth: 35, polar: 62, distance: 1.25 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Ramène un point de vue dans les bornes : jamais sous le sol, jamais dans l'objet ni trop loin. */
export function clampObjectPose(pose: ObjectPose): ObjectPose {
  return {
    azimuth: ((pose.azimuth % 360) + 360) % 360,
    polar: clamp(pose.polar, OBJECT_POSE_LIMITS.polar.min, OBJECT_POSE_LIMITS.polar.max),
    distance: clamp(pose.distance, OBJECT_POSE_LIMITS.distance.min, OBJECT_POSE_LIMITS.distance.max),
  };
}

/** Avancement d'un chargement, par quarts : assez pour un journal lisible, sans une ligne par paquet reçu. */
export const progressStep = (fraction: number): number => Math.floor(clamp(fraction, 0, 1) * 4) / 4;
