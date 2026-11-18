/**
 * Scans 3D, de deux sortes.
 *
 * Un lieu reconstruit en « gaussian splats » à partir d'une vidéo, calé sur le
 * relief LiDAR et dessiné dans la carte : un fichier de splats exprimé dans le
 * repère du viewer (x = est, y = altitude, z = −nord, en mètres) autour d'un
 * point d'ancrage donné en Lambert 2008.
 *
 * Ou un objet relevé de près — maillage texturé glTF, tel qu'en exporte une
 * application de scan — signalé sur la carte et examiné dans sa propre
 * visionneuse.
 *
 * Les images d'origine viennent de vidéos publiées sous licence libre : chaque
 * scan porte le crédit de son auteur, affiché partout où le scan l'est.
 */

import { isClip, type ScanClip } from './clips.ts';

export interface Scan {
  id: string;
  name: string;
  /** Point d'ancrage, en Lambert 2008. */
  x: number;
  y: number;
  /** Adresse du fichier de splats, pour un lieu dessiné dans la carte. */
  splats?: string;
  /** Adresse du maillage glTF (.glb), pour un objet ouvert dans la visionneuse. */
  mesh?: string;
  /**
   * L'objet est un équipement de survie (défibrillateur…) : il est signalé sur son propre
   * calque, que l'on doit pouvoir trouver sans le chercher parmi les autres objets.
   */
  survival?: SurvivalKind;
  /** L'objet est là pour s'amuser (borne d'arcade…) : il a lui aussi son calque. */
  fun?: FunKind;
  /** L'objet est une œuvre d'art de rue (fresque, lettrage, détail peint…) : elle aussi sur son calque. */
  art?: ArtKind;
  /** L'objet relève d'un projet soutenu par un pouvoir public — la Wallonie : il a son calque, lui aussi. */
  backed?: BackedBy;
  /**
   * Où la balade au sol commence dans ce lieu, en Lambert 2008, et vers où l'on regarde en
   * arrivant (cap en degrés) ; à défaut, à son ancrage, dans le cap de la carte.
   */
  walk?: { x: number; y: number; azimuth?: number };
  /**
   * Le lieu n'est pas filmé mais tracé : des splats fabriqués à partir de données (un réseau routier…),
   * à l'échelle du territoire. Ses positions demandent toute la précision disponible, il descend se
   * poser sur le relief à son arrivée, et l'on ne s'y promène pas à pied.
   */
  trace?: boolean;
  /**
   * Plus grande étendue du lieu au sol, en mètres, quand elle est petite : en dessous de
   * `WALKABLE_SPAN`, il n'y a pas la place de s'y promener et la visite n'est pas proposée.
   */
  span?: number;
  /**
   * Le lieu est une image du sol : des prises de vue faites à la verticale, redressées et posées sur le
   * relief, une tache plate par case. Elle a son propre calque, « Ortho drone », et l'on ne s'y promène pas.
   */
  orthophoto?: boolean;
  /**
   * Le lieu est un nuage de points : ceux que la reconstruction a retrouvés dans les images, avant
   * d'en faire des gaussian splats. Il a son calque, « Nuages de points ».
   */
  cloud?: boolean;
  /** Le même relevé en haute définition, quand il existe : c'est le réglage de l'application qui choisit. */
  hd?: { splats: string };
  /**
   * Aperçu du relevé : le même lieu en dix fois moins de splats. Il s'affiche en premier, le temps que le
   * fichier complet arrive, puis lui cède la place.
   */
  preview?: string;
  /**
   * Où poser le marqueur, quand ce n'est pas sur l'ancrage : plusieurs relevés d'un même lieu
   * (volume, orthophoto, nuage de points) ont le même ancrage, et leurs marqueurs se recouvriraient.
   */
  marker?: { x: number; y: number };
  /**
   * Finesses plus grossières d'un tracé : chacune remplace la précédente quand la vue s'éloigne
   * au-delà de `beyond` mètres, pour que le tracé reste lisible de loin.
   */
  levels?: { splats: string; beyond: number; width?: number }[];
  /**
   * Demi-largeur du trait d'un tracé tel qu'il est fabriqué, en mètres (pour le fichier principal, et `width`
   * de chaque finesse) : le viewer s'en sert pour garder au trait la même épaisseur à l'écran quand la vue recule.
   */
  width?: number;
  /** Noms à poser le long d'un tracé (le numéro d'une route), en Lambert 2008 ; `rank` : les plus importants d'abord. */
  labels?: { text: string; x: number; y: number; rank: number }[];
  /** Ce que disent les couleurs d'un tracé : une ligne par couleur, montrée dans sa fiche. */
  legend?: { label: string; colour: string }[];
  /** Séquences de la vidéo d'origine, replacées dans le lieu là où la caméra les a tournées. */
  clips?: ScanClip[];
  /** Ce qu'il y a à savoir de l'objet ou du lieu, en une phrase ou deux : affiché dans sa visionneuse ou sa fiche. */
  note?: string;
  /** Photos de l'objet tel qu'on le trouve sur place, consultées dans sa visionneuse. */
  photos?: ScanPhoto[];
  /** Auteur et licence des images d'origine. */
  credit: ScanCredit;
  /** Cadrage d'ouverture ; à défaut, la caméra se place au-dessus de l'ancrage. */
  view?: ScanView;
}

