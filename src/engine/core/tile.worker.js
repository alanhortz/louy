/**
 * Worker de decodage d'une tuile.
 *
 * Enchaine, hors du thread principal :
 *   1. telechargement de l'image du modele altimetrique (PNG sans perte) et,
 *      si necessaire, de l'image de couleur (JPEG) ;
 *   2. inversion de la rampe hypsometrique -> altitudes en metres ;
 *   3. reconstruction d'une surface continue sous contrainte de quantification ;
 *   4. construction des tableaux de positions et de couleurs, renvoyes en
 *      transfert de propriete (zero copie).
 */

import { TILE_GRID, TILE_PAD } from '../../domain/tiling.ts';

/** LUT decodees, par modele de surface ('mnt' | 'mns'). */
const luts = new Map();
/** Requetes en vol, pour pouvoir les annuler quand la camera bouge. */
const inflight = new Map();

/* ------------------------------------------------------------------ LUT --- */

function buildLut(raw) {
  const map = new Map();
  for (let i = 0; i < raw.colors.length; i++) map.set(raw.colors[i], raw.elevations[i]);
  // Le serveur etire l'altitude sur 256 niveaux : c'est la largeur d'une bande.
  const step = (raw.stretch.max - raw.stretch.min) / 256;
  return { map, colors: raw.colors, elevations: raw.elevations, step };
}

/**
 * Altitude d'une couleur. Le rendu du serveur ne produit que des couleurs de la
 * rampe, donc la table repond directement ; le repli au plus proche ne sert que
 * pour les rares pixels de bordure recomposes par le serveur, et son resultat
 * est memorise.
 */
function lookup(lut, packed) {
  const hit = lut.map.get(packed);
  if (hit !== undefined) return hit;

  const r = (packed >> 16) & 255, g = (packed >> 8) & 255, b = packed & 255;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < lut.colors.length; i++) {
    const c = lut.colors[i];
    const dr = ((c >> 16) & 255) - r, dg = ((c >> 8) & 255) - g, db = (c & 255) - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  // Au-dela d'un ecart franc la couleur n'appartient pas a la rampe (habillage,
  // bord de dalle) : on la marque comme absence de donnee.
  const z = bestD > 900 ? NaN : lut.elevations[best];
  lut.map.set(packed, z);
  return z;
}

/* ------------------------------------------------------- decodage image --- */

async function fetchPixels(url, px, signal) {
  const res = await fetch(url, { signal, credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(px, px);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, px, px);
  bmp.close();
  return ctx.getImageData(0, 0, px, px).data;
}

/* ------------------------------------------ reconstruction de la surface --- */

/**
 * Le service ne renvoie qu'une altitude quantifiee : chaque pixel n'indique pas
 * une valeur mais une bande de `step` metres de large. Rendue telle quelle, la
 * surface est en marches d'escalier.
 *
 * On cherche donc la surface la plus lisse compatible avec les donnees : on
 * lisse iterativement, en reprojetant apres chaque passe chaque point dans la
 * bande que le service a effectivement mesuree. Le resultat ne quitte jamais
 * l'intervalle d'incertitude de la source — on ne fabrique pas d'altitude, on
 * choisit la plus reguliere parmi celles qui restent possibles.
 */
function reconstruct(h, w, halfBand, iterations) {
  if (iterations <= 0) return h;
  const centers = h.slice();
  const next = new Float32Array(h.length);

  // Sur un plateau a faible pente, un palier de 3,5 m peut couvrir des
  // centaines de metres : un noyau 3x3 classique mettrait des centaines de
  // passes a le traverser. On dilate donc le noyau de facon dyadique — 64, 32,
  // 16 … 1 pixel d'ecart — si bien que l'information parcourt toute la tuile en
  // quelques passes, pour le meme cout par passe. Les passes finales, a
  // l'ecart 1, retablissent la regularite locale.
  const schedule = [];
  let r = 1;
  while (r * 2 < (w >> 1)) r *= 2;
  for (; r >= 1; r >>= 1) schedule.push(r);
  for (let k = 1; k < iterations; k++) schedule.push(1);

  for (const rad of schedule) {
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (Number.isNaN(h[idx])) { next[idx] = NaN; continue; }

        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy * rad;
          if (yy < 0 || yy >= w) continue;
          const row = yy * w;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx * rad;
            if (xx < 0 || xx >= w) continue;
            const v = h[row + xx];
            if (!Number.isNaN(v)) { sum += v; n++; }
          }
        }
        const avg = n > 0 ? sum / n : h[idx];
        // la valeur reste dans la bande effectivement mesuree par le service
        const lo = centers[idx] - halfBand, hi = centers[idx] + halfBand;
        next[idx] = avg < lo ? lo : (avg > hi ? hi : avg);
      }
    }
    h.set(next);
  }
  return h;
}

