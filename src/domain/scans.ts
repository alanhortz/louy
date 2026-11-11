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
}

export const SCAN_MANIFEST = '/local/scans/index.json';

/** Hauteur de survol à l'ouverture d'un scan. */
export const SCAN_HEIGHT = 110;

const isScan = (value: unknown): value is Scan => {
  const scan = value as Partial<Scan> | null;
  return typeof scan === 'object' && scan !== null
    && typeof scan.id === 'string' && typeof scan.name === 'string'
    && Number.isFinite(scan.x) && Number.isFinite(scan.y)
    && typeof scan.splats === 'string' && typeof scan.credit === 'string';
};

/** Lecture tolérante du manifeste : toute entrée incomplète est écartée. */
export const parseScans = (manifest: unknown): Scan[] =>
  Array.isArray(manifest) ? manifest.filter(isScan) : [];
