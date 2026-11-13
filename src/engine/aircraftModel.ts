/**
 * Maquettes d'avions à faible nombre de polygones, construites à partir des
 * seules mesures d'une cellule (`domain/airframes.ts`) : fuselage de révolution,
 * voilure et empennages en plaques, nacelles en cylindres. Quelques centaines
 * de triangles par appareil, une seule géométrie par type.
 *
 * Repère de la maquette : nez vers −Z, dessus vers +Y, aile droite vers +X,
 * origine au milieu du fuselage. Les longueurs sont en mètres.
 */

import {
  BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, LatheGeometry, SphereGeometry, Vector2,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Airframe } from '../domain/airframes.ts';

const DEG = Math.PI / 180;

const HULL = new Color('#eef3f6');
const WING = new Color('#c2ccd4');
const NACELLE = new Color('#55616b');
const BLADE = new Color('#262d34');
/** La dérive porte l'accent du site : elle dit d'un coup d'œil où est l'arrière. */
const FIN = new Color('#22b6dc');

/** Peint une géométrie d'une couleur unie et la ramène à des triangles indépendants (facettes nettes). */
function painted(geometry: BufferGeometry, color: Color): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const count = flat.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let at = 0; at < count; at++) colors.set([color.r, color.g, color.b], at * 3);
  flat.setAttribute('color', new Float32BufferAttribute(colors, 3));
  flat.deleteAttribute('uv');
  flat.deleteAttribute('normal');
  return flat;
}

/**
 * Plaque horizontale : un polygone convexe du plan (x, z), d'épaisseur `thickness`
 * autour de l'altitude `y`.
 */
