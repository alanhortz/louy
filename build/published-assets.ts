/**
 * Fichiers lourds publiés (relevés 3D, séquences, images de la vue satellite) : ce que le navigateur en garde,
 * et ce qui n'est pas publié du tout.
 *
 * - Chaque adresse inscrite dans les listes reçoit l'empreinte du contenu du fichier (`?v=…`). L'adresse d'un
 *   fichier ne sert donc qu'à un seul contenu : le navigateur peut le garder un an sans jamais le redemander
 *   (voir `public/_headers`), et un fichier refait est vu aussitôt, puisque son adresse change.
 * - Une entrée mise de côté (`"disabled": true`) n'est pas publiée : ses fichiers, s'ils ne servent à aucune
 *   entrée active, sont retirés de la construction.
 *
 * Tout se passe sur la copie construite (`dist`) : les sources restent telles qu'on les écrit.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/** Listes qui désignent des fichiers lourds. */
export const ASSET_LISTS = ['scans/index.json', 'data/satellite.json', 'data/sports.json', 'data/drone-flights.json'];
/** Une adresse de fichier lourd : dans ces dossiers, sans empreinte encore. */
const HEAVY = /^\/(scans|satellite)\/[^?#]+$/;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Parcourt les chaînes d'une valeur ; `replace` rend la chaîne à écrire à la place. */
function mapStrings(value: Json, replace: (text: string) => string): Json {
  if (typeof value === 'string') return replace(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, replace));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, replace)]));
  return value;
}

const isDisabled = (entry: Json): boolean => typeof entry === 'object' && entry !== null && !Array.isArray(entry) && entry.disabled === true;

/**
 * Réécrit une liste : les entrées mises de côté en sortent, les adresses lourdes reçoivent leur empreinte.
 * `kept` et `dropped` recueillent les adresses des entrées gardées et écartées.
 */
export function publishList(list: Json, fingerprint: (path: string) => string | null, kept: Set<string>, dropped: Set<string>): Json {
  if (!Array.isArray(list)) return list;
  const collect = (into: Set<string>) => (text: string) => { if (HEAVY.test(text)) into.add(text); return text; };
  for (const entry of list) mapStrings(entry, collect(isDisabled(entry) ? dropped : kept));
  return list.filter((entry) => !isDisabled(entry)).map((entry) => mapStrings(entry, (text) => {
    const print = HEAVY.test(text) ? fingerprint(text) : null;
    return print ? `${text}?v=${print}` : text;
  }));
}

export function publishedAssets(): Plugin {
  let out = 'dist';
  return {
    name: 'louy:published-assets',
    apply: 'build',
    configResolved(config) { out = config.build.outDir; },
    closeBundle() {
      const prints = new Map<string, string | null>();
      const fingerprint = (path: string): string | null => {
        if (!prints.has(path)) {
          const file = join(out, path);
          prints.set(path, existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12) : null);
        }
        return prints.get(path)!;
      };
      const kept = new Set<string>(), dropped = new Set<string>();
      for (const name of ASSET_LISTS) {
        const file = join(out, name);
        if (!existsSync(file)) continue;
        writeFileSync(file, JSON.stringify(publishList(JSON.parse(readFileSync(file, 'utf8')) as Json, fingerprint, kept, dropped)));
      }
      for (const path of dropped) if (!kept.has(path)) rmSync(join(out, path), { force: true });
    },
  };
}