export interface ScanCredit {
  author: string;
  /** Titre de la vidéo d'origine. */
  title: string;
  /** Page où la vidéo et sa licence sont publiées. */
  url: string;
  /** Licence, en abrégé (« CC BY »). */
  licence: string;
}

export interface ScanPhoto {
  /** Adresse de la photo, servie par le site. */
  src: string;
  /** Vignette de la même photo ; à défaut, la photo elle-même en tient lieu. */
  thumb?: string;
  /** Ce que la photo montre, en une phrase : c'est aussi son texte de remplacement. */
  caption?: string;
}

export interface ScanView {
  /** Point visé, en Lambert 2008. */
  x: number;
  y: number;
  /** Hauteur de la caméra au-dessus du point visé, en mètres. */
  height: number;
  /** Cap de la vue, en degrés. */
  azimuth: number;
  /**
   * Amplitude de l'orbite d'ouverture, en degrés. Un lieu filmé d'un seul côté
   * n'est net que de ce côté : l'orbite s'arrête avant d'en montrer l'envers.
   * Le signe donne le sens : positif, le cap décroît ; négatif, il croît.
   * À défaut, la caméra tourne jusqu'au premier geste du visiteur.
   */
  sweep?: number;
}

export const SCAN_MANIFEST = '/scans/index.json';

/**
 * Noms donnés au visiteur. Le code dit « scan » ; à l'écran on distingue deux
 * choses, chacune avec son calque : l'imagerie aérienne — un lieu filmé au drone
 * et reconstruit en volume dans la carte — et les objets scannés, relevés de près
 * et examinés dans leur visionneuse.
 */
export const AERIAL_LABEL = 'Imagerie aérienne';
export const OBJECTS_LABEL = 'Objets scannés';
export const SURVIVAL_LABEL = 'Équipements de survie';
export const FUN_LABEL = 'Fun';
export const ART_LABEL = 'Street art';
export const BACKED_LABEL = 'Soutenu par la Wallonie';
export const ORTHO_LABEL = 'Ortho drone';
export const CLOUD_LABEL = 'Nuages de points';

/** Équipements de survie reconnus, et le nom de chacun à l'écran. */
export const SURVIVAL_KINDS = { defibrillator: 'Défibrillateur' } as const;
export type SurvivalKind = keyof typeof SURVIVAL_KINDS;

