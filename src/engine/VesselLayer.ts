/**
 * Calque des bateaux en volume : chaque bateau est une coque à ses dimensions
 * réelles, posée sur l'eau et tournée sur sa route.
 *
 * Vue de loin, une péniche de quatre-vingts mètres ne ferait pas un pixel :
 * elle est alors agrandie en plan pour rester lisible, sans prendre de hauteur,
 * et retrouve sa taille réelle dès que l'on s'approche.
 */

import {
  BufferGeometry, DirectionalLight, Float32BufferAttribute, HemisphereLight, Mesh, MeshLambertMaterial,
  Scene as ThreeScene, type PerspectiveCamera, type WebGLRenderer,
} from 'three';
import * as T from '../domain/tiling.ts';

export interface VesselModel {
  id: string;
  /** Position (Lambert 2008). */
  x: number;
  y: number;
  /** Route, en degrés depuis le nord. */
  course: number;
  /** Longueur et largeur, en mètres. */
  length: number;
  beam: number;
}

const DEG = Math.PI / 180;
/** Longueur minimale d'une coque à l'écran, en pixels. */
const MIN_SCREEN_LENGTH = 20;
/**
 * Agrandie pour rester visible de loin, une coque ne doit pas devenir un immeuble :
 * sa hauteur ne suit l'agrandissement que jusqu'à ce facteur, puis elle s'aplatit
 * en une silhouette posée sur l'eau.
 */
const MAX_HEIGHT_SCALE = 2;
/** Hauteur de la coque au-dessus de l'eau, et de la timonerie, en mètres. */
const FREEBOARD = 2.4;

type Colour = readonly [number, number, number];
const HULL: Colour = [0.16, 0.22, 0.27];
const DECK: Colour = [0.45, 0.53, 0.58];
const HOUSE: Colour = [0.86, 0.9, 0.92];

/**
 * Coque unitaire : un mètre de long (proue vers −Z), un mètre de large, un
 * mètre de franc-bord. Une proue en pointe, une poupe droite, une timonerie à
 * l'arrière — la silhouette d'une péniche.
 */
function buildHull(): BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  const tri = (a: number[], b: number[], c: number[], colour: Colour) => {
    positions.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) colours.push(...colour);
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], colour: Colour) => { tri(a, b, c, colour); tri(a, c, d, colour); };

  // contour vu du dessus, dans le sens des aiguilles d'une montre depuis la proue
  const outline = [[0, -0.5], [0.5, -0.32], [0.5, 0.5], [-0.5, 0.5], [-0.5, -0.32]];
  outline.forEach(([x, z], k) => {
    const [nx, nz] = outline[(k + 1) % outline.length]!;
    quad([x!, 1, z!], [nx!, 1, nz!], [nx!, 0, nz!], [x!, 0, z!], HULL);
  });
  // le pont : un éventail autour de son centre
  outline.forEach(([x, z], k) => {
    const [nx, nz] = outline[(k + 1) % outline.length]!;
    tri([0, 1, 0], [nx!, 1, nz!], [x!, 1, z!], DECK);
  });
  // la timonerie, à l'arrière
  const [x0, x1, z0, z1, y0, y1] = [-0.34, 0.34, 0.26, 0.44, 1, 2.1];
  quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], HOUSE);
  quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], HOUSE);
  quad([x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], HOUSE);
  quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], HOUSE);
  quad([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], HOUSE);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export class VesselLayer {
  readonly #renderer: WebGLRenderer;
  readonly #scene = new ThreeScene();
  readonly #hull = buildHull();
  readonly #entries = new Map<string, { mesh: Mesh<BufferGeometry, MeshLambertMaterial>; model: VesselModel }>();
  readonly #idle = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  /** Bateau sélectionné : la même coque, réchauffée d'or comme les autres marqueurs. */
  readonly #active = new MeshLambertMaterial({ vertexColors: true, flatShading: true, color: 0xffe2a0, emissive: 0x6a4a00 });
  #activeId: string | null = null;

  constructor(renderer: WebGLRenderer) {
    this.#renderer = renderer;
    const sun = new DirectionalLight(0xffffff, 1.7);
    sun.position.set(0.35, 1, 0.25);
    this.#scene.add(new HemisphereLight(0xffffff, 0x4a5560, 1.25), sun);
  }

  get count(): number { return this.#entries.size; }

  setModels(models: readonly VesselModel[]): void {
    const wanted = new Set(models.map((model) => model.id));
    for (const [id, entry] of this.#entries) {
      if (wanted.has(id)) continue;
      this.#scene.remove(entry.mesh);
      this.#entries.delete(id);
    }
    for (const model of models) {
      const known = this.#entries.get(model.id);
      if (known) { known.model = model; continue; }
      const mesh = new Mesh(this.#hull, model.id === this.#activeId ? this.#active : this.#idle);
      mesh.frustumCulled = false;
      this.#scene.add(mesh);
      this.#entries.set(model.id, { mesh, model });
    }
  }

  setActive(id: string | null): void {
    this.#activeId = id;
    for (const [key, entry] of this.#entries) entry.mesh.material = key === id ? this.#active : this.#idle;
  }

  /** Pose chaque coque sur l'eau et la dessine par-dessus le relief. `groundAt` donne le niveau de l'eau. */
  render(camera: PerspectiveCamera, viewportHeight: number, groundAt: (worldX: number, worldZ: number) => number): void {
    if (this.#entries.size === 0) return;
    // taille, en pixels, d'un mètre vu à un mètre : sert à garder les coques lisibles de loin
    const pixelsAtUnit = viewportHeight / (2 * Math.tan((camera.fov * DEG) / 2));
    for (const { mesh, model } of this.#entries.values()) {
      const worldX = model.x - T.ORIGIN.x;
      const worldZ = -(model.y - T.ORIGIN.y);
      mesh.position.set(worldX, groundAt(worldX, worldZ), worldZ);
      mesh.rotation.set(0, -model.course * DEG, 0);
      const range = mesh.position.distanceTo(camera.position);
      const scale = Math.max(1, (MIN_SCREEN_LENGTH * range) / (pixelsAtUnit * model.length));
      mesh.scale.set(model.beam * scale, FREEBOARD * Math.min(scale, MAX_HEIGHT_SCALE), model.length * scale);
    }
    const autoClear = this.#renderer.autoClear;
    this.#renderer.autoClear = false;
    this.#renderer.setRenderTarget(null);
    // les coques se masquent entre elles, pas derrière les berges : elles restent visibles sur l'eau
    this.#renderer.clearDepth();
    this.#renderer.render(this.#scene, camera);
    this.#renderer.autoClear = autoClear;
  }

  dispose(): void {
    for (const entry of this.#entries.values()) this.#scene.remove(entry.mesh);
    this.#entries.clear();
    this.#hull.dispose();
    this.#idle.dispose();
    this.#active.dispose();
  }
}
