/**
 * Maquette d'un petit drone pliable de la famille DJI Mini (Mini 4 Pro, Mini 5 Pro) : un fuselage,
 * quatre bras, quatre rotors, la nacelle et sa caméra à l'avant. Une seule géométrie fusionnée,
 * 200 triangles environ, couleurs par sommet : un seul appel de dessin par drone, aucune texture.
 * En mètres, à taille réelle (25 cm de long), le nez vers −z — le sens du regard d'une caméra.
 */

import { BoxGeometry, BufferAttribute, Color, CylinderGeometry, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const BODY = new Color(0x9aa4ad), ARM = new Color(0x6f7880), ROTOR = new Color(0x2a3036), LENS = new Color(0x75e7ff);

function tinted(geometry: BufferGeometry, colour: Color): BufferGeometry {
  const plain = geometry.toNonIndexed();
  geometry.dispose();
  const colours = new Float32Array(plain.getAttribute('position').count * 3);
  for (let at = 0; at < colours.length; at += 3) colours.set([colour.r, colour.g, colour.b], at);
  plain.setAttribute('color', new BufferAttribute(colours, 3));
  plain.deleteAttribute('uv');
  return plain;
}

export function buildDrone(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  parts.push(tinted(new BoxGeometry(0.085, 0.05, 0.19), BODY));
  // la nacelle sous le nez, et l'œil de la caméra
  parts.push(tinted(new BoxGeometry(0.045, 0.04, 0.04).translate(0, -0.02, -0.105), ARM));
  parts.push(tinted(new CylinderGeometry(0.014, 0.014, 0.012, 8).rotateX(Math.PI / 2).translate(0, -0.02, -0.13), LENS));
  for (const [sx, sz] of [[1, -1], [-1, -1], [1, 1], [-1, 1]] as const) {
    const tip = { x: sx * 0.125, z: sz * 0.105 };
    const length = Math.hypot(tip.x - sx * 0.04, tip.z - sz * 0.06);
    const arm = new BoxGeometry(0.018, 0.014, length).rotateY(Math.atan2(tip.x - sx * 0.04, tip.z - sz * 0.06));
    parts.push(tinted(arm.translate((tip.x + sx * 0.04) / 2, 0.01, (tip.z + sz * 0.06) / 2), ARM));
    // le rotor : un disque mince, comme l'hélice qui tourne
    parts.push(tinted(new CylinderGeometry(0.075, 0.075, 0.004, 10).translate(tip.x, 0.03, tip.z), ROTOR));
  }
  const merged = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}
