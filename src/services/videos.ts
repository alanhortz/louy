import { isWebVideo, type WebVideo } from '../domain/videos.ts';

/** Vidéos signalées sur la carte ; aucune si le fichier manque. */
export async function loadVideos(signal: AbortSignal): Promise<WebVideo[]> {
  const response = await fetch('/data/videos.json', { signal, cache: 'no-cache' });
  if (!response.ok) return [];
  const list: unknown = await response.json();
  return Array.isArray(list) ? list.filter(isWebVideo) : [];
}
