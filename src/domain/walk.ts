/**
 * Balade au sol : se tenir debout dans un lieu filmé et y marcher.
 *
 * Un lieu reconstruit en « gaussian splats » n'a pas de sol déclaré : ce n'est
 * qu'un nuage de taches colorées. Le sol sur lequel on marche en est déduit —
 * une grille où chaque case retient ce que les splats ont de plus bas alentour.
 * Les voitures, les passants et les branches basses sont ainsi enjambés ; un
 * bâtiment, lui, forme une marche trop haute et arrête le promeneur.
 *
 * Tout est exprimé dans le repère du viewer : x vers l'est, y l'altitude,
 * z vers le sud, en mètres.
 */

import { isWalkable, type Scan } from './scans.ts';

/** Hauteur de la caméra de visite au-dessus du sol : plus haute que des yeux, pour voir par-dessus les passants et les voitures. */
export const EYE_HEIGHT = 2.8;
/** Côté d'une case de la grille du sol. */
const CELL = 1.5;
/** Au-delà, la grille est dégrossie : un lieu immense ne doit pas coûter plus qu'un grand. */
const MAX_CELLS_PER_SIDE = 640;
/** Rayon, en cases, du voisinage dont une case retient le bas. */
const NEIGHBOURHOOD = 3;
/** Part basse du voisinage tenue pour le sol : sous elle, des splats égarés ; au-dessus, ce qui est posé dessus. */
const GROUND_SHARE = 0.2;
/** En deçà de ce nombre de cases renseignées alentour, on est hors du lieu. */
const MIN_NEIGHBOURS = 6;
/** Marche la plus haute que le promeneur monte, et la plus haute qu'il descend, sur la longueur d'une case. */
const MAX_RISE = 1.2;
const MAX_DROP = 2.5;
/** Distance à laquelle un point désigné sur la carte est rattaché à un lieu filmé, depuis son ancrage. */
export const WALK_REACH = 400;

export interface WalkGround {
  cell: number;
  /** Coin de la grille : x le plus à l'ouest, z le plus au nord. */
  x0: number;
  z0: number;
  cols: number;
  rows: number;
  /** Altitude du sol par case, ligne par ligne ; `NaN` hors du lieu. */
  heights: Float32Array;
  /** Altitude de ce que le lieu a de plus haut dans chaque case — toits, murs, feuillages ; `NaN` là où il n'y a rien. */
  tops: Float32Array;
}

/**
 * Déduit le sol d'un lieu de ses splats : `points` en donne les centres, par
 * triplets x, y, z. `null` si le lieu est trop pauvre pour qu'on y marche.
 */
export function buildGround(points: Float32Array, cellSize = CELL): WalkGround | null {
  const count = Math.floor(points.length / 3);
  if (count < 100) return null;
  let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for (let at = 0; at < count * 3; at += 3) {
    const x = points[at]!, z = points[at + 2]!;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  const cell = Math.max(cellSize, (xMax - xMin) / MAX_CELLS_PER_SIDE, (zMax - zMin) / MAX_CELLS_PER_SIDE);
  const cols = Math.floor((xMax - xMin) / cell) + 1;
  const rows = Math.floor((zMax - zMin) / cell) + 1;

  // Par case, les deux splats les plus bas : le second écarte un splat isolé tombé sous le sol.
  const lowest = new Float32Array(cols * rows).fill(Infinity);
  const second = new Float32Array(cols * rows).fill(Infinity);
  for (let at = 0; at < count * 3; at += 3) {
    const index = Math.floor((points[at + 2]! - zMin) / cell) * cols + Math.floor((points[at]! - xMin) / cell);
    const y = points[at + 1]!;
    if (y < lowest[index]!) { second[index] = lowest[index]!; lowest[index] = y; }
    else if (y < second[index]!) second[index] = y;
  }
  // Le haut de chaque case : le second splat le plus haut, pour écarter de même un splat isolé égaré en l'air.
  const highest = new Float32Array(cols * rows).fill(-Infinity);
  const nextHighest = new Float32Array(cols * rows).fill(-Infinity);
  for (let at = 0; at < count * 3; at += 3) {
    const index = Math.floor((points[at + 2]! - zMin) / cell) * cols + Math.floor((points[at]! - xMin) / cell);
    const y = points[at + 1]!;
    if (y > highest[index]!) { nextHighest[index] = highest[index]!; highest[index] = y; }
    else if (y > nextHighest[index]!) nextHighest[index] = y;
  }
  const tops = nextHighest.map((value) => (value > -Infinity ? value : NaN));
  const low = (index: number) => (second[index]! < Infinity ? second[index]! : lowest[index]!);

  const heights = new Float32Array(cols * rows).fill(NaN);
  const around: number[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      around.length = 0;
      for (let dr = -NEIGHBOURHOOD; dr <= NEIGHBOURHOOD; dr++) {
        const r = row + dr;
        if (r < 0 || r >= rows) continue;
        for (let dc = -NEIGHBOURHOOD; dc <= NEIGHBOURHOOD; dc++) {
          const c = col + dc;
          if (c < 0 || c >= cols) continue;
          const value = low(r * cols + c);
          if (value < Infinity) around.push(value);
        }
      }
      if (around.length < MIN_NEIGHBOURS) continue;
      around.sort((a, b) => a - b);
      heights[row * cols + col] = around[Math.floor(around.length * GROUND_SHARE)]!;
    }
  }
  return { cell, x0: xMin, z0: zMin, cols, rows, heights, tops };
}