/** Objets de loisir reconnus, et le nom de chacun à l'écran. */
export const FUN_KINDS = { arcade: 'Borne d’arcade' } as const;
export type FunKind = keyof typeof FUN_KINDS;

/** Soutiens reconnus, et le nom de chacun à l'écran. */
export const BACKERS = { wallonie: 'Projet soutenu par la Wallonie' } as const;
export type BackedBy = keyof typeof BACKERS;

/** Genres d'art reconnus, et le nom de chacun à l'écran. */
export const ART_KINDS = { street: 'Art de rue' } as const;
export type ArtKind = keyof typeof ART_KINDS;

/** Hauteur de survol à l'ouverture d'un scan sans cadrage propre. */
export const SCAN_HEIGHT = 110;

const isScan = (value: unknown): value is Scan => {
  const scan = value as Partial<Scan> | null;
  return typeof scan === 'object' && scan !== null
    && typeof scan.id === 'string' && typeof scan.name === 'string'
    && Number.isFinite(scan.x) && Number.isFinite(scan.y)
    // l'un ou l'autre, jamais les deux : un scan est soit un lieu, soit un objet
    && (typeof scan.splats === 'string') !== (typeof scan.mesh === 'string') && isCredit(scan.credit)
    && (scan.view === undefined || isView(scan.view))
    // une séquence filmée se replace dans un lieu, pas autour d'un objet
    && (scan.clips === undefined || (typeof scan.splats === 'string' && Array.isArray(scan.clips) && scan.clips.every(isClip)))
    // on ne se promène que dans un lieu
    && (scan.walk === undefined || (typeof scan.splats === 'string' && Number.isFinite(scan.walk?.x) && Number.isFinite(scan.walk?.y)
      && (scan.walk?.azimuth === undefined || Number.isFinite(scan.walk.azimuth))))
    && (scan.note === undefined || typeof scan.note === 'string')
    && (scan.trace === undefined || (typeof scan.splats === 'string' && typeof scan.trace === 'boolean'))
    && (scan.span === undefined || (typeof scan.splats === 'string' && Number.isFinite(scan.span) && scan.span > 0))
    && (scan.orthophoto === undefined || (typeof scan.splats === 'string' && typeof scan.orthophoto === 'boolean'))
    && (scan.hd === undefined || (typeof scan.splats === 'string' && typeof scan.hd?.splats === 'string' && /^\/(?!\/)/.test(scan.hd.splats)))
    && (scan.preview === undefined || (typeof scan.splats === 'string' && typeof scan.preview === 'string' && /^\/(?!\/)/.test(scan.preview)))
    && (scan.cloud === undefined || (typeof scan.splats === 'string' && typeof scan.cloud === 'boolean'))
    && (scan.marker === undefined || (Number.isFinite(scan.marker?.x) && Number.isFinite(scan.marker?.y)))
    && (scan.legend === undefined || (Array.isArray(scan.legend)
      && scan.legend.every((entry) => typeof entry?.label === 'string' && /^#[0-9a-f]{6}$/i.test(entry.colour ?? ''))))
    && (scan.labels === undefined || (scan.trace === true && Array.isArray(scan.labels)
      && scan.labels.every((label) => typeof label?.text === 'string' && [label.x, label.y, label.rank].every(Number.isFinite))))
    && (scan.width === undefined || (scan.trace === true && Number.isFinite(scan.width) && scan.width > 0))
    && (scan.levels === undefined || (scan.trace === true && Array.isArray(scan.levels)
      && scan.levels.every((level) => typeof level?.splats === 'string' && /^\/(?!\/)/.test(level.splats) && Number.isFinite(level.beyond) && level.beyond > 0
        && (level.width === undefined || (Number.isFinite(level.width) && level.width > 0)))))
    // des photos n'accompagnent qu'un objet : c'est sa visionneuse qui les montre
    && (scan.photos === undefined || (typeof scan.mesh === 'string' && Array.isArray(scan.photos) && scan.photos.every(isPhoto)))
    // un équipement de survie est toujours un objet, d'un genre connu
    && (scan.survival === undefined || (typeof scan.mesh === 'string' && scan.survival in SURVIVAL_KINDS))
    // de même un objet de loisir ; et un objet n'appartient qu'à une catégorie
    && (scan.fun === undefined || (typeof scan.mesh === 'string' && scan.fun in FUN_KINDS && scan.survival === undefined))
    && (scan.backed === undefined || (typeof scan.mesh === 'string' && scan.backed in BACKERS
      && scan.survival === undefined && scan.fun === undefined && scan.art === undefined))
    && (scan.art === undefined || (typeof scan.mesh === 'string' && scan.art in ART_KINDS
      && scan.survival === undefined && scan.fun === undefined));
};

const isCredit = (value: unknown): value is ScanCredit => {
  const credit = value as Partial<ScanCredit> | null;
  return typeof credit === 'object' && credit !== null
    && [credit.author, credit.title, credit.url, credit.licence].every((field) => typeof field === 'string')
    && /^https:\/\//.test(credit.url!);
};

/** Une photo vient du site lui-même : aucune adresse extérieure n'est chargée au nom du visiteur. */
const isPhoto = (value: unknown): value is ScanPhoto => {
  const photo = value as Partial<ScanPhoto> | null;
  const local = (path: unknown) => typeof path === 'string' && /^\/(?!\/)/.test(path);
  return typeof photo === 'object' && photo !== null && local(photo.src)
    && (photo.thumb === undefined || local(photo.thumb))
    && (photo.caption === undefined || typeof photo.caption === 'string');
};

/** Photos attachées à un objet ; aucune pour la plupart. */
export const scanPhotos = (scan: Scan): readonly ScanPhoto[] => scan.photos ?? [];

const isView = (value: unknown): value is ScanView => {
  const view = value as Partial<ScanView> | null;
  return typeof view === 'object' && view !== null
    && [view.x, view.y, view.height, view.azimuth].every(Number.isFinite)
    && (view.sweep === undefined || Number.isFinite(view.sweep));
};

/** Survol qui ouvre un scan : son cadrage s'il en a un, sinon l'aplomb de son ancrage. */
export const scanFlyover = (scan: Scan) => ({
  x: scan.view?.x ?? scan.x,
  y: scan.view?.y ?? scan.y,
  height: scan.view?.height ?? SCAN_HEIGHT,
  azimuth: scan.view?.azimuth,
  orbit: true,
  turns: scan.view?.sweep === undefined ? undefined : scan.view.sweep / 360,
});

/** Point où la balade au sol commence dans un lieu, quand le visiteur n'en désigne pas un lui-même. */
export const walkStart = (scan: Scan): { x: number; y: number; azimuth?: number } => scan.walk ?? { x: scan.x, y: scan.y };

/** Étendue en dessous de laquelle un lieu est trop petit pour qu'on s'y promène. */
export const WALKABLE_SPAN = 30;

/** Peut-on se poser au sol dans ce lieu et s'y promener ? Ni dans un tracé, ni dans une image du sol, ni dans un lieu de quelques mètres. */
export const isWalkable = (scan: Scan): boolean =>
  scan.splats !== undefined && !scan.trace && !scan.orthophoto && !scan.cloud && (scan.span === undefined || scan.span >= WALKABLE_SPAN);

/** Scans dessinés dans la carte. */
export const placeScans = (scans: readonly Scan[]): Scan[] => scans.filter((scan) => scan.splats !== undefined && !scan.trace && !scan.orthophoto && !scan.cloud);

/** Nuages de points du calque du même nom. */
export const cloudScans = (scans: readonly Scan[]): Scan[] => scans.filter((scan) => scan.splats !== undefined && scan.cloud === true);

/** Images du sol du calque « Ortho drone ». */
export const orthophotoScans = (scans: readonly Scan[]): Scan[] => scans.filter((scan) => scan.splats !== undefined && scan.orthophoto === true);

/** Tracés à l'échelle du territoire : ils ne sont pas des lieux filmés, et ont leur propre calque. */
export const traceScans = (scans: readonly Scan[]): Scan[] => scans.filter((scan) => scan.splats !== undefined && scan.trace === true);

/** L'objet est un équipement de survie, signalé sur son propre calque. */
export const isSurvivalScan = (scan: Scan): boolean => scan.survival !== undefined;

/** L'objet est là pour s'amuser, signalé sur son propre calque. */
export const isFunScan = (scan: Scan): boolean => scan.fun !== undefined;

/** L'objet relève d'un projet soutenu par la Wallonie, signalé sur son propre calque. */
export const isBackedScan = (scan: Scan): boolean => scan.backed !== undefined;

/** L'objet est une œuvre d'art de rue, signalée sur son propre calque. */
export const isArtScan = (scan: Scan): boolean => scan.art !== undefined;

/** Nom du calque auquel un objet appartient : c'est ce que sa visionneuse annonce. */
export const objectLabel = (scan: Scan): string =>
  (isSurvivalScan(scan) ? SURVIVAL_LABEL : isFunScan(scan) ? FUN_LABEL : isArtScan(scan) ? ART_LABEL : isBackedScan(scan) ? BACKED_LABEL : OBJECTS_LABEL);

/** Le scan est un objet, à examiner dans la visionneuse. */
export const isObjectScan = (scan: Scan): boolean => scan.mesh !== undefined;

/** Étendue d'un ensemble de scans : la plus grande distance entre deux d'entre eux, en mètres. */
export const scansSpread = (scans: readonly Scan[]): number =>
  Math.max(0, ...scans.flatMap((a) => scans.map((b) => Math.hypot(a.x - b.x, a.y - b.y))));

/**
 * Survol qui défait un groupe de marqueurs : au-dessus de leur milieu, à une
 * hauteur où l'étendue du groupe occupe une bonne part de l'écran.
 */
export function fitFlyover(scans: readonly Scan[]) {
  const x = scans.reduce((sum, scan) => sum + scan.x, 0) / scans.length;
  const y = scans.reduce((sum, scan) => sum + scan.y, 0) / scans.length;
  return { x, y, height: Math.max(150, scansSpread(scans) * 1.1), orbit: false };
}

/**
 * Lecture tolérante du manifeste : toute entrée incomplète est écartée, ainsi que celles qui sont
 * mises de côté (`disabled`) — un relevé retiré le temps d'être refait, sans perdre sa description.
 */
export const parseScans = (manifest: unknown): Scan[] =>
  Array.isArray(manifest) ? manifest.filter((entry) => (entry as { disabled?: unknown } | null)?.disabled !== true).filter(isScan) : [];

/** Au-delà de cette distance de la vue, un relevé n'est pas téléchargé d'avance : on n'y sera pas de sitôt. */
export const PRELOAD_RADIUS = 3000;

/**
 * Relevés à télécharger d'avance, pour qu'ils s'affichent sans attente quand on y arrive : ceux qui sont
 * proches du point regardé, et seulement ceux-là. Un lieu à cinquante kilomètres coûterait ses mégaoctets
 * à un visiteur qui ne le verra peut-être jamais.
 */
export const scansWorthPreloading = <T extends { x: number; y: number }>(scans: readonly T[], at: { x: number; y: number }): T[] =>
  scans.filter((scan) => Math.hypot(scan.x - at.x, scan.y - at.y) <= PRELOAD_RADIUS);

/** Ordre de chargement : le relevé le plus proche du point regardé d'abord. */
export const nearestFirst = <T extends { x: number; y: number }>(scans: readonly T[], at: { x: number; y: number }): T[] =>
  [...scans].sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y));
