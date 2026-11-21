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

export type OverlayId = 'places' | 'cameras' | 'aircraft' | 'scans' | 'objects' | 'survival' | 'fun' | 'art' | 'streets' | 'vessels' | 'motorways' | 'orthophoto' | 'clouds' | 'sports' | 'backed' | 'drones' | 'videos';
export type OverlayVisibility = Record<OverlayId, boolean>;

export interface View {
  pose: Pose;
  scene: Scene;
  overlays: OverlayVisibility;
  /** Caméra routière sélectionnée, le cas échéant. */
  cameraId: string | null;
  /** Marqueur actif de chaque calque à sélection, par nom de calque : un lien partagé rouvre ce que l'on regardait. */
  active?: Record<string, string>;
  /** On occupe la caméra du vol de drone actif : un lien partagé y fait entrer directement. */
  cockpit?: boolean;
}

export const POSE_LIMITS = {
  distance: { min: 12, max: 260000 },
  tilt: { min: 2, max: 88 },
} as const;

/**
 * Vue d'accueil : Namur depuis le Grognon, au confluent de la Sambre et de la Meuse, la citadelle
 * en face. Le cadrage est celui d'un écran large ; `homePose` l'adapte aux écrans étroits.
 */
export const DEFAULT_VIEW: View = {
  pose: { x: 685443, y: 627963, distance: 279, azimuth: 288, tilt: 60 },
  scene: DEFAULT_SCENE,
  overlays: { places: true, cameras: false, aircraft: false, scans: true, objects: true, survival: true, fun: false, art: false, streets: false, vessels: false, motorways: false, orthophoto: false, clouds: false, sports: false, backed: true, drones: false, videos: true },
  cameraId: null,
};

/**
 * Imagerie aérienne dessinée d'emblée à la vue d'accueil : la citadelle de Namur et son esplanade. La Sambre
 * et la Halle al'Chair restent à toucher sur leur marqueur. Un lien partagé, lui, ne montre que ce que son auteur regardait.
 */
export const HOME_IMAGERY: readonly string[] = ['namur', 'esplanade-citadelle-namur'];

/**
 * Imagerie épinglée d'office, quel que soit le lien par lequel on arrive. Plus rien pour l'instant : les objets
 * relevés au téléphone (les lettres « NAMUR »…) ne sont plus de l'imagerie aérienne, ils se posent dans la carte
 * quand on touche leur marqueur. Le visiteur peut toujours désépingler ; c'est seulement son état de départ.
 */
export const PINNED_IMAGERY: readonly string[] = [];

/** Rapport largeur / hauteur pour lequel la vue d'accueil a été cadrée. */
const HOME_ASPECT = 1.6;

/**
 * La vue d'accueil pour un écran de rapport `aspect` : sur un écran plus étroit, la vue recule
 * pour que la citadelle et le Grognon tiennent encore tous deux dans la largeur.
 */
export function homePose(aspect: number): Pose {
  const narrow = Number.isFinite(aspect) && aspect > 0 ? Math.min(3.2, Math.max(1, HOME_ASPECT / aspect)) : 1;
  return { ...DEFAULT_VIEW.pose, distance: Math.round(DEFAULT_VIEW.pose.distance * narrow) };
}

const OVERLAY_CODES: Record<OverlayId, string> = { places: 'p', cameras: 'c', aircraft: 'a', scans: 'i', objects: 'o', survival: 'd', fun: 'f', art: 't', streets: 'r', vessels: 'b', motorways: 'm', orthophoto: 's', clouds: 'n', sports: 'k', backed: 'w', drones: 'v', videos: 'u' };
/**
 * L'imagerie aérienne, les objets scannés et les équipements de survie sont nés après les premiers liens
 * partagés : un lien qui ne les mentionne pas ne les a pas éteints, il les
 * ignore. Ils ne sont donc tenus pour éteints que si le lien le dit
 * expressément, par ces lettres.
 */
const SCANS_OFF = 'x';
const OBJECTS_OFF = 'y';
const SURVIVAL_OFF = 'z';

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

/** Nom de calque ou identifiant d'élément admis dans l'adresse : rien qui puisse y porter autre chose. */
const ACTIVE_NAME = /^[a-z0-9-]{1,64}$/;

/** Sérialise une vue en fragment d'URL (sans le `#`). */
export function encodeView(view: View): string {
  const { pose, scene, overlays, cameraId } = view;
  const params = new URLSearchParams();
  // un cap de 359,6° s'arrondit à 360 : on le ramène à 0
  const azimuth = Math.round(pose.azimuth) % 360;
  params.set('c', [pose.x, pose.y, pose.distance, azimuth, pose.tilt].map(Math.round).join(','));
  params.set('s', [scene.campaign, scene.surface, scene.tint, scene.vintage].join('.'));
  const visible = (Object.keys(OVERLAY_CODES) as OverlayId[])
    .filter((id) => overlays[id])
    .map((id) => OVERLAY_CODES[id])
    .join('');
  params.set('o', `${visible}${overlays.scans ? '' : SCANS_OFF}${overlays.objects ? '' : OBJECTS_OFF}${overlays.survival ? '' : SURVIVAL_OFF}`);
  if (cameraId) params.set('cam', cameraId);
  const active = Object.entries(view.active ?? {}).filter(([layer, id]) => ACTIVE_NAME.test(layer) && ACTIVE_NAME.test(id));
  if (active.length > 0) params.set('sel', active.map(([layer, id]) => `${layer}:${id}`).join(','));
  if (view.cockpit) params.set('cockpit', '1');
  // les virgules et les points sont sûrs dans un fragment : on garde le lien lisible
  return params.toString().replaceAll('%2C', ',').replaceAll('%3A', ':');
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
  const sel = (params.get('sel') ?? '').split(',').map((pair) => pair.split(':'))
    .filter((pair): pair is [string, string] => pair.length === 2 && ACTIVE_NAME.test(pair[0]!) && ACTIVE_NAME.test(pair[1]!));

  return {
    pose: normalizePose((params.get('c') ?? '').split(',').map(Number), fallback.pose),
    scene: params.has('s')
      ? normalizeScene({ campaign, surface, tint, vintage } as Partial<Scene>)
      : fallback.scene,
    overlays: codes === null
      ? fallback.overlays
      : {
        places: codes.includes(OVERLAY_CODES.places),
        cameras: codes.includes(OVERLAY_CODES.cameras),
        aircraft: codes.includes(OVERLAY_CODES.aircraft),
        scans: !codes.includes(SCANS_OFF),
        objects: !codes.includes(OBJECTS_OFF),
        survival: !codes.includes(SURVIVAL_OFF),
        fun: codes.includes(OVERLAY_CODES.fun),
        art: codes.includes(OVERLAY_CODES.art),
        streets: codes.includes(OVERLAY_CODES.streets),
        vessels: codes.includes(OVERLAY_CODES.vessels),
        motorways: codes.includes(OVERLAY_CODES.motorways),
        orthophoto: codes.includes(OVERLAY_CODES.orthophoto),
        clouds: codes.includes(OVERLAY_CODES.clouds),
        sports: codes.includes(OVERLAY_CODES.sports),
        backed: codes.includes(OVERLAY_CODES.backed),
        drones: codes.includes(OVERLAY_CODES.drones),
        videos: codes.includes(OVERLAY_CODES.videos),
      },
    cameraId: cameraId && /^\d{1,6}$/.test(cameraId) ? cameraId : null,
    ...(sel.length > 0 ? { active: Object.fromEntries(sel) } : {}),
    ...(params.get('cockpit') === '1' ? { cockpit: true } : {}),
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
