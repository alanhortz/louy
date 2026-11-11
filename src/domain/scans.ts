/**
 * Scans 3D : des lieux reconstruits en « gaussian splats » à partir d'une
 * vidéo, puis calés sur le relief LiDAR. Chaque scan est un fichier de splats
 * exprimé dans le repère du viewer (x = est, y = altitude, z = −nord, en
 * mètres) autour d'un point d'ancrage donné en Lambert 2008.
 *
 * Essai local : le manifeste et les fichiers vivent hors du dépôt ; le serveur
 * de développement les expose sous `/local/scans/` (voir `build/local-scans.ts`)
 * et ils ne sont lus qu'en développement.
 */

export interface Scan {
  id: string;
  name: string;
  /** Point d'ancrage, en Lambert 2008. */
  x: number;
  y: number;
  /** Adresse du fichier de splats. */
  splats: string;
  /** Origine des images. */
  credit: string;
  /** Cadrage d'ouverture ; à défaut, la caméra se place au-dessus de l'ancrage. */
  view?: ScanView;
}

export interface ScanView {
  /** Point visé, en Lambert 2008. */
  x: number;
  y: number;
  /** Hauteur de la caméra au-dessus du point visé, en mètres. */
  height: number;
  /** Cap de la vue, en degrés. */
  azimuth: number;
}

export const SCAN_MANIFEST = '/local/scans/index.json';

/** Hauteur de survol à l'ouverture d'un scan sans cadrage propre. */
export const SCAN_HEIGHT = 110;

const isScan = (value: unknown): value is Scan => {
  const scan = value as Partial<Scan> | null;
  return typeof scan === 'object' && scan !== null
    && typeof scan.id === 'string' && typeof scan.name === 'string'
    && Number.isFinite(scan.x) && Number.isFinite(scan.y)
    && typeof scan.splats === 'string' && typeof scan.credit === 'string'
    && (scan.view === undefined || isView(scan.view));
};

const isView = (value: unknown): value is ScanView => {
  const view = value as Partial<ScanView> | null;
  return typeof view === 'object' && view !== null
    && [view.x, view.y, view.height, view.azimuth].every(Number.isFinite);
};

/** Survol qui ouvre un scan : son cadrage s'il en a un, sinon l'aplomb de son ancrage. */
export const scanFlyover = (scan: Scan) => ({
  x: scan.view?.x ?? scan.x,
  y: scan.view?.y ?? scan.y,
  height: scan.view?.height ?? SCAN_HEIGHT,
  azimuth: scan.view?.azimuth,
  orbit: true,
});

/** Lecture tolérante du manifeste : toute entrée incomplète est écartée. */
export const parseScans = (manifest: unknown): Scan[] =>
  Array.isArray(manifest) ? manifest.filter(isScan) : [];
