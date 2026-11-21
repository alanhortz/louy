/**
 * Calque « Vidéos » : des vidéos publiées ailleurs, signalées à l'endroit qu'elles montrent. Le site ne les héberge
 * pas et ne les intègre pas : la fiche renvoie vers leur page, qui s'ouvre à part. Rien n'est demandé à leur
 * hébergeur tant que le visiteur n'a pas choisi d'y aller.
 */

import type { ScanCredit } from './scans.ts';

/** Clef de traduction du nom du calque. */
export const VIDEOS_LABEL = 'layer.videos';

export interface WebVideo {
  id: string;
  name: string;
  /** Où le marqueur se pose : Lambert 2008. */
  x: number;
  y: number;
  /** Identifiant de la vidéo sur YouTube : onze caractères, rien d'autre — l'adresse est construite ici. */
  youtube: string;
  /** Instant où commencer, en secondes. */
  start?: number;
  credit: ScanCredit;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export function isWebVideo(value: unknown): value is WebVideo {
  const item = value as Partial<WebVideo> | null;
  return typeof item === 'object' && item !== null
    && typeof item.id === 'string' && typeof item.name === 'string'
    && Number.isFinite(item.x) && Number.isFinite(item.y)
    && typeof item.youtube === 'string' && YOUTUBE_ID.test(item.youtube)
    && (item.start === undefined || (Number.isFinite(item.start) && item.start >= 0))
    && typeof item.credit?.author === 'string' && typeof item.credit?.title === 'string'
    && typeof item.credit?.url === 'string' && typeof item.credit?.licence === 'string';
}

/** Page de la vidéo, à ouvrir hors du site. */
export const videoPageUrl = (video: Pick<WebVideo, 'youtube' | 'start'>): string =>
  `https://www.youtube.com/watch?v=${video.youtube}${video.start ? `&t=${Math.floor(video.start)}s` : ''}`;