function plate(outline: readonly (readonly [number, number])[], y: number, thickness: number): BufferGeometry {
  const top = y + thickness / 2, bottom = y - thickness / 2;
  const positions: number[] = [];
  const push = (...points: (readonly [number, number, number])[]) => { for (const point of points) positions.push(...point); };
  for (let at = 1; at < outline.length - 1; at++) {
    const [a, b, c] = [outline[0]!, outline[at]!, outline[at + 1]!];
    push([a[0], top, a[1]], [c[0], top, c[1]], [b[0], top, b[1]]);
    push([a[0], bottom, a[1]], [b[0], bottom, b[1]], [c[0], bottom, c[1]]);
  }
  for (let at = 0; at < outline.length; at++) {
    const a = outline[at]!, b = outline[(at + 1) % outline.length]!;
    push([a[0], top, a[1]], [b[0], top, b[1]], [b[0], bottom, b[1]]);
    push([a[0], top, a[1]], [b[0], bottom, b[1]], [a[0], bottom, a[1]]);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

/** Deux demi-surfaces symétriques (voilure, plan horizontal) : emplanture au centre, saumon à `half`. */
function surface(half: number, rootChord: number, tipChord: number, sweep: number, z: number, y: number, thickness: number): BufferGeometry[] {
  const tipZ = z + Math.tan(sweep * DEG) * half;
  return [1, -1].map((side) => plate(
    [[0, z], [side * half, tipZ], [side * half, tipZ + tipChord], [0, z + rootChord]], y, thickness,
  ));
}

/** Corps de révolution le long de l'axe du fuselage : `profile` donne le rayon de la queue (0) au nez (1). */
function body(length: number, radius: number, profile: readonly (readonly [number, number])[], segments = 10): BufferGeometry {
  const lathe = new LatheGeometry(profile.map(([at, r]) => new Vector2(Math.max(1e-3, r * radius), at * length)), segments);
  lathe.rotateX(-Math.PI / 2);
  lathe.translate(0, 0, length / 2);
  return lathe;
}

/** Nacelle ou tronçon cylindrique couché le long du fuselage, centré en (x, y, z). */
function pod(radius: number, length: number, x: number, y: number, z: number, taper = 0.75): BufferGeometry {
  const cylinder = new CylinderGeometry(radius, radius * taper, length, 8);
  cylinder.rotateX(-Math.PI / 2);
  cylinder.translate(x, y, z);
  return cylinder;
}

/** Hélice ou rotor : deux pales croisées, dans le plan perpendiculaire à `axis`. */
function blades(radius: number, x: number, y: number, z: number, axis: 'z' | 'y', slender = 0.16): BufferGeometry[] {
  const chord = radius * slender;
  return [0, 90].map((angle) => {
    const blade = plate([[-radius, -chord / 2], [radius, -chord / 2], [radius, chord / 2], [-radius, chord / 2]], 0, radius * 0.03);
    blade.rotateY(angle * DEG);
    if (axis === 'z') blade.rotateX(Math.PI / 2);
    blade.translate(x, y, z);
    return blade;
  });
}

const AIRLINER: readonly (readonly [number, number])[] =
  [[0, 0.1], [0.1, 0.48], [0.27, 1], [0.87, 1], [0.94, 0.78], [0.985, 0.36], [1, 0]];
const LIGHT: readonly (readonly [number, number])[] =
  [[0, 0.12], [0.45, 0.55], [0.62, 1], [0.86, 1], [0.97, 0.7], [1, 0.25]];
const FIGHTER: readonly (readonly [number, number])[] =
  [[0, 0.75], [0.2, 1], [0.6, 1], [0.8, 0.7], [1, 0]];

function helicopter(frame: Airframe): BufferGeometry[] {
  const { length: L, span: rotor, fuselage: D } = frame;
  const parts: BufferGeometry[] = [];
  const cabin = new SphereGeometry(1, 8, 6);
  cabin.scale(D * 0.55, D * 0.6, L * 0.24);
  cabin.translate(0, 0, -L * 0.16);
  parts.push(painted(cabin, HULL));
  parts.push(painted(pod(D * 0.14, L * 0.5, 0, D * 0.18, L * 0.2, 0.6), HULL));
  const fin = plate([[0, L * 0.38], [D * 0.9, L * 0.47], [D * 0.9, L * 0.5], [0, L * 0.46]], 0, D * 0.06);
  fin.rotateZ(Math.PI / 2);
  parts.push(painted(fin, FIN));
  parts.push(painted(pod(D * 0.1, D * 0.5, 0, D * 0.75, -L * 0.14, 1), NACELLE));
  for (const blade of blades(rotor / 2, 0, D * 0.95, -L * 0.14, 'y', 0.07)) parts.push(painted(blade, BLADE));
  const tailRotor = blades(D * 0.55, 0, 0, 0, 'y').map((blade) => blade.rotateZ(Math.PI / 2).translate(D * 0.14, D * 0.5, L * 0.46));
  for (const blade of tailRotor) parts.push(painted(blade, BLADE));
  return parts;
}

function aeroplane(frame: Airframe): BufferGeometry[] {
  const { length: L, span: S, fuselage: D, kind, mount, engines } = frame;
  const fighter = kind === 'jet' && mount === 'inside' && frame.sweep > 40;
  const light = kind !== 'jet' && mount !== 'wing' || kind === 'none';
  const parts: BufferGeometry[] = [];
  const nose = -L / 2;

  /* fuselage */
  const hull = body(L, D / 2, fighter ? FIGHTER : light ? LIGHT : AIRLINER);
  if (frame.upperDeck === 'full') hull.scale(1, 1.18, 1);
  parts.push(painted(hull, HULL));
  if (frame.upperDeck === 'hump' || frame.upperDeck === 'bulge') {
    const bulge = frame.upperDeck === 'bulge';
    const deck = new SphereGeometry(1, 8, 6);
    deck.scale(D * (bulge ? 0.62 : 0.4), D * (bulge ? 0.62 : 0.3), L * (bulge ? 0.36 : 0.19));
    deck.translate(0, D * (bulge ? 0.42 : 0.32), bulge ? -L * 0.04 : nose + L * 0.2);
    parts.push(painted(deck, HULL));
  }

  /* voilure */
  const jet = kind === 'jet';
  const rootChord = fighter ? L * 0.42 : S * (jet ? 0.19 : kind === 'none' ? 0.07 : mount === 'wing' ? 0.11 : 0.15);
  const tipChord = rootChord * (fighter ? 0.18 : jet ? 0.27 : 0.62);
  const wingZ = nose + L * (fighter ? 0.4 : mount === 'rear' ? 0.44 : jet ? 0.33 : light ? 0.27 : 0.36);
  const wingY = frame.highWing ? D * 0.42 : -D * 0.28;
  const wingThickness = Math.max(0.12, rootChord * 0.09);
  for (const half of surface(S / 2, rootChord, tipChord, frame.sweep, wingZ, wingY, wingThickness)) parts.push(painted(half, WING));
  /** Bord d'attaque de la voilure à la distance `x` de l'axe. */
  const leadingEdge = (x: number) => wingZ + Math.tan(frame.sweep * DEG) * Math.abs(x);

  /* empennages */
  const finHeight = Math.min(L * 0.2, S * 0.24);
  const finChord = L * (light ? 0.13 : 0.15);
  const finSweep = jet ? 38 : 20;
  const tail = L / 2 - finChord * 1.08;
  const finTip = tail + Math.tan(finSweep * DEG) * finHeight;
  const fin = plate(
    [[D * 0.3, tail], [D * 0.3 + finHeight, finTip], [D * 0.3 + finHeight, finTip + finChord * 0.45], [D * 0.3, tail + finChord]],
    0, Math.max(0.1, finChord * 0.07),
  );
  fin.rotateZ(Math.PI / 2);
  parts.push(painted(fin, FIN));
  if (!fighter) {
    const stabilizerChord = rootChord * (jet ? 0.5 : 0.55);
    const stabilizerY = frame.tTail ? D * 0.3 + finHeight : D * 0.12;
    const stabilizerZ = frame.tTail ? finTip : L / 2 - stabilizerChord * 1.25;
    for (const half of surface(S * 0.19, stabilizerChord, stabilizerChord * 0.45, frame.sweep * 0.9 + 4, stabilizerZ, stabilizerY, wingThickness * 0.6)) {
      parts.push(painted(half, WING));
    }
  }

  /* motorisation */
  if (mount === 'wing') {
    const radius = jet ? D * (S > 40 ? 0.27 : 0.25) : D * 0.2;
    const length = jet ? Math.min(L * 0.12, radius * 3.4) : L * 0.16;
    const pairs = Math.max(1, Math.floor(engines / 2));
    for (let pair = 0; pair < pairs; pair++) {
      const x = (S / 2) * (pairs === 1 ? (jet ? 0.31 : 0.27) : pair === 0 ? 0.3 : 0.56);
      for (const side of [1, -1]) {
        const y = jet ? wingY - radius * 1.15 : wingY - radius * 0.2;
        const z = leadingEdge(x) - length * (jet ? 0.25 : 0.2) + length / 2 - length * 0.5;
        parts.push(painted(pod(radius, length, side * x, y, z), NACELLE));
        if (!jet) for (const blade of blades(D * 0.68, side * x, y, z - length / 2 - 0.15, 'z')) parts.push(painted(blade, BLADE));
      }
    }
  } else if (mount === 'rear') {
    const radius = D * 0.26;
    const length = Math.min(L * 0.15, radius * 4.4);
    for (const side of [1, -1]) parts.push(painted(pod(radius, length, side * (D / 2 + radius * 0.9), D * 0.16, L / 2 - L * 0.27), NACELLE));
  } else if (mount === 'nose' && kind === 'prop') {
    for (const blade of blades(D * 0.85, 0, 0, nose - 0.1, 'z')) parts.push(painted(blade, BLADE));
  }
  if (frame.tailEngine) {
    const radius = D * 0.24;
    parts.push(painted(pod(radius, L * 0.13, 0, D / 2 + radius * 0.9, L / 2 - L * 0.12), NACELLE));
  }
  return parts;
}

/** Géométrie complète d'une cellule : positions et couleurs par sommet, normales de facettes. */
export function buildAirframe(frame: Airframe): BufferGeometry {
  const parts = frame.kind === 'rotor' ? helicopter(frame) : aeroplane(frame);
  const merged = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}
