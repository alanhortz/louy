/**
 * Injecte le garde-fou de compatibilité (`src/boot/gate.js`) en ligne dans
 * index.html, avec la table de compatibilité que lit aussi l'application : une
 * seule source pour les versions minimales, deux lecteurs.
 */

import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

export function supportGate(): Plugin {
  return {
    name: 'louy:support-gate',
    transformIndexHtml(html) {
      const { minimum, title, intro } = JSON.parse(read('../src/config/browser-support.json'));
      const script = read('../src/boot/gate.js')
        .replace(/\/\*\*[\s\S]*?\*\/\n/, '')
        .replace('__SUPPORT__', JSON.stringify({ minimum, title, intro }).replaceAll('<', '\\u003c'));
      return html.replace('<!--support-gate-->', `<script>${script}</script>`);
    },
  };
}
