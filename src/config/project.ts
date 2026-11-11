/**
 * Identité du projet — le seul fichier à modifier quand le nom de domaine ou
 * le dépôt GitHub changent.
 */
export const PROJECT = {
  name: 'L’Oûy',
  /** « l'œil », en wallon. */
  meaning: 'l’œil, en wallon',
  tagline: 'La Wallonie vue par l’œil du LiDAR',
  domain: 'louy.be',
  repository: 'https://github.com/alanhortz/louy',
  author: 'Alan Hortz',
} as const;

/**
 * Origine des tuiles.
 *  - `edge`   : chemins stables servis par le Worker Cloudflare, mis en cache au
 *               plus près du visiteur (production) ;
 *  - `direct` : appel direct des services du SPW (développement local).
 */
export type TileEndpointKind = 'edge' | 'direct';

export const TILE_ENDPOINT: TileEndpointKind =
  (import.meta.env.VITE_TILE_ENDPOINT as TileEndpointKind | undefined)
  ?? (import.meta.env.PROD ? 'edge' : 'direct');

/** Préfixe versionné des routes servies par le Worker. */
export const EDGE_PREFIX = '/edge/v1';
