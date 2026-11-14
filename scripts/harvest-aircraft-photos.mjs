#!/usr/bin/env node
/**
 * Récolte, pour chaque famille d'appareils, la photo qui illustre son article de
 * Wikipédia, avec son auteur et sa licence lus sur Wikimedia Commons. N'écrit
 * que les photos sous licence libre :
 *
 *   public/data/aircraft-photos.json    type OACI → { url, page, author, licence, subject }
 *
 *   npm run aircraft:photos
 *
 * Les images ne sont pas copiées : la fiche les charge depuis Wikimedia Commons.
 */

import { writeFile } from 'node:fs/promises';
import { PHOTO_FAMILIES, isFreeLicence, plainAuthor } from '../src/domain/aircraftPhotos.ts';

// Wikimedia demande aux outils de s'identifier.
const USER_AGENT = 'louy-harvest/1.0 (+https://github.com/alanhortz/louy)';
const WIDTH = 480;

async function ask(host, params) {
  const url = `https://${host}/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params })}`;
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${host} → HTTP ${response.status}`);
  return response.json();
}

const photos = {};
const missing = [];
for (const { article, types } of PHOTO_FAMILIES) {
  try {
    // 1. l'image de tête de l'article
    const lead = await ask('en.wikipedia.org', { action: 'query', titles: article, redirects: '1', prop: 'pageimages', piprop: 'name' });
    const file = lead.query.pages[0]?.pageimage;
    if (!file) { missing.push(`${article} : pas d'image de tête`); continue; }
    // 2. sa fiche sur Commons : vignette, auteur, licence
    const info = await ask('commons.wikimedia.org', {
      action: 'query', titles: `File:${file}`, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: String(WIDTH),
    });
    const image = info.query.pages[0]?.imageinfo?.[0];
    const meta = image?.extmetadata ?? {};
    const licence = meta.LicenseShortName?.value ?? '';
    if (!image?.thumburl || !image.descriptionurl?.startsWith('https://commons.wikimedia.org/')) { missing.push(`${article} : image hors de Commons`); continue; }
    if (!isFreeLicence(licence)) { missing.push(`${article} : licence « ${licence || 'inconnue'} »`); continue; }
    const photo = { url: image.thumburl.split('?')[0], page: image.descriptionurl, author: plainAuthor(meta.Artist?.value ?? ''), licence, subject: article };
    for (const type of types) photos[type] = photo;
    console.log(`  ${article} — ${photo.author} · ${licence}`);
  } catch (error) {
    missing.push(`${article} : ${error.message}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 150));   // sans hâte : ce sont des services bénévoles
}

await writeFile(new URL('../public/data/aircraft-photos.json', import.meta.url), `${JSON.stringify(photos, null, 1)}\n`);
console.log(`${Object.keys(photos).length} types illustrés, ${new Set(Object.values(photos).map((photo) => photo.url)).size} photos`);
if (missing.length) console.warn(`sans photo :\n  ${missing.join('\n  ')}`);
