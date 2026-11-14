/**
 * Trajectoire d'un vol, tracée en l'air : le chemin parcouru en trait plein,
 * l'estimation devant l'appareil en pointillé, et une marque à l'instant que le
 * visiteur désigne sur le curseur du temps.
 *
 * Comme les avions, la trajectoire a sa propre scène, rendue après la passe
 * Eye-Dome du relief ; elle reste lisible même devant un versant.
 */

import {
  BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial, LineDashedMaterial, Points, PointsMaterial,
  Scene as ThreeScene, type PerspectiveCamera, type WebGLRenderer,
} from 'three';
import * as T from '../domain/tiling.ts';

/** Un point à tracer : position Lambert 2008, altitude en mètres (`null` au sol). */
export interface TrajectoryPoint { x: number; y: number; altitude: number | null }

export class TrajectoryLayer {
  readonly #renderer: WebGLRenderer;
  readonly #scene = new ThreeScene();
  readonly #past = new Line(new BufferGeometry(), new LineBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.85, depthTest: false }));
  readonly #future = new Line(new BufferGeometry(), new LineDashedMaterial({ color: 0xffd97a, dashSize: 260, gapSize: 200, transparent: true, opacity: 0.9, depthTest: false }));
  readonly #cursor = new Points(new BufferGeometry(), new PointsMaterial({ color: 0xffffff, size: 12, sizeAttenuation: false, depthTest: false }));
  #count = 0;

  constructor(renderer: WebGLRenderer) {
    this.#renderer = renderer;
    for (const object of [this.#past, this.#future, this.#cursor]) object.frustumCulled = false;
    this.#scene.add(this.#past, this.#future, this.#cursor);
  }

  get count(): number { return this.#count; }

  /** `ground` : altitude donnée aux points au sol, que la trace ne connaît pas. */
  set(past: readonly TrajectoryPoint[], future: readonly TrajectoryPoint[], cursor: TrajectoryPoint | null, ground: number): void {
    this.#count = past.length + future.length;
    // repère du viewer : x = est, y = altitude, z = −nord
    const flat = (points: readonly TrajectoryPoint[]) =>
      points.flatMap((point) => [point.x - T.ORIGIN.x, point.altitude ?? ground, -(point.y - T.ORIGIN.y)]);
    for (const [object, points] of [[this.#past, past], [this.#future, future], [this.#cursor, cursor ? [cursor] : []]] as const) {
      object.geometry.dispose();
      object.geometry = new BufferGeometry();
      object.geometry.setAttribute('position', new Float32BufferAttribute(flat(points), 3));
    }
    // un pointillé se mesure le long de la ligne
    this.#future.computeLineDistances();
  }

  /** À appeler après la passe du relief : dessine par-dessus, sans rien effacer. */
  render(camera: PerspectiveCamera): void {
    if (this.#count === 0) return;
    const autoClear = this.#renderer.autoClear;
    this.#renderer.autoClear = false;
    this.#renderer.setRenderTarget(null);
    this.#renderer.render(this.#scene, camera);
    this.#renderer.autoClear = autoClear;
  }

  dispose(): void {
    for (const object of [this.#past, this.#future, this.#cursor]) {
      object.geometry.dispose();
      object.material.dispose();
    }
  }
}
