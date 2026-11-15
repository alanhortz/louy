/**
 * Séquences filmées replacées dans la carte : un extrait de la vidéo d'où vient
 * un lieu reconstruit, montré là où se tenait la caméra qui l'a tourné. La pose
 * de la caméra est connue image par image — retrouvée par la même reconstruction
 * que le lieu — et l'écran qui porte la séquence la suit quand elle bouge.
 */

/** Pose de la caméra à un instant de la séquence. */
export interface ClipKey {
  /** Instant, en secondes depuis le début de la séquence. */
  t: number;
  /** Position de la caméra : Lambert 2008, et altitude au-dessus de la mer, en mètres. */
  x: number;
  y: number;
  altitude: number;
  /**
   * Orientation de la caméra dans le repère du viewer (x = est, y = altitude, z = −nord),
   * en quaternion (x, y, z, w) : la caméra regarde vers −z, le haut de l'image est +y.
   */
  q: [number, number, number, number];
}

export interface ScanClip {
  id: string;
  name: string;
  /** Adresse de la séquence, servie par le site. */
  src: string;
  /** Champ vertical de la caméra, en degrés, et rapport largeur / hauteur de l'image. */
  fov: number;
  aspect: number;
  /** Poses de la caméra, par instants croissants. */
  track: ClipKey[];
}

const isKey = (value: unknown): value is ClipKey => {
  const key = value as Partial<ClipKey> | null;
  return typeof key === 'object' && key !== null
    && [key.t, key.x, key.y, key.altitude].every(Number.isFinite)
    && Array.isArray(key.q) && key.q.length === 4 && key.q.every(Number.isFinite);
};

export const isClip = (value: unknown): value is ScanClip => {
  const clip = value as Partial<ScanClip> | null;
  return typeof clip === 'object' && clip !== null
    && typeof clip.id === 'string' && typeof clip.name === 'string'
    // la séquence vient du site lui-même : aucune adresse extérieure n'est chargée au nom du visiteur
    && typeof clip.src === 'string' && /^\/(?!\/)/.test(clip.src)
    && Number.isFinite(clip.fov) && clip.fov! > 1 && clip.fov! < 170
    && Number.isFinite(clip.aspect) && clip.aspect! > 0
    && Array.isArray(clip.track) && clip.track.length > 0 && clip.track.every(isKey)
    && clip.track.every((key, at) => at === 0 || key.t > clip.track![at - 1]!.t);
};

/** Pose de la caméra à l'instant `t`, interpolée entre les deux poses connues qui l'encadrent. */
export function clipPose(track: readonly ClipKey[], t: number): ClipKey {
  const first = track[0]!, last = track[track.length - 1]!;
  if (t <= first.t) return first;
  if (t >= last.t) return last;
  let after = 1;
  while (track[after]!.t < t) after++;
  const a = track[after - 1]!, b = track[after]!;
  const k = (t - a.t) / (b.t - a.t);
  const mix = (from: number, to: number) => from + (to - from) * k;
  // deux quaternions opposés disent la même orientation : on prend le plus court chemin
  const sign = a.q[0] * b.q[0] + a.q[1] * b.q[1] + a.q[2] * b.q[2] + a.q[3] * b.q[3] < 0 ? -1 : 1;
  const q = a.q.map((value, at) => mix(value, sign * b.q[at]!));
  const norm = Math.hypot(...q) || 1;
  return {
    t, x: mix(a.x, b.x), y: mix(a.y, b.y), altitude: mix(a.altitude, b.altitude),
    q: q.map((value) => value / norm) as ClipKey['q'],
  };
}

/** Cap du regard de la caméra, en degrés depuis le nord, dans le sens des aiguilles d'une montre. */
export function clipHeading([x, y, z, w]: ClipKey['q']): number {
  // l'axe du regard (−z de la caméra) tourné par le quaternion, dont on ne garde que l'est et le nord
  const east = -(2 * (x * z + w * y));
  const north = 1 - 2 * (x * x + y * y);
  return ((Math.atan2(east, north) / Math.PI) * 180 + 360) % 360;
}

/** Largeur de l'écran qui porte la séquence dans la carte, en mètres. */
export const CLIP_SCREEN_WIDTH = 14;

/** Distance entre la caméra et son écran : celle où l'image, large de `CLIP_SCREEN_WIDTH`, remplit exactement son champ. */
export const clipScreenDistance = (clip: ScanClip): number =>
  CLIP_SCREEN_WIDTH / clip.aspect / 2 / Math.tan((clip.fov * Math.PI) / 360);

/**
 * Vue de carte qui montre une séquence : en retrait de la caméra et au-dessus
 * d'elle, dans l'axe de son regard — on voit l'écran, et le paysage qu'il prolonge.
 */
export function clipViewPose(clip: ScanClip): { x: number; y: number; distance: number; azimuth: number; tilt: number } {
  const key = clip.track[0]!;
  const heading = clipHeading(key.q);
  const reach = clipScreenDistance(clip);
  const ahead = reach * 0.5;
  return {
    x: key.x + ahead * Math.sin((heading * Math.PI) / 180),
    y: key.y + ahead * Math.cos((heading * Math.PI) / 180),
    // un téléobjectif a un champ étroit : son écran est loin devant lui, et la vue recule d'autant
    distance: Math.max(CLIP_SCREEN_WIDTH * 4, reach * 3.5),
    azimuth: heading,
    tilt: 70,
  };
}