const cellHeight = (ground: WalkGround, col: number, row: number): number =>
  (col < 0 || row < 0 || col >= ground.cols || row >= ground.rows ? NaN : ground.heights[row * ground.cols + col]!);

/** Altitude du sol sous un point, lissée entre les cases ; `null` hors du lieu. */
export function groundAt(ground: WalkGround, x: number, z: number): number | null {
  // les altitudes valent au centre des cases
  const u = (x - ground.x0) / ground.cell - 0.5;
  const v = (z - ground.z0) / ground.cell - 0.5;
  const col = Math.floor(u), row = Math.floor(v);
  const fu = u - col, fv = v - row;
  let sum = 0, weight = 0;
  for (const [dc, dr, w] of [[0, 0, (1 - fu) * (1 - fv)], [1, 0, fu * (1 - fv)], [0, 1, (1 - fu) * fv], [1, 1, fu * fv]] as const) {
    const height = cellHeight(ground, col + dc, row + dr);
    if (Number.isNaN(height)) continue;
    sum += height * w;
    weight += w;
  }
  // au bord du lieu, les cases manquantes ne tirent pas l'altitude vers le bas
  return weight > 0.25 ? sum / weight : null;
}

/** Le promeneur peut-il passer de `from` à `to` ? Non hors du lieu, ni face à une marche trop haute. */
export function canStep(ground: WalkGround, from: { x: number; z: number }, to: { x: number; z: number }): boolean {
  const here = groundAt(ground, from.x, from.z);
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  if (here === null || length === 0) return here !== null;
  // la pente se juge une case plus loin : entre deux images, le pas est trop court pour la sentir
  const ahead = groundAt(ground, from.x + ((to.x - from.x) / length) * ground.cell, from.z + ((to.z - from.z) / length) * ground.cell);
  if (ahead === null || groundAt(ground, to.x, to.z) === null) return false;
  return ahead - here <= MAX_RISE && here - ahead <= MAX_DROP;
}

/**
 * Premier point du sol que rencontre un regard parti de `origin` dans la
 * direction `direction` (normée) ; `null` s'il n'en rencontre aucun avant `reach`.
 */
export function castGround(
  ground: WalkGround,
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  reach: number,
): { x: number; z: number } | null {
  const step = ground.cell / 3;
  for (let t = 0; t <= reach; t += step) {
    const x = origin.x + direction.x * t;
    const z = origin.z + direction.z * t;
    const height = groundAt(ground, x, z);
    if (height !== null && origin.y + direction.y * t <= height) return { x, z };
  }
  return null;
}

/** Ce qui dépasse le regard de moins que cela ne le cache pas : un muret, un buisson bas. */
const SIGHT_MARGIN = 0.8;
/** Les abords immédiats de l'œil et de la cible ne comptent pas : on est toujours au pied de quelque chose. */
const SIGHT_CLEARANCE = 2.5;

/**
 * Le lieu cache-t-il `to` à qui regarde depuis `from` ? Le regard est suivi case par case ;
 * il est coupé s'il passe, sur l'épaisseur d'une case au moins, sous ce que le lieu a de plus haut.
 */
export function sightBlocked(
  ground: WalkGround,
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
): boolean {
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  if (length <= 2 * SIGHT_CLEARANCE) return false;
  const step = ground.cell / 2;
  let run = 0;
  for (let t = SIGHT_CLEARANCE; t <= length - SIGHT_CLEARANCE; t += step) {
    const k = t / length;
    const col = Math.floor((from.x + (to.x - from.x) * k - ground.x0) / ground.cell);
    const row = Math.floor((from.z + (to.z - from.z) * k - ground.z0) / ground.cell);
    const top = col < 0 || row < 0 || col >= ground.cols || row >= ground.rows ? NaN : ground.tops[row * ground.cols + col]!;
    // hors du lieu, ou case vide : rien ne s'y dresse
    run = top > from.y + (to.y - from.y) * k + SIGHT_MARGIN ? run + 1 : 0;
    if (run >= 2) return true;
  }
  return false;
}

/** Point du lieu le plus proche de (x, z) où l'on peut se tenir ; `null` si le lieu n'a pas de sol. */
export function nearestStand(ground: WalkGround, x: number, z: number): { x: number; z: number } | null {
  if (groundAt(ground, x, z) !== null) return { x, z };
  let best: { x: number; z: number } | null = null;
  let bestDistance = Infinity;
  for (let row = 0; row < ground.rows; row++) {
    for (let col = 0; col < ground.cols; col++) {
      if (Number.isNaN(ground.heights[row * ground.cols + col]!)) continue;
      const cx = ground.x0 + (col + 0.5) * ground.cell;
      const cz = ground.z0 + (row + 0.5) * ground.cell;
      const distance = (cx - x) ** 2 + (cz - z) ** 2;
      if (distance < bestDistance) { bestDistance = distance; best = { x: cx, z: cz }; }
    }
  }
  return best;
}

/** Lieu filmé le plus proche d'un point de la carte (Lambert 2008), et sa distance en mètres. */
export function nearestPlace(places: readonly Scan[], x: number, y: number): { scan: Scan; distance: number } | null {
  let best: { scan: Scan; distance: number } | null = null;
  for (const scan of places) {
    // on ne marche que dans un lieu filmé assez grand : ni tracé, ni image du sol, ni relevé de quelques mètres
    if (!isWalkable(scan)) continue;
    const distance = Math.hypot(scan.x - x, scan.y - y);
    if (!best || distance < best.distance) best = { scan, distance };
  }
  return best;
}
