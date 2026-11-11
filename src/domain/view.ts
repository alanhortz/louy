/**
 * La vue partageable : où est la caméra, quelle scène est affichée, quelles
 * couches sont visibles. Tout tient dans le fragment de l'URL, de sorte qu'un
 * lien copié restitue exactement ce que voyait son auteur.
 *
 *   #c=685070,627918,1400,12,55&s=2021-2022.mns.ortho.last&o=pc&cam=519
 */

import { WALLONIA_EXTENT } from './tiling.ts';
import { DEFAULT_SCENE, normalizeScene, type Scene } from './scene.ts';

/** Pose de la caméra : point visé (Lambert 2008), distance, cap et inclinaison. */
export interface Pose {
  x: number;
  y: number;
  /** Distance caméra → point visé, en mètres. */
  distance: number;
  /** Cap, en degrés (0 = nord en haut). */
  azimuth: number;
  /** Inclinaison, en degrés (0 = à la verticale, 90 = rasant). */
  tilt: number;
}

export type OverlayId = 'places' | 'cameras';
export type OverlayVisibility = Record<OverlayId, boolean>;

export interface View {
  pose: Pose;
  scene: Scene;
  overlays: OverlayVisibility;
  /** Caméra routière sélectionnée, le cas échéant. */
  cameraId: string | null;
}

export const POSE_LIMITS = {
  distance: { min: 12, max: 260000 },
  tilt: { min: 2, max: 88 },
} as const;

/**
 * Vue d'accueil : la citadelle de Namur, au confluent de la Sambre et de la Meuse.
 * Sa distance est un plafond : à l'ouverture, le moteur s'approche jusqu'à ce que
 * le relief s'affiche à sa résolution native (voir `SceneEngine.setPose`).
 */
export const DEFAULT_VIEW: View = {
  pose: { x: 685070, y: 627918, distance: 1800, azimuth: 0, tilt: 58 },
  scene: DEFAULT_SCENE,
  overlays: { places: true, cameras: false },
  cameraId: null,
};

const OVERLAY_CODES: Record<OverlayId, string> = { places: 'p', cameras: 'c' };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function normalizePose(values: number[], fallback: Pose): Pose {
  if (values.length < 3 || values.some((v) => !Number.isFinite(v))) return fallback;
  const [x, y, distance, azimuth = 0, tilt = fallback.tilt] = values as [number, number, number, number?, number?];
  return {
    x: clamp(x, WALLONIA_EXTENT.xmin, WALLONIA_EXTENT.xmax),
    y: clamp(y, WALLONIA_EXTENT.ymin, WALLONIA_EXTENT.ymax),
    distance: clamp(distance, POSE_LIMITS.distance.min, POSE_LIMITS.distance.max),
    azimuth: ((azimuth % 360) + 360) % 360,
    tilt: clamp(tilt, POSE_LIMITS.tilt.min, POSE_LIMITS.tilt.max),
  };
}

/** Sérialise une vue en fragment d'URL (sans le `#`). */
export function encodeView(view: View): string {
  const { pose, scene, overlays, cameraId } = view;
  const params = new URLSearchParams();
  params.set('c', [pose.x, pose.y, pose.distance, pose.azimuth, pose.tilt].map(Math.round).join(','));
  params.set('s', [scene.campaign, scene.surface, scene.tint, scene.vintage].join('.'));
  const visible = (Object.keys(OVERLAY_CODES) as OverlayId[])
    .filter((id) => overlays[id])
    .map((id) => OVERLAY_CODES[id])
    .join('');
  params.set('o', visible);
  if (cameraId) params.set('cam', cameraId);
  // les virgules et les points sont sûrs dans un fragment : on garde le lien lisible
  return params.toString().replaceAll('%2C', ',');
}

/**
 * Relit un fragment d'URL. Tolérant par construction : toute valeur absente ou
 * invalide retombe sur la vue d'accueil, un lien abîmé ouvre donc quand même
 * le viewer.
 */
export function decodeView(fragment: string, fallback: View = DEFAULT_VIEW): View {
  const params = new URLSearchParams(fragment.replace(/^#/, ''));
  const [campaign, surface, tint, vintage] = (params.get('s') ?? '').split('.');
  const codes = params.get('o');
  const cameraId = params.get('cam');

  return {
    pose: normalizePose((params.get('c') ?? '').split(',').map(Number), fallback.pose),
    scene: params.has('s')
      ? normalizeScene({ campaign, surface, tint, vintage } as Partial<Scene>)
      : fallback.scene,
    overlays: codes === null
      ? fallback.overlays
      : { places: codes.includes(OVERLAY_CODES.places), cameras: codes.includes(OVERLAY_CODES.cameras) },
    cameraId: cameraId && /^\d{1,6}$/.test(cameraId) ? cameraId : null,
  };
}

/** Un fragment d'URL désigne-t-il un point de vue précis ? Sinon, on ouvre sur la vue d'accueil. */
export const hasPose = (fragment: string): boolean =>
  new URLSearchParams(fragment.replace(/^#/, '')).has('c');

/** Lien absolu vers une vue. */
export function viewUrl(view: View, base: string): string {
  const url = new URL(base);
  url.hash = encodeView(view);
  return url.toString();
}
