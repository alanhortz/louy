/**
 * Caméras du réseau routier wallon (SPW Trafiroutes).
 *
 * La liste est récoltée et géolocalisée hors ligne (`npm run cameras:harvest`)
 * car le site source n'autorise pas la lecture depuis un navigateur ; les
 * images, elles, se chargent directement dans une balise `img`. Il n'existe pas
 * de flux vidéo : chaque caméra publie une image fixe renouvelée toutes les six
 * minutes environ.
 *
 * Chaque caméra est placée au point kilométrique incrusté dans son image,
 * reporté sur les bornes du réseau routier régional ; à défaut, sur la localité
 * de son libellé (`approximate`).
 */

export interface RoadCamera {
  id: string;
  label: string;
  /** Axe routier (« E42 », « N4 »…). */
  route: string;
  /** Localité nommée par le libellé ou par le bandeau de l'image. */
  place: string;
  /** Position Lambert 2008. */
  x: number;
  y: number;
  /** Point kilométrique sur la route, quand le bandeau de l'image a pu être lu. */
  km?: number;
  /** Vrai si la position est celle de la localité, faute de point kilométrique. */
  approximate: boolean;
}

const kilometres = new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 1, maximumFractionDigits: 3 });

/** « BK 61,4 » — ou l'aveu que la position n'est que celle de la localité. */
export const positionLabel = (camera: RoadCamera): string =>
  (camera.km === undefined ? 'position approx.' : `BK ${kilometres.format(camera.km)}`);

export const CAMERA_SOURCE = 'SPW Trafiroutes';

/** La source renouvelle l'image toutes les six minutes ; on redemande deux fois plus souvent. */
export const FRAME_REFRESH_MS = 180_000;

const IMAGES = 'https://trafiroutes.wallonie.be/images_uploaded/cameras';

export const thumbnailUrl = (id: string): string => `${IMAGES}/${id}_mini.jpg`;

/** Le paramètre `t` ne sert qu'à contourner le cache du navigateur à chaque période. */
export const frameUrl = (id: string, now = Date.now()): string =>
  `${IMAGES}/${id}.jpg?t=${Math.floor(now / FRAME_REFRESH_MS)}`;

export async function loadCameras(signal: AbortSignal): Promise<RoadCamera[]> {
  const response = await fetch('/data/cameras.json', { signal });
  if (!response.ok) throw new Error(`Liste des caméras indisponible (${response.status})`);
  return (await response.json()) as RoadCamera[];
}

/**
 * Charge une image hors du DOM : l'ancienne reste affichée jusqu'à ce que la
 * nouvelle soit décodée, sans clignotement entre deux rafraîchissements.
 */
export function loadFrame(url: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(url);
    image.onerror = () => reject(new Error('Image de la caméra indisponible'));
    signal.addEventListener('abort', () => { image.src = ''; }, { once: true });
    image.src = url;
  });
}

export function nearestCamera(cameras: readonly RoadCamera[], x: number, y: number): RoadCamera | null {
  let best: RoadCamera | null = null;
  let bestDistance = Infinity;
  for (const camera of cameras) {
    const distance = Math.hypot(camera.x - x, camera.y - y);
    if (distance < bestDistance) { bestDistance = distance; best = camera; }
  }
  return best;
}
