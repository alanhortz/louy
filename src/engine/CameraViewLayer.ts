/**
 * Calque de la vue d'une caméra routière : sa dernière image, posée sur le
 * relief. Chaque pixel devient un point de couleur à l'endroit du sol qu'il
 * montre, et quatre arêtes relient ce sol à l'objectif — le champ de la caméra,
 * comme pour une séquence filmée au drone.
 *
 * Le sol vient du relief déjà chargé : tant que ses tuiles arrivent, la
 * projection est refaite, de plus en plus juste.
 */

import {
  BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, Points, PointsMaterial,
  Scene as ThreeScene, type PerspectiveCamera, type WebGLRenderer,
} from 'three';
import { CAMERA_BANNER, CAMERA_IMAGE, castCameraPixel, type CameraPose } from '../domain/cameraView.ts';
import * as T from '../domain/tiling.ts';

export interface CameraProjection {
  id: string;
  pose: CameraPose;
  /** Adresse de l'image, lisible pixel par pixel. */
  src: string;
}

/** Altitude du sol en un point de la scène ; `null` là où le relief n'est pas encore chargé. */
export type GroundProbe = (worldX: number, worldZ: number) => number | null;

const EDGE_COLOUR = 0x00d4ff;
/** Rayons lancés vers le sol : un sur dix pixels, les autres points sont placés entre eux. */
const COARSE = 10;
/** Un point de couleur par pixel de l'image. */
const FINE = 1;
/** Sol que couvre un pixel, en mètres, au-delà duquel il n'est plus posé : au loin, l'image ne serait que des traits épars. */
const MAX_SPREAD = 1.2;
/** Les points sont dessinés juste au-dessus du relief, pour ne pas s'y noyer. */
const LIFT = 0.25;

