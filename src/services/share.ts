/** Partage d'un lien : feuille de partage du système si elle existe, presse-papiers sinon. */

export type ShareOutcome = 'shared' | 'copied';

export interface ShareRequest {
  url: string;
  title: string;
  text: string;
}

/** Le visiteur a refermé la feuille de partage : ce n'est pas une erreur. */
export const isDismissal = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

export async function shareLink(request: ShareRequest): Promise<ShareOutcome> {
  // sur ordinateur, copier le lien est plus direct qu'une feuille de partage
  const prefersSheet = typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches;
  if (prefersSheet && (navigator.canShare?.(request) ?? true)) {
    await navigator.share(request);
    return 'shared';
  }
  await navigator.clipboard.writeText(request.url);
  return 'copied';
}
