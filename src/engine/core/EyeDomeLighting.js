/**
 * Eclairage Eye-Dome (EDL).
 *
 * Un nuage de points n'a ni normales ni surface : sans traitement, un relief se
 * lit tres mal. L'EDL compare la profondeur de chaque pixel a celle de ses
 * voisins et assombrit les ruptures ; les silhouettes, les talus et les
 * batiments ressortent alors nettement, sans qu'aucune normale soit calculee.
 *
 * La comparaison se fait sur le logarithme de la profondeur, ce qui rend l'effet
 * independant de l'echelle : il se comporte pareil a 200 km et a 20 m.
 */

import {
  DepthTexture, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry, Scene,
  ShaderMaterial, UnsignedIntType, Vector2, WebGLRenderTarget,
} from 'three';

const fragment = /* glsl */`
  precision highp float;

  uniform sampler2D uColor;
  uniform sampler2D uDepth;
  uniform vec2  uTexel;
  uniform float uNear;
  uniform float uFar;
  uniform float uStrength;
  uniform float uRadius;

  varying vec2 vUv;

  float eyeDepth(vec2 uv) {
    float d = texture2D(uDepth, uv).r;
    if (d >= 1.0) return -1.0;                       // arriere-plan
    float z = d * 2.0 - 1.0;
    return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  }

  void main() {
    vec4 color = texture2D(uColor, vUv);
    float c = eyeDepth(vUv);
    if (c < 0.0) { gl_FragColor = color; return; }

    float lc = log2(c);
    float sum = 0.0;
    // huit voisins : assez pour une silhouette franche, assez peu pour rester
    // negligeable dans le budget par image
    vec2 offs[8];
    offs[0] = vec2( 1.0,  0.0); offs[1] = vec2(-1.0,  0.0);
    offs[2] = vec2( 0.0,  1.0); offs[3] = vec2( 0.0, -1.0);
    offs[4] = vec2( 0.7,  0.7); offs[5] = vec2(-0.7,  0.7);
    offs[6] = vec2( 0.7, -0.7); offs[7] = vec2(-0.7, -0.7);

    for (int i = 0; i < 8; i++) {
      float n = eyeDepth(vUv + offs[i] * uTexel * uRadius);
      sum += n < 0.0 ? 0.0 : max(0.0, lc - log2(n));
    }

    float shade = exp(-sum * 120.0 * uStrength);
    gl_FragColor = vec4(color.rgb * shade, color.a);
  }
`;

const vertex = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class EyeDomeLighting {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;
    this.strength = 1.0;
    this.radius = 1.4;

    this.target = new WebGLRenderTarget(1, 1, {
      depthBuffer: true,
      depthTexture: new DepthTexture(1, 1, UnsignedIntType),
    });
    this.target.texture.minFilter = NearestFilter;
    this.target.texture.magFilter = NearestFilter;

    this.material = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uColor: { value: this.target.texture },
        uDepth: { value: this.target.depthTexture },
        uTexel: { value: new Vector2(1, 1) },
        uNear: { value: 1 },
        uFar: { value: 1000 },
        uStrength: { value: 1.0 },
        uRadius: { value: 1.4 },
      },
    });

    this.quadScene = new Scene();
    this.quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene.add(new Mesh(new PlaneGeometry(2, 2), this.material));
  }

  setSize(w, h, pixelRatio) {
    const W = Math.max(1, Math.floor(w * pixelRatio));
    const H = Math.max(1, Math.floor(h * pixelRatio));
    this.target.setSize(W, H);
    this.material.uniforms.uTexel.value.set(1 / W, 1 / H);
  }

  render(scene, camera) {
    const r = this.renderer;
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    r.setRenderTarget(this.target);
    r.clear();
    r.render(scene, camera);

    const u = this.material.uniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uStrength.value = this.strength;
    u.uRadius.value = this.radius;

    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCamera);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
  }
}
