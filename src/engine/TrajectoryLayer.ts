/**
 * Trajectoire d'un vol : le chemin parcouru en trait plein, l'estimation devant
 * l'appareil en pointillé, l'aplomb de l'appareil — un fil jusqu'au sol et un
 * cercle posé dessus — et une marque à l'instant que le visiteur désigne sur le
 * curseur du temps.
 *
 * Le tracé n'est pas dessiné dans la scène mais par-dessus, en SVG, à partir
 * des points projetés à l'écran : il a ainsi l'épaisseur constante, les bouts
 * ronds et le halo des autres éléments de l'interface, et sa mise en forme
 * tient dans la feuille de style, avec celle des marqueurs.
 */

import { Matrix4, Vector4, type PerspectiveCamera } from 'three';
import * as T from '../domain/tiling.ts';
import type { AircraftAnchor } from './AircraftLayer.ts';

/** Un point à tracer : position Lambert 2008, altitude en mètres (`null` au sol). */
export interface TrajectoryPoint { x: number; y: number; altitude: number | null }

type World = readonly [x: number, y: number, z: number];

const SVG = 'http://www.w3.org/2000/svg';
/** En deçà de cette profondeur, un point est derrière l'œil : le trait est coupé là. */
const NEAR = 1;
/** Cercle au sol : rayon réel, rayon minimal à l'écran, finesse du tracé. */
const FOOTPRINT_RADIUS = 120;
const FOOTPRINT_SCREEN_RADIUS = 9;
const FOOTPRINT_SEGMENTS = 40;

export class TrajectoryLayer {
  readonly #root: SVGSVGElement;
  readonly #paths: Record<'past' | 'future' | 'plumb' | 'footprint', SVGPathElement>;
  readonly #foot: SVGCircleElement;
  readonly #cursor: SVGCircleElement;
  readonly #matrix = new Matrix4();
  readonly #a = new Vector4();
  readonly #b = new Vector4();
  #past: World[] = [];
  #future: World[] = [];
  #mark: World | null = null;

