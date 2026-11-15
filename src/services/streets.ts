import { EDGE_PREFIX, TILE_ENDPOINT } from '../config/project.ts';
import {
  buildStreetCell, parseStreetCell, parseStreetSearch, streetCellUrl, streetEdgePath, streetQuery,
  streetSearchEdgePath, streetSearchUrl,
  type Street, type StreetCell, type StreetLabel,
} from '../domain/streets.ts';

/**
 * En production, tout passe par le relais du site, qui garde les réponses. En
 * développement il n'y a pas de relais : les services du SPW sont appelés
 * directement, et la dalle est réduite ici comme le relais le ferait.
 */
const viaEdge = TILE_ENDPOINT === 'edge';

/** Rues qui répondent à une saisie. Une saisie trop courte n'en demande aucune. */
export async function searchStreets(input: string, signal: AbortSignal): Promise<Street[]> {
  const query = streetQuery(input);
  if (!query) return [];
  const response = await fetch(viaEdge ? `${EDGE_PREFIX}${streetSearchEdgePath(query)}` : streetSearchUrl(query), { signal });
  if (!response.ok) throw new Error(`Recherche de rues indisponible (${response.status})`);
  return parseStreetSearch(await response.json());
}

/** Étiquettes d'une dalle. */
export async function loadStreetCell(cell: StreetCell, signal: AbortSignal): Promise<StreetLabel[]> {
  const response = await fetch(viaEdge ? `${EDGE_PREFIX}${streetEdgePath(cell)}` : streetCellUrl(cell), { signal });
  // hors de Wallonie, le relais ne connaît pas la dalle : elle est simplement sans rue
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Noms de rues indisponibles (${response.status})`);
  const tsv = viaEdge ? await response.text() : buildStreetCell(await response.json(), cell);
  if (tsv === null) throw new Error('Noms de rues indisponibles (réponse inattendue)');
  return parseStreetCell(tsv, cell);
}
