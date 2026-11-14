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
 * Nom donné au visiteur. Le code dit « scan » ; à l'écran on parle d'imagerie,
 * terme qui se comprend sans connaître la technique.
 */
export const SCANS_LABEL = 'Imagerie 3D';

/** Hauteur de survol à l'ouverture d'un scan sans cadrage propre. */
export const SCAN_HEIGHT = 110;

const isScan = (value: unknown): value is Scan => {
  const scan = value as Partial<Scan> | null;
  return typeof scan === 'object' && scan !== null
    && typeof scan.id === 'string' && typeof scan.name === 'string'
    && Number.isFinite(scan.x) && Number.isFinite(scan.y)
    // l'un ou l'autre, jamais les deux : un scan est soit un lieu, soit un objet
    && (typeof scan.splats === 'string') !== (typeof scan.mesh === 'string') && isCredit(scan.credit)
    && (scan.view === undefined || isView(scan.view));
};

const isCredit = (value: unknown): value is ScanCredit => {
  const credit = value as Partial<ScanCredit> | null;
  return typeof credit === 'object' && credit !== null
    && [credit.author, credit.title, credit.url, credit.licence].every((field) => typeof field === 'string')
    && /^https:\/\//.test(credit.url!);
};

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

/** Scans dessinés dans la carte. */
export const placeScans = (scans: readonly Scan[]): Scan[] => scans.filter((scan) => scan.splats !== undefined);

/** Le scan est un objet, à examiner dans la visionneuse. */
export const isObjectScan = (scan: Scan): boolean => scan.mesh !== undefined;

/**
 * Distance au sol, en mètres, sous laquelle deux objets partagent le même
 * marqueur : plus proches, leurs marqueurs se recouvriraient à l'écran et un
 * seul resterait accessible. Elle suit l'éloignement de la caméra — environ
 * soixante-dix pixels d'écran — : de loin les objets voisins se rassemblent, et
 * dès que l'on s'approche assez chacun retrouve sa place.
 */
export const scanGroupRadius = (distance: number): number => distance * 0.07;

/**
 * Regroupe les objets voisins. Deux objets sont du même groupe s'ils sont à
 * portée l'un de l'autre, directement ou par un voisin commun ; l'ordre du
 * manifeste est conservé, dans les groupes comme entre eux.
 */
export function groupObjects(scans: readonly Scan[], radius: number): Scan[][] {
  const groups: Scan[][] = [];
  for (const scan of scans.filter(isObjectScan)) {
    const near = groups.filter((group) =>
      group.some((other) => Math.hypot(other.x - scan.x, other.y - scan.y) <= radius));
    if (near.length === 0) { groups.push([scan]); continue; }
    // l'objet relie peut-être plusieurs groupes jusque-là distincts : ils n'en font plus qu'un
    const [first, ...others] = near as [Scan[], ...Scan[][]];
    first.push(...others.flat(), scan);
    for (const merged of others) groups.splice(groups.indexOf(merged), 1);
  }
  return groups;
}

/** Lecture tolérante du manifeste : toute entrée incomplète est écartée. */
export const parseScans = (manifest: unknown): Scan[] =>
  Array.isArray(manifest) ? manifest.filter(isScan) : [];
