/**
 * Greffon Vite : appose l'empreinte de provenance à chaque construction.
 *
 * Il fournit le module virtuel `virtual:entropy` (la table d'entiers qu'importe
 * le code de l'application) et glisse la même empreinte, en caractères
 * invisibles, dans le texte de la page.
 *
 * Variables d'environnement :
 *   PROVENANCE_SECRET  clef de signature — à garder secrète (secret GitHub) ;
 *   PROVENANCE_OWNER   titulaire inscrit dans l'empreinte.
 */

import { execSync } from 'node:child_process';
import type { Plugin } from 'vite';
import { encodeInvisible, encodeWords, type Provenance } from './codec.ts';

const VIRTUAL_ID = 'virtual:entropy';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

function currentCommit(): string {
  try {
    return execSync('git rev-parse --short=10 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'worktree';
  }
}

export function entropy(defaultOwner: string): Plugin {
  const provenance: Provenance = {
    owner: process.env.PROVENANCE_OWNER ?? defaultOwner,
    commit: process.env.GITHUB_SHA?.slice(0, 10) ?? currentCommit(),
    builtAt: Math.floor(Date.now() / 3_600_000),
  };
  const secret = process.env.PROVENANCE_SECRET ?? '';

  return {
    name: 'louy:entropy',
    buildStart() {
      if (!secret && process.env.CI) {
        this.warn('PROVENANCE_SECRET absent : l’empreinte de provenance ne sera pas signée.');
      }
    },
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null),
    load: (id) => (id === RESOLVED_ID
      ? `export const ENTROPY = ${JSON.stringify(encodeWords(provenance, secret))};`
      : null),
    transformIndexHtml: (html) => html.replace('<!--entropy-->', encodeInvisible(provenance, secret)),
  };
}
