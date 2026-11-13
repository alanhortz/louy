/**
 * Calque des avions en volume : chaque appareil est une maquette à sa taille
 * réelle, posée à son altitude, orientée selon son cap, son tangage et son
 * roulis. Entre deux relevés, sa position est prolongée sur sa route et son
 * assiette rejoint en douceur la dernière connue.
 *
 * Vue de loin, une maquette de quarante mètres ne ferait pas un pixel : elle est
 * alors agrandie pour garder une taille lisible à l'écran, et retrouve sa taille
 * réelle dès que l'on s'approche.
 *
 * Comme les scans, les maquettes ont leur propre scène, rendue après la passe
 * Eye-Dome du relief : celle-ci ne sait dessiner que des points.
 */

import {
  BufferGeometry, DirectionalLight, Euler, HemisphereLight, Mesh, MeshLambertMaterial, Quaternion,
  Scene as ThreeScene, type PerspectiveCamera, type WebGLRenderer,
} from 'three';
import { AIRFRAMES, type Attitude } from '../domain/airframes.ts';
import * as T from '../domain/tiling.ts';
import { buildAirframe } from './aircraftModel.ts';

export interface AircraftModel {
  id: string;
  /** Type OACI à dessiner, présent dans `AIRFRAMES`. */
  airframe: string;
  /** Dernière position connue (Lambert 2008) ; `altitude` absente au sol. */
  x: number;
  y: number;
  altitude?: number;
  attitude: Attitude;
  /** Taux de virage, en degrés par seconde : le cap continue de tourner entre deux relevés. */
  turnRate: number;
  motion: { vx: number; vy: number; vz: number; at: number; horizon: number };
}

const DEG = Math.PI / 180;
/** Longueur minimale d'une maquette à l'écran, en pixels. */
const MIN_SCREEN_LENGTH = 30;
/** Une maquette plus proche que cela de la caméra est celle où l'on est assis : on ne la dessine pas. */
const COCKPIT_RADIUS = 60;
/** Vitesse à laquelle l'assiette affichée rejoint l'assiette connue (par seconde). */
const ATTITUDE_RATE = 2.5;

/**
 * Orientation d'une maquette (nez vers −Z, aile droite vers +X) pour une assiette
 * donnée, en degrés : lacet autour de la verticale, puis tangage, puis roulis.
 */
export function airframeOrientation(heading: number, pitch: number, roll: number, out = new Quaternion()): Quaternion {
  return out.setFromEuler(new Euler(pitch * DEG, -heading * DEG, -roll * DEG, 'YXZ'));
}

interface Entry { mesh: Mesh<BufferGeometry, MeshLambertMaterial>; model: AircraftModel; length: number }

export class AircraftLayer {
  readonly #renderer: WebGLRenderer;
  readonly #scene = new ThreeScene();
  readonly #geometries = new Map<string, BufferGeometry>();
  readonly #entries = new Map<string, Entry>();
  readonly #idle = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  /** Appareil sélectionné : la même maquette, réchauffée d'or comme les autres marqueurs. */
  readonly #active = new MeshLambertMaterial({ vertexColors: true, flatShading: true, color: 0xffe2a0, emissive: 0x6a4a00 });
  readonly #target = new Quaternion();
  #activeId: string | null = null;
  #last = 0;

  constructor(renderer: WebGLRenderer) {
    this.#renderer = renderer;
    const sun = new DirectionalLight(0xffffff, 1.7);
    sun.position.set(0.35, 1, 0.25);
    this.#scene.add(new HemisphereLight(0xffffff, 0x4a5560, 1.25), sun);
  }

