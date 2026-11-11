#!/usr/bin/env node
/**
 * Lit et vérifie l'empreinte de provenance d'une construction.
 *
 *   npm run provenance:verify                     # ./dist
 *   npm run provenance:verify -- https://exemple.be/   # un site en ligne
 *
 * Avec PROVENANCE_SECRET dans l'environnement, la signature est vérifiée :
 * une empreinte « authentique » ne peut avoir été produite que par le
 * détenteur du secret.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeInvisible, decodeWords, sign, type DecodedProvenance } from '../build/entropy/codec.ts';

const target = process.argv[2] ?? 'dist';
const secret = process.env.PROVENANCE_SECRET;

/** Renvoie le HTML d'entrée et tous les scripts d'une construction locale ou d'un site. */
async function collect(): Promise<{ html: string; scripts: string[] }> {
  if (/^https?:/.test(target)) {
    const html = await (await fetch(target)).text();
    const sources = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map(([, path]) => new URL(path!, target).href);
    const scripts = await Promise.all(sources.map(async (url) => (await fetch(url)).text()));
    // les modules chargés à la demande ne sont pas dans le HTML : on suit les imports relatifs
    const nested = scripts.flatMap((script, k) =>
      [...script.matchAll(/["'](\.\/[\w.-]+\.js)["']/g)].map(([, path]) => new URL(path!, sources[k]).href));
    const more = await Promise.all([...new Set(nested)].map(async (url) => (await fetch(url)).text()));
    return { html, scripts: [...scripts, ...more] };
  }
  const assets = join(target, 'assets');
  const files = (await readdir(assets)).filter((file) => file.endsWith('.js'));
  return {
    html: await readFile(join(target, 'index.html'), 'utf8'),
    scripts: await Promise.all(files.map((file) => readFile(join(assets, file), 'utf8'))),
  };
}

function report(carrier: string, found: DecodedProvenance | null): boolean {
  if (!found) {
    console.log(`✗ ${carrier} : aucune empreinte`);
    return false;
  }
  const verdict = secret === undefined
    ? 'signature non vérifiée (PROVENANCE_SECRET absent)'
    : sign(found, secret) === found.signature ? 'signature AUTHENTIQUE' : 'signature INVALIDE';
  const builtAt = new Date(found.builtAt * 3_600_000).toISOString().slice(0, 13).replace('T', ' ');
  console.log(`✓ ${carrier} : ${found.owner} · commit ${found.commit} · construit le ${builtAt} h UTC · ${verdict}`);
  return secret === undefined || sign(found, secret) === found.signature;
}

const { html, scripts } = await collect();
const results = [
  report('HTML      ', decodeInvisible(html)),
  report('JavaScript', scripts.map(decodeWords).find(Boolean) ?? null),
];
process.exit(results.every(Boolean) ? 0 : 1);
