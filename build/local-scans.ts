/**
 * Sert, en développement seulement, les scans 3D d'essai rangés hors du dépôt
 * (`../louy-scans/publies` par défaut, ou `LOUY_SCANS_DIR`) sous `/local/scans/`.
 * Rien de ce dossier n'entre donc dans le dépôt ni dans le site construit.
 */

import { createReadStream, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const PREFIX = '/local/scans/';
const TYPES: Record<string, string> = { json: 'application/json', ply: 'application/octet-stream' };

export function localScans(): Plugin {
  const root = resolve(process.env.LOUY_SCANS_DIR
    ?? fileURLToPath(new URL('../../louy-scans/publies', import.meta.url)));
  return {
    name: 'louy:local-scans',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = decodeURIComponent((request.url ?? '').split('?')[0]!);
        if (!path.startsWith(PREFIX)) return next();
        const file = resolve(root, path.slice(PREFIX.length));
        const type = TYPES[file.split('.').pop() ?? ''];
        const size = type && file.startsWith(root + sep) ? statSync(file, { throwIfNoEntry: false })?.size : undefined;
        if (size === undefined) {
          response.statusCode = 404;
          return response.end();
        }
        response.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Cache-Control': 'no-cache' });
        createReadStream(file).pipe(response);
      });
    },
  };
}
