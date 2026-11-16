/**
 * Vue d'une caméra routière : où elle est, vers où elle regarde, et ce que
 * chaque pixel de son image montre du sol.
 *
 * La pose d'une caméra est retrouvée hors ligne, en comparant son image à
 * l'orthophoto et au relief ; elle est publiée avec le site. Ces caméras ont un
 * objectif très grand-angle : plus un point s'écarte de l'axe, plus l'image le
 * ramène vers le centre. `bend` le mesure, de 1 (objectif sans déformation) à
 * presque 0 (œil de poisson, où l'écart à l'axe croît comme l'angle).
 *
 * Positions en Lambert 2008 (x vers l'est, y vers le nord), altitudes en mètres.
 */

import type { Pose } from './view.ts';
import { POSE_LIMITS } from './view.ts';

/** Taille des images publiées par la source : la focale d'une pose s'entend pour cette largeur. */
export const CAMERA_IMAGE = { width: 800, height: 450 } as const;
/** Bandeau incrusté en haut à gauche de chaque image (route, borne, heure) : ce n'est pas le paysage. */
export const CAMERA_BANNER = { width: 600, height: 36 } as const;
/** Au-delà, un pixel couvre trop de sol pour qu'on le pose sur la carte. */
export const CAMERA_REACH = 450;

export interface CameraPose {
  x: number;
  y: number;
  /** Altitude de l'objectif. */
  altitude: number;
  /** Hauteur de l'objectif au-dessus du sol. */
  height: number;
  /** Direction du regard, en degrés depuis le nord. */
  azimuth: number;
  /** Plongée du regard, en degrés : négative vers le sol. */
  pitch: number;
  /** Inclinaison de l'image autour du regard, en degrés. */
  roll: number;
  /** Focale, en pixels de l'image. */
  focal: number;
  bend: number;
}

const DEG = Math.PI / 180;

export interface Vector { east: number; north: number; up: number }

/** Direction, normée, de ce que montre le pixel (u, v) de l'image — v vers le bas. */
export function cameraRay(pose: CameraPose, u: number, v: number): Vector {
  const px = (u - CAMERA_IMAGE.width / 2) / pose.focal;
  const py = (CAMERA_IMAGE.height / 2 - v) / pose.focal;
  const bent = Math.hypot(px, py);
  // l'écart dans l'image redevient un angle, puis un écart sur un plan devant l'objectif
  const spread = bent < 1e-9 ? 1 : Math.tan(Math.min(Math.atan(bent * pose.bend) / pose.bend, 1.5)) / bent;
  const a = px * spread, b = py * spread;
  const roll = pose.roll * DEG, pitch = pose.pitch * DEG, yaw = pose.azimuth * DEG;
  const right = a * Math.cos(roll) - b * Math.sin(roll);
  const rise = a * Math.sin(roll) + b * Math.cos(roll);
  const forward = Math.cos(pitch) - rise * Math.sin(pitch);
  const up = Math.sin(pitch) + rise * Math.cos(pitch);
  const east = forward * Math.sin(yaw) + right * Math.cos(yaw);
  const north = forward * Math.cos(yaw) - right * Math.sin(yaw);
  const length = Math.hypot(east, north, up);
  return { east: east / length, north: north / length, up: up / length };
}

/**
 * Premier point du sol que montre un pixel ; `null` s'il regarde le ciel ou plus
 * loin que `CAMERA_REACH`. `ground` donne l'altitude du sol en un point.
 */
export function castCameraPixel(
  pose: CameraPose,
  u: number,
  v: number,
  ground: (x: number, y: number) => number,
): { x: number; y: number; altitude: number } | null {
  const ray = cameraRay(pose, u, v);
  if (ray.up >= -0.02) return null;
  let before = 0, above = pose.altitude - ground(pose.x, pose.y);
  // le pas s'allonge avec la distance, comme le sol que couvre un pixel
  for (let t = 1.5; t <= CAMERA_REACH; t *= 1.08) {
    const x = pose.x + ray.east * t, y = pose.y + ray.north * t;
    const over = pose.altitude + ray.up * t - ground(x, y);
    if (over <= 0) {
      const hit = before + ((t - before) * above) / (above - over);
      const hx = pose.x + ray.east * hit, hy = pose.y + ray.north * hit;
      return { x: hx, y: hy, altitude: ground(hx, hy) };
    }
    before = t;
    above = over;
  }
  return null;
}

/** La vue de la carte qui se tient à la place de la caméra et regarde dans son axe. */
export function cameraViewPose(pose: CameraPose): Pose {
  const axis = cameraRay(pose, CAMERA_IMAGE.width / 2, CAMERA_IMAGE.height / 2);
  // le point visé est celui où l'axe touche le sol ; un regard presque horizontal vise seulement loin
  const distance = Math.min(CAMERA_REACH, Math.max(POSE_LIMITS.distance.min, pose.height / Math.max(-axis.up, 0.02)));
  const tilt = Math.acos(Math.min(1, Math.max(0, -axis.up))) / DEG;
  return {
    x: pose.x + axis.east * distance,
    y: pose.y + axis.north * distance,
    distance,
    azimuth: ((Math.atan2(axis.east, axis.north) / DEG) % 360 + 360) % 360,
    tilt: Math.min(POSE_LIMITS.tilt.max, Math.max(POSE_LIMITS.tilt.min, tilt)),
  };
}

/** Adresse du relais qui sert l'image d'une caméra de façon lisible par le viewer. */
export const CAMERA_EDGE_ROUTE = /^\/cameras\/(\d{1,3})\.jpg$/;
export const cameraEdgePath = (id: string): string => `/cameras/${id}.jpg`;
/** La source renouvelle l'image toutes les six minutes : la garder deux minutes ne la vieillit guère. */
export const CAMERA_IMAGE_CACHE_SECONDS = 120;
export const cameraSourceUrl = (id: string): string => `https://trafiroutes.wallonie.be/images_uploaded/cameras/${id}.jpg`;
