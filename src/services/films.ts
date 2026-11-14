import {
  parsePreparedFilm, preparedFrameUrl, preparedIndexUrl, type FilmFraming, type TimelineStep,
} from '../domain/timeline.ts';

export interface LoadedFilm {
  frames: (TimelineStep & { url: string })[];
  skipped: TimelineStep[];
}

/** Fait venir une image dans le cache du navigateur ; `false` si elle manque. */
const preload = (url: string, signal: AbortSignal): Promise<boolean> => new Promise((resolve) => {
  const image = new Image();
  const settle = (ok: boolean) => () => resolve(ok);
  image.onload = settle(true);
  image.onerror = settle(false);
  signal.addEventListener('abort', settle(false), { once: true });
  image.src = url;
});

/**
 * Film déjà tourné d'un lieu : son index, puis toutes ses images, téléchargées
 * avant que le film ne commence — il s'enchaîne alors sans à-coup. Une image
 * manquante est simplement retirée du film. Sans index lisible, le film est vide :
 * l'appelant le tournera sur place.
 */
export async function loadPreparedFilm(base: string, framing: FilmFraming, signal: AbortSignal): Promise<LoadedFilm> {
  // l'index est toujours revalidé : seules les images, qui ne changent pas, vivent longtemps en cache
  const response = await fetch(preparedIndexUrl(base), { signal, cache: 'no-cache' });
  const film = response.ok ? parsePreparedFilm(await response.json().catch(() => null)) : null;
  if (!film) return { frames: [], skipped: [] };
  const frames = film.frames.map((step) => ({ ...step, url: preparedFrameUrl(base, framing, step.vintage) }));
  const arrived = await Promise.all(frames.map((frame) => preload(frame.url, signal)));
  return { frames: frames.filter((_, at) => arrived[at]), skipped: film.skipped };
}