/* ------------------------------------------------------------- couleurs --- */

/** Amplitude altimetrique de la Wallonie (m) : 0 a ~694 m au Signal de Botrange. */
const ELEVATION_RANGE = [0, 700];

/** Rampe hypsometrique locale, utilisee par le mode « Altitude ». */
function elevationColor(z, lo, hi, out, o) {
  let t = (z - lo) / Math.max(1e-6, hi - lo);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  // vert-bleute -> vert -> ocre -> brun -> blanc
  const stops = [
    [0.00, 46, 92, 78], [0.25, 108, 148, 78], [0.50, 196, 178, 106],
    [0.75, 158, 116, 82], [1.00, 242, 240, 235],
  ];
  let k = 0;
  while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
  const a = stops[k], b = stops[k + 1];
  const u = (t - a[0]) / (b[0] - a[0]);
  out[o]     = a[1] + (b[1] - a[1]) * u;
  out[o + 1] = a[2] + (b[2] - a[2]) * u;
  out[o + 2] = a[3] + (b[3] - a[3]) * u;
}

/* ---------------------------------------------------------------- tuile --- */

/**
 * Altitude interpolee bilineairement dans la grille du MNT.
 * Renvoie NaN des qu'un des quatre voisins manque, pour ne jamais inventer de
 * relief au bord d'une zone sans donnee.
 */
function sampleHeight(h, w, fx, fy) {
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= w) return NaN;
  const tx = fx - x0, ty = fy - y0;
  const i = y0 * w + x0;
  const a = h[i], b = h[i + 1], c = h[i + w], d = h[i + w + 1];
  if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) return NaN;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