// les couleurs d'une image sont codées pour l'écran ; le rendu les attend linéaires
const LINEAR = Float32Array.from({ length: 256 }, (_, value) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

export class CameraViewLayer {
  readonly #renderer: WebGLRenderer;
  readonly #scene = new ThreeScene();
  readonly #onChange: () => void;
  readonly #points: Points<BufferGeometry, PointsMaterial>;
  readonly #edges: LineSegments<BufferGeometry, LineBasicMaterial>;
  #projection: CameraProjection | null = null;
  #pixels: Uint8ClampedArray | null = null;
  #stale = false;
  #request = 0;

  constructor(renderer: WebGLRenderer, onChange: () => void) {
    this.#renderer = renderer;
    this.#onChange = onChange;
    this.#points = new Points(
      new BufferGeometry(),
      new PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, depthTest: false, toneMapped: false }),
    );
    this.#edges = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ color: EDGE_COLOUR, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.#points.frustumCulled = false;
    this.#edges.frustumCulled = false;
    this.#edges.renderOrder = 1;
    this.#scene.add(this.#points, this.#edges);
    this.#points.visible = this.#edges.visible = false;
  }

  /** L'image est arrivée, ou le relief a changé : la projection est à refaire. */
  get stale(): boolean { return this.#stale && this.#pixels !== null; }

  get active(): boolean { return this.#projection !== null; }

  invalidate(): void { this.#stale = true; }

  set(projection: CameraProjection | null): void {
    const previous = this.#projection;
    this.#projection = projection;
    if (!projection) {
      this.#pixels = null;
      this.#points.visible = this.#edges.visible = false;
      this.#onChange();
      return;
    }
    // une autre caméra : l'image de la précédente ne doit pas rester posée ailleurs
    if (previous?.id !== projection.id) {
      this.#pixels = null;
      this.#points.visible = this.#edges.visible = false;
    }
    if (previous?.src === projection.src && this.#pixels) return;
    const request = ++this.#request;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (request !== this.#request) return;
      const canvas = document.createElement('canvas');
      canvas.width = CAMERA_IMAGE.width;
      canvas.height = CAMERA_IMAGE.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      try {
        this.#pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      } catch { return; /* image illisible : rien à poser */ }
      this.#stale = true;
      this.#onChange();
    };
    image.src = projection.src;
  }

  /** Refait la projection sur le relief tel qu'il est chargé. */
  cast(ground: GroundProbe): void {
    const projection = this.#projection, pixels = this.#pixels;
    this.#stale = false;
    if (!projection || !pixels) return;
    // La pose a été retrouvée sur un autre relevé du relief que celui du viewer, qui peut en différer de
    // quelques mètres : ce qui compte est la hauteur de l'objectif au-dessus du sol, reportée sur le sol d'ici.
    const foot = ground(projection.pose.x - T.ORIGIN.x, -(projection.pose.y - T.ORIGIN.y)) ?? projection.pose.altitude - projection.pose.height;
    const pose = { ...projection.pose, altitude: foot + projection.pose.height };
    // là où le relief n'est pas encore chargé, le sol est tenu pour plat depuis le pied de la caméra
    const groundAt = (x: number, y: number) => ground(x - T.ORIGIN.x, -(y - T.ORIGIN.y)) ?? foot;

    const cols = CAMERA_IMAGE.width / COARSE + 1, rows = CAMERA_IMAGE.height / COARSE + 1;
    // par nœud de la grille : x, altitude, z dans la scène ; NaN pour le ciel
    const grid = new Float32Array(cols * rows * 3).fill(NaN);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const hit = castCameraPixel(pose, col * COARSE, row * COARSE, groundAt);
        if (!hit) continue;
        grid.set([hit.x - T.ORIGIN.x, hit.altitude + LIFT, -(hit.y - T.ORIGIN.y)], (row * cols + col) * 3);
      }
    }

    const positions: number[] = [], colours: number[] = [];
    for (let v = 0; v < CAMERA_IMAGE.height; v += FINE) {
      const row = Math.floor(v / COARSE), fv = v / COARSE - row;
      for (let u = 0; u < CAMERA_IMAGE.width; u += FINE) {
        if (v < CAMERA_BANNER.height && u < CAMERA_BANNER.width) continue;
        const col = Math.floor(u / COARSE), fu = u / COARSE - col;
        const a = (row * cols + col) * 3, b = a + 3, c = a + cols * 3, d = c + 3;
        if (Number.isNaN(grid[a]!) || Number.isNaN(grid[b]!) || Number.isNaN(grid[c]!) || Number.isNaN(grid[d]!)) continue;
        if (Math.hypot(grid[c]! - grid[a]!, grid[c + 2]! - grid[a + 2]!) > MAX_SPREAD * COARSE) continue;
        for (let axis = 0; axis < 3; axis++) {
          const top = grid[a + axis]! * (1 - fu) + grid[b + axis]! * fu;
          const bottom = grid[c + axis]! * (1 - fu) + grid[d + axis]! * fu;
          positions.push(top * (1 - fv) + bottom * fv);
        }
        const at = (v * CAMERA_IMAGE.width + u) * 4;
        colours.push(LINEAR[pixels[at]!]!, LINEAR[pixels[at + 1]!]!, LINEAR[pixels[at + 2]!]!);
      }
    }
    this.#points.geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.#points.geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
    this.#points.visible = positions.length > 0;

    // le champ : de l'objectif aux quatre coins du sol que l'image couvre
    const eye = [pose.x - T.ORIGIN.x, pose.altitude, -(pose.y - T.ORIGIN.y)];
    const corner = (col: number, row: number): number[] | null => {
      const at = (row * cols + col) * 3;
      return Number.isNaN(grid[at]!) ? null : [grid[at]!, grid[at + 1]!, grid[at + 2]!];
    };
    // en haut de l'image, le coin est le premier nœud qui touche encore le sol
    const down = (col: number): number[] | null => {
      for (let row = 0; row < rows; row++) { const hit = corner(col, row); if (hit) return hit; }
      return null;
    };
    const corners = [down(0), down(cols - 1), corner(cols - 1, rows - 1), corner(0, rows - 1)];
    const lines: number[] = [];
    corners.forEach((point, at) => {
      if (!point) return;
      lines.push(...eye, ...point);
      const next = corners[(at + 1) % 4];
      if (next) lines.push(...point, ...next);
    });
    this.#edges.geometry.setAttribute('position', new Float32BufferAttribute(lines, 3));
    this.#edges.visible = lines.length > 0;
  }

  /** À appeler après les autres passes : dessine par-dessus, sans rien effacer. */
  render(camera: PerspectiveCamera): void {
    if (!this.#points.visible && !this.#edges.visible) return;
    const autoClear = this.#renderer.autoClear;
    this.#renderer.autoClear = false;
    this.#renderer.setRenderTarget(null);
    this.#renderer.render(this.#scene, camera);
    this.#renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.#request++;
    this.#points.geometry.dispose();
    this.#points.material.dispose();
    this.#edges.geometry.dispose();
    this.#edges.material.dispose();
  }
}
