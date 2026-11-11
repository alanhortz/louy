/**
 * Materiau des nuages de points.
 *
 * La taille d'un point est derivee du pas d'echantillonnage reel de sa tuile :
 * chaque niveau du quadtree a donc son propre materiau, ce qui permet a des
 * niveaux differents de coexister a l'ecran sans discontinuite de densite
 * apparente pendant le raffinement progressif.
 */

import { ShaderMaterial, Vector2 } from 'three';

const vertex = /* glsl */`
  uniform float uSpacing;      // pas au sol de la tuile, en metres
  uniform float uScale;        // reglage utilisateur
  uniform float uHeightScale;  // exageration verticale
  uniform vec2  uSizeClamp;    // bornes en pixels
  uniform float uViewport;     // hauteur du canvas en pixels

  attribute vec3 color;   // declare ici : le materiau n'active pas USE_COLOR
  varying vec3 vColor;

  void main() {
    vColor = color;
    vec3 p = vec3(position.x, position.y * uHeightScale, position.z);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    // taille projetee du pas d'echantillonnage, en pixels
    float px = uSpacing * uScale * 0.5 * uViewport * projectionMatrix[1][1] / max(0.001, -mv.z);
    gl_PointSize = clamp(px, uSizeClamp.x, uSizeClamp.y);
  }
`;

const fragment = /* glsl */`
  precision highp float;
  uniform float uRound;
  varying vec3 vColor;

  void main() {
    if (uRound > 0.5) {
      vec2 d = gl_PointCoord - vec2(0.5);
      if (dot(d, d) > 0.25) discard;
    }
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

/** Fabrique et met en cache un materiau par niveau de quadtree. */
export class PointMaterialCache {
  constructor() {
    this.byLevel = new Map();
    this.shared = {
      uScale: { value: 1.35 },
      uHeightScale: { value: 1.0 },
      // plafond large : vue de pres, une tuile grossiere en attente de ses filles reste
      // une surface pleine plutot qu'un semis de points sur fond noir
      uSizeClamp: { value: new Vector2(1.0, 22.0) },
      uViewport: { value: 800 },
      uRound: { value: 0 },
    };
  }

  /**
   * Un materiau par pas d'echantillonnage reel. Le suréchantillonnage du dernier
   * niveau produit un pas plus fin que celui du quadtree, d'ou une clef fondee
   * sur le pas et non sur le niveau.
   */
  get(spacing) {
    const key = spacing.toFixed(4);
    let m = this.byLevel.get(key);
    if (!m) {
      m = new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { uSpacing: { value: spacing }, ...this.shared },
      });
      this.byLevel.set(key, m);
    }
    return m;
  }

  set(name, value) {
    const u = this.shared[name];
    if (u) u.value = value;
  }

  dispose() {
    for (const m of this.byLevel.values()) m.dispose();
    this.byLevel.clear();
  }
}