  get count(): number { return this.#entries.size; }

  setModels(models: readonly AircraftModel[]): void {
    const wanted = new Set(models.map((model) => model.id));
    for (const [id, entry] of this.#entries) {
      if (wanted.has(id)) continue;
      this.#scene.remove(entry.mesh);
      this.#entries.delete(id);
    }
    for (const model of models) {
      const known = this.#entries.get(model.id);
      if (known && known.model.airframe === model.airframe) { known.model = model; continue; }
      if (known) this.#scene.remove(known.mesh);
      const frame = AIRFRAMES.get(model.airframe);
      if (!frame) continue;
      const mesh = new Mesh(this.#geometry(model.airframe), model.id === this.#activeId ? this.#active : this.#idle);
      // l'assiette de départ est posée d'emblée : seule la suite est adoucie
      mesh.quaternion.copy(this.#orientation(model, 0));
      mesh.frustumCulled = false;
      this.#scene.add(mesh);
      this.#entries.set(model.id, { mesh, model, length: frame.length });
    }
  }

  setActive(id: string | null): void {
    this.#activeId = id;
    for (const [key, entry] of this.#entries) entry.mesh.material = key === id ? this.#active : this.#idle;
  }

  #geometry(type: string): BufferGeometry {
    let geometry = this.#geometries.get(type);
    if (!geometry) {
      geometry = buildAirframe(AIRFRAMES.get(type)!);
      this.#geometries.set(type, geometry);
    }
    return geometry;
  }

  /** Orientation de la maquette `dt` secondes après son dernier relevé. */
  #orientation(model: AircraftModel, dt: number): Quaternion {
    const { heading, pitch, roll } = model.attitude;
    return airframeOrientation(heading + model.turnRate * dt, pitch, roll, this.#target);
  }

  /**
   * Place chaque maquette pour l'instant `now` (millisecondes Unix) et la dessine
   * par-dessus le relief. `groundAt` donne l'altitude du sol pour un appareil posé.
   */
  render(camera: PerspectiveCamera, viewportHeight: number, now: number, groundAt: (worldX: number, worldZ: number) => number): void {
    if (this.#entries.size === 0) return;
    const elapsed = this.#last === 0 ? 0 : Math.min(0.25, (now - this.#last) / 1000);
    this.#last = now;
    const blend = 1 - Math.exp(-ATTITUDE_RATE * elapsed);
    // taille, en pixels, d'un mètre vu à un mètre : sert à garder les maquettes lisibles de loin
    const pixelsAtUnit = viewportHeight / (2 * Math.tan((camera.fov * DEG) / 2));

    for (const { mesh, model, length } of this.#entries.values()) {
      const dt = Math.min(model.motion.horizon, Math.max(0, (now - model.motion.at) / 1000));
      const worldX = model.x + model.motion.vx * dt - T.ORIGIN.x;
      const worldZ = -(model.y + model.motion.vy * dt - T.ORIGIN.y);
      const grounded = model.altitude === undefined;
      const altitude = grounded ? groundAt(worldX, worldZ) : model.altitude! + model.motion.vz * dt;
      mesh.position.set(worldX, altitude, worldZ);
      mesh.quaternion.slerp(this.#orientation(model, dt), elapsed === 0 ? 1 : blend);

      const range = mesh.position.distanceTo(camera.position);
      mesh.visible = range > COCKPIT_RADIUS;
      const scale = Math.max(1, (MIN_SCREEN_LENGTH * range) / (pixelsAtUnit * length));
      mesh.scale.setScalar(scale);
      // posé, l'appareil agrandi reste sur ses roues : il grandit vers le haut, pas dans le sol
      if (grounded) mesh.position.y += scale * length * 0.06;
    }

    const autoClear = this.#renderer.autoClear;
    this.#renderer.autoClear = false;
    this.#renderer.setRenderTarget(null);
    // les maquettes se masquent entre elles, pas derrière le relief : elles volent au-dessus
    this.#renderer.clearDepth();
    this.#renderer.render(this.#scene, camera);
    this.#renderer.autoClear = autoClear;
  }

  dispose(): void {
    for (const entry of this.#entries.values()) this.#scene.remove(entry.mesh);
    this.#entries.clear();
    for (const geometry of this.#geometries.values()) geometry.dispose();
    this.#geometries.clear();
    this.#idle.dispose();
    this.#active.dispose();
  }
}