  constructor(host: HTMLElement) {
    this.#root = document.createElementNS(SVG, 'svg');
    this.#root.setAttribute('class', 'trajectory');
    this.#root.setAttribute('aria-hidden', 'true');
    const path = (name: string) => {
      const element = document.createElementNS(SVG, 'path');
      element.setAttribute('class', `trajectory-${name}`);
      return this.#root.appendChild(element);
    };
    const circle = (name: string, radius: number) => {
      const element = document.createElementNS(SVG, 'circle');
      element.setAttribute('class', `trajectory-${name}`);
      element.setAttribute('r', String(radius));
      return this.#root.appendChild(element);
    };
    this.#paths = { footprint: path('footprint'), plumb: path('plumb'), past: path('past'), future: path('future') };
    this.#foot = circle('foot', 1.5);
    this.#cursor = circle('cursor', 4.5);
    // sous les marqueurs : une étiquette reste lisible devant le tracé
    host.prepend(this.#root);
  }

  get count(): number { return this.#past.length + this.#future.length; }

  /** `ground` : altitude donnée aux points au sol, que la trace ne connaît pas. */
  set(past: readonly TrajectoryPoint[], future: readonly TrajectoryPoint[], cursor: TrajectoryPoint | null, ground: number): void {
    // repère du viewer : x = est, y = altitude, z = −nord
    const world = (point: TrajectoryPoint): World => [point.x - T.ORIGIN.x, point.altitude ?? ground, -(point.y - T.ORIGIN.y)];
    this.#past = past.map(world);
    this.#future = future.map(world);
    this.#mark = cursor ? world(cursor) : null;
  }

  /**
   * Projette et dessine. `anchor` : l'appareil tel que la scène vient de le
   * dessiner ; le tracé s'y raccorde, pour ne pas rester en arrière de la
   * maquette entre deux relevés.
   */
  render(camera: PerspectiveCamera, width: number, height: number, anchor: AircraftAnchor | null): void {
    this.#matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const here: World[] = anchor ? [[anchor.x, anchor.y, anchor.z]] : [];
    const draw = (points: readonly World[]) => this.#line(points, width, height);

    this.#paths.past.setAttribute('d', draw([...this.#past, ...here]));
    // l'estimation part de l'appareil, pas de son dernier relevé
    this.#paths.future.setAttribute('d', draw(anchor ? [...here, ...this.#future.slice(1)] : this.#future));

    const above = anchor !== null && anchor.y > anchor.ground;
    this.#paths.plumb.setAttribute('d', above ? draw([[anchor.x, anchor.y, anchor.z], [anchor.x, anchor.ground, anchor.z]]) : '');
    let ring = '';
    let foot: readonly [number, number] | null = null;
    if (above) {
      const base: World = [anchor.x, anchor.ground, anchor.z];
      const reach = Math.hypot(camera.position.x - base[0], camera.position.y - base[1], camera.position.z - base[2]);
      const pixelsAtUnit = height / (2 * Math.tan((camera.fov * Math.PI) / 360));
      const radius = Math.max(FOOTPRINT_RADIUS, (FOOTPRINT_SCREEN_RADIUS * reach) / pixelsAtUnit);
      ring = draw(Array.from({ length: FOOTPRINT_SEGMENTS + 1 }, (_, k): World => {
        const angle = (k / FOOTPRINT_SEGMENTS) * Math.PI * 2;
        return [base[0] + Math.cos(angle) * radius, base[1], base[2] + Math.sin(angle) * radius];
      }));
      foot = this.#point(base, width, height);
    }
    this.#paths.footprint.setAttribute('d', ring);
    this.#place(this.#foot, foot);
    this.#place(this.#cursor, this.#mark ? this.#point(this.#mark, width, height) : null);
  }

  #place(circle: SVGCircleElement, at: readonly [number, number] | null): void {
    circle.style.display = at ? '' : 'none';
    if (at) { circle.setAttribute('cx', at[0].toFixed(1)); circle.setAttribute('cy', at[1].toFixed(1)); }
  }

  /** Position à l'écran d'un point ; `null` s'il est derrière l'œil. */
  #point(point: World, width: number, height: number): readonly [number, number] | null {
    const clip = this.#a.set(point[0], point[1], point[2], 1).applyMatrix4(this.#matrix);
    return clip.w < NEAR ? null : [(clip.x / clip.w * 0.5 + 0.5) * width, (0.5 - clip.y / clip.w * 0.5) * height];
  }

  /** Chemin SVG d'une suite de points ; un segment qui passe derrière l'œil est coupé à la limite. */
  #line(points: readonly World[], width: number, height: number): string {
    const out: string[] = [];
    const screen = (clip: Vector4) =>
      `${((clip.x / clip.w * 0.5 + 0.5) * width).toFixed(1)} ${((0.5 - clip.y / clip.w * 0.5) * height).toFixed(1)}`;
    let previous: Vector4 | null = null;
    let drawing = false;
    for (const point of points) {
      const current = (previous === this.#a ? this.#b : this.#a).set(point[0], point[1], point[2], 1).applyMatrix4(this.#matrix);
      const visible = current.w >= NEAR;
      if (previous) {
        const wasVisible = previous.w >= NEAR;
        if (wasVisible !== visible) {
          // le point où le segment traverse la limite
          const cut = new Vector4().lerpVectors(previous, current, (NEAR - previous.w) / (current.w - previous.w));
          out.push(`${wasVisible ? 'L' : 'M'}${screen(cut)}`);
          drawing = !wasVisible;
        }
      }
      if (visible) {
        out.push(`${drawing ? 'L' : 'M'}${screen(current)}`);
        drawing = true;
      } else drawing = false;
      previous = current;
    }
    return out.join('');
  }

  dispose(): void { this.#root.remove(); }
}