async function loadTile(msg) {
  const {
    id, px, cpx, sup, spacing, elevUrl, colorUrl, colorMode, stride, smooth, lutKey,
  } = msg;

  const ctrl = new AbortController();
  inflight.set(id, ctrl);
  try {
    const lut = luts.get(lutKey);
    const [elevPx, colorPx] = await Promise.all([
      fetchPixels(elevUrl, px, ctrl.signal),
      colorUrl ? fetchPixels(colorUrl, cpx, ctrl.signal) : Promise.resolve(null),
    ]);

    // 1. rampe -> altitudes (sur la tuile elargie de TILE_PAD)
    const h = new Float32Array(px * px);
    let any = false;
    for (let i = 0, p = 0; i < h.length; i++, p += 4) {
      if (elevPx[p + 3] < 250) { h[i] = NaN; continue; }
      const z = lookup(lut, (elevPx[p] << 16) | (elevPx[p + 1] << 8) | elevPx[p + 2]);
      h[i] = z;
      if (!Number.isNaN(z)) any = true;
    }
    if (!any) {
      return { id, empty: true };
    }

    // 2. surface continue compatible avec la quantification
    reconstruct(h, px, lut.step / 2, smooth);

    // 3. echantillonnage de l'interieur -> geometrie
    //
    // La grille de sortie n'est pas celle du MNT : `sup` la densifie pour suivre
    // la resolution native de l'orthophoto (25 cm contre 50 cm), `stride` la
    // relache. Le pas de sortie vaut donc spacing * stride / sup.
    const n = Math.max(1, Math.round(TILE_GRID * sup / stride));
    const step = stride / sup;                 // en pixels de MNT
    const outSpacing = spacing * step;         // en metres
    const positions = new Float32Array(n * n * 3);
    const colors = new Uint8Array(n * n * 3);

    // Echelle fixe et commune a toutes les tuiles : une normalisation par tuile
    // ferait apparaitre les jointures du quadtree dans la colorimetrie.
    const loZ = ELEVATION_RANGE[0], hiZ = ELEVATION_RANGE[1];
    let minY = Infinity, maxY = -Infinity;
    let count = 0;
    for (let gy = 0; gy < n; gy++) {
      // coordonnee flottante dans la grille du MNT (centre de la cellule)
      const fy = TILE_PAD + (gy + 0.5) * step - 0.5;
      // index entier dans l'image couleur, qui est `sup` fois plus fine
      const cy = Math.min(cpx - 1, Math.floor((TILE_PAD + (gy + 0.5) * step) * sup));

      for (let gx = 0; gx < n; gx++) {
        const fx = TILE_PAD + (gx + 0.5) * step - 0.5;
        const z = sup === 1 && stride === 1
          ? h[(TILE_PAD + gy) * px + TILE_PAD + gx]     // cas natif : pas d'interpolation
          : sampleHeight(h, px, fx, fy);
        if (Number.isNaN(z)) continue;

        const o = count * 3;
        // Repere local a la tuile, origine au coin nord-ouest : X vers l'est,
        // Z vers le sud, Y = altitude. Le monde utilise z = -(y_Lambert - origine),
        // donc descendre dans l'image (vers le sud) fait bien croitre Z.
        positions[o]     = (gx + 0.5) * outSpacing;
        positions[o + 1] = z;
        positions[o + 2] = (gy + 0.5) * outSpacing;
        if (z < minY) minY = z;
        if (z > maxY) maxY = z;

        if (colorMode === 'elevation') {
          elevationColor(z, loZ, hiZ, colors, o);
        } else if (colorMode === 'slope') {
          const src = Math.round(fy) * px + Math.round(fx);
          const l = h[src - 1], r = h[src + 1], u = h[src - px], d = h[src + px];
          const dzdx = (Number.isNaN(r) || Number.isNaN(l)) ? 0 : (r - l) / (2 * spacing);
          const dzdy = (Number.isNaN(d) || Number.isNaN(u)) ? 0 : (d - u) / (2 * spacing);
          const slope = Math.atan(Math.hypot(dzdx, dzdy)) / (Math.PI / 2);
          const t = Math.min(1, slope * 2.6);
          colors[o]     = 250 * t + 236 * (1 - t);
          colors[o + 1] = 246 * (1 - t) + 92 * t;
          colors[o + 2] = 232 * (1 - t) + 60 * t;
        } else if (colorPx) {
          const cx = Math.min(cpx - 1, Math.floor((TILE_PAD + (gx + 0.5) * step) * sup));
          const p = (cy * cpx + cx) * 4;
          colors[o] = colorPx[p]; colors[o + 1] = colorPx[p + 1]; colors[o + 2] = colorPx[p + 2];
        } else {
          colors[o] = colors[o + 1] = colors[o + 2] = 190;
        }
        count++;
      }
    }

    if (count === 0) return { id, empty: true };

    const pos = positions.subarray(0, count * 3).slice();
    const col = colors.subarray(0, count * 3).slice();
    return { id, count, minY, maxY, outSpacing, positions: pos, colors: col };
  } finally {
    inflight.delete(id);
  }
}

/* -------------------------------------------------------------- routage --- */

self.onmessage = async (ev) => {
  const msg = ev.data;

  if (msg.type === 'init') {
    for (const [k, v] of Object.entries(msg.luts)) luts.set(k, buildLut(v));
    self.postMessage({ type: 'ready' });
    return;
  }

  if (msg.type === 'abort') {
    inflight.get(msg.id)?.abort();
    return;
  }

  if (msg.type === 'load') {
    try {
      const out = await loadTile(msg);
      if (out.empty) { self.postMessage({ type: 'empty', id: out.id }); return; }
      self.postMessage({ type: 'done', ...out },
        [out.positions.buffer, out.colors.buffer]);
    } catch (err) {
      self.postMessage({
        type: 'error', id: msg.id,
        aborted: err.name === 'AbortError',
        message: String(err.message || err),
      });
    }
  }
};
