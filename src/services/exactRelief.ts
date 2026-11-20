import { EXACT_RELIEF_INDEX, parseExactRelief, type ExactReliefIndex } from '../domain/exactRelief.ts';

/** Liste des tuiles dont le relief exact est publié ; vide si le fichier manque — le viewer s'en passe alors. */
export async function loadExactRelief(signal: AbortSignal): Promise<ExactReliefIndex> {
  try {
    const response = await fetch(EXACT_RELIEF_INDEX, { signal });
    if (!response.ok || !(response.headers.get('Content-Type') ?? '').includes('json')) return new Map();
    return parseExactRelief(await response.json());
  } catch {
    return new Map();
  }
}
