/**
 * Calque des vols de drone : pour chaque vol, le trajet dans l'espace — parcouru en trait
 * plein, à venir en pointillé, comme pour un avion —, la maquette du drone là où il en est,
 * et ce que sa caméra voit : les quatre arêtes de son champ jusqu'au sol, et l'emprise au sol.
 *
 * Économie : tout est créé une fois par vol. Le trajet entier est dans deux tampons que l'on
 * ne fait que dévoiler (`setDrawRange`) ; le champ de la caméra tient dans un tampon de huit
 * segments réécrit sur place ; la maquette est une géométrie partagée. Aucune allocation par image.
 */

import {
  BufferAttribute, BufferGeometry, DirectionalLight, Group, HemisphereLight, Line, LineBasicMaterial,
  LineDashedMaterial, LineSegments, Mesh, MeshLambertMaterial, Quaternion, Scene as ThreeScene, Vector3,
  type PerspectiveCamera, type WebGLRenderer,
} from 'three';
import { clipPose } from '../domain/clips.ts';
import { flightDuration, flightSpeed, flightTime, type DroneFlight } from '../domain/droneFlights.ts';
import * as T from '../domain/tiling.ts';
import { buildDrone } from './droneModel.ts';

const ACCENT = 0x00d4ff;
/** Portée du champ dessiné quand le regard ne touche pas le sol (caméra à l'horizon). */
const REACH = 140;

interface Entry {
  flight: DroneFlight; duration: number; group: Group; drone: Mesh; past: Line; future: Line; view: LineSegments;
  /** Halo tactique : un réticule autour du drone, et ses relevés — vitesse, instant du vol, date. */
  halo: HTMLElement; shown: string;
  /** Demi-ouvertures du champ : tangentes horizontale et verticale. */
  spread: { x: number; y: number };
}

export type GroundProbe = (worldX: number, worldZ: number) => number | null;

export class DroneLayer {
  readonly #renderer: WebGLRenderer;
  readonly #scene = new ThreeScene();
  readonly #entries = new Map<string, Entry>();
  readonly #model = buildDrone();
  readonly #body = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  readonly #solid = new LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.95, depthTest: false });
  readonly #dashed = new LineDashedMaterial({ color: ACCENT, transparent: true, opacity: 0.6, dashSize: 3, gapSize: 3, depthTest: false });
  readonly #sight = new LineBasicMaterial({ color: 0xffd97a, transparent: true, opacity: 0.8, depthTest: false });
  readonly #q = new Quaternion();
  readonly #ray = new Vector3();
  readonly #eye = new Vector3();
  #hidden: string | null = null;
  #sightShown = true;

  readonly #host: HTMLElement;

  constructor(renderer: WebGLRenderer, host: HTMLElement) {
    this.#renderer = renderer;
    this.#host = host;
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.4, 1, 0.3);
    this.#scene.add(new HemisphereLight(0xffffff, 0x4a5560, 1.3), sun);
  }

  get count(): number { return this.#entries.size; }

  /** Montre ou cache le champ de la caméra ; le trajet, le drone et son pointeur restent. */
  setSight(visible: boolean): void { this.#sightShown = visible; }

  /** Vol dont on occupe la caméra : on ne se dessine pas soi-même. */
  hide(id: string | null): void { this.#hidden = id; }

  setFlights(flights: readonly DroneFlight[]): void {
    const wanted = new Set(flights.map((flight) => flight.id));
    for (const [id, entry] of this.#entries) {
      if (wanted.has(id)) continue;
      this.#scene.remove(entry.group);
      entry.halo.remove();
      for (const line of [entry.past, entry.future, entry.view]) line.geometry.dispose();
      this.#entries.delete(id);
    }
    for (const flight of flights) {
      if (this.#entries.has(flight.id)) continue;
      const points = new Float32Array(flight.track.length * 3);
      flight.track.forEach((key, at) => points.set([key.x - T.ORIGIN.x, key.altitude, -(key.y - T.ORIGIN.y)], at * 3));
      const path = () => new BufferGeometry().setAttribute('position', new BufferAttribute(points, 3));
      const past = new Line(path(), this.#solid);
      const future = new Line(path(), this.#dashed);
      future.computeLineDistances();
      const view = new LineSegments(new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(8 * 2 * 3), 3)), this.#sight);
      const drone = new Mesh(this.#model, this.#body);
      const group = new Group();
      for (const part of [past, future, view, drone]) { part.frustumCulled = false; group.add(part); }
      this.#scene.add(group);
      const tan = Math.tan((flight.fov * Math.PI) / 360);
      const halo = document.createElement('div');
      halo.className = 'drone-halo';
      halo.setAttribute('aria-hidden', 'true');
      halo.innerHTML = '<i></i><span></span>';
      this.#host.append(halo);
      this.#entries.set(flight.id, { flight, duration: flightDuration(flight), group, drone, past, future, view, halo, shown: '', spread: { x: tan * flight.aspect, y: tan } });
    }
  }

  /** À appeler après le relief : dessine par-dessus. `now` en secondes ; `ground` donne l'altitude du sol. */
  render(camera: PerspectiveCamera, viewportWidth: number, viewportHeight: number, now: number, ground: GroundProbe): void {
    if (this.#entries.size === 0) return;
    for (const entry of this.#entries.values()) {
      const { flight, drone, past, future, view, spread } = entry;
      entry.group.visible = flight.id !== this.#hidden;
      entry.halo.hidden = !entry.group.visible;
      if (!entry.group.visible) continue;
      // chaque vol se rejoue en boucle, avec un temps de repos au bout
      const t = flightTime(flight, now);
      const pose = clipPose(flight.track, t);
      this.#eye.set(pose.x - T.ORIGIN.x, pose.altitude, -(pose.y - T.ORIGIN.y));
      this.#q.set(...pose.q);
      drone.position.copy(this.#eye);
      drone.quaternion.copy(this.#q);
      // Le drone est à sa taille réelle, 25 cm : de loin il ne fait qu'un point. C'est le halo qui le désigne —
      // un réticule de taille fixe à l'écran, avec la vitesse, l'instant du vol et sa date.
      this.#ray.copy(this.#eye).project(camera);
      entry.halo.hidden = this.#ray.z > 1 || Math.abs(this.#ray.x) > 1.2 || Math.abs(this.#ray.y) > 1.2;
      if (!entry.halo.hidden) {
        entry.halo.style.transform = `translate3d(${(((this.#ray.x + 1) / 2) * viewportWidth).toFixed(1)}px, ${(((1 - this.#ray.y) / 2) * viewportHeight).toFixed(1)}px, 0)`;
        const text = `${Math.round(flightSpeed(flight, t))} km/h\nT+${t.toFixed(1).padStart(4, '0')} s\n${flight.date ?? 'date inconnue'}`;
        if (text !== entry.shown) { entry.shown = text; entry.halo.lastElementChild!.textContent = text; }
      }
      // le trajet : parcouru jusqu'à la pose courante, à venir au-delà
      let reached = 0;
      while (reached < flight.track.length - 1 && flight.track[reached + 1]!.t <= t) reached++;
      past.geometry.setDrawRange(0, reached + 1);
      future.geometry.setDrawRange(reached, flight.track.length - reached);
      view.visible = this.#sightShown;
      if (!view.visible) continue;
      // le champ de la caméra : quatre arêtes jusqu'au sol, et l'emprise qu'elles y découpent
      const floor = ground(this.#eye.x, this.#eye.z) ?? this.#eye.y - 60;
      const at = view.geometry.getAttribute('position') as BufferAttribute;
      const corners: [number, number, number][] = [];
      for (const [sx, sy] of [[-1, 1], [1, 1], [1, -1], [-1, -1]] as const) {
        this.#ray.set(sx * spread.x, sy * spread.y, -1).normalize().applyQuaternion(this.#q);
        const reach = this.#ray.y < -0.02 ? Math.min(REACH, (floor - this.#eye.y) / this.#ray.y) : REACH;
        corners.push([this.#eye.x + this.#ray.x * reach, this.#eye.y + this.#ray.y * reach, this.#eye.z + this.#ray.z * reach]);
      }
      corners.forEach((corner, k) => {
        const next = corners[(k + 1) % 4]!;
        at.setXYZ(k * 4, this.#eye.x, this.#eye.y, this.#eye.z);
        at.setXYZ(k * 4 + 1, ...corner);
        at.setXYZ(k * 4 + 2, ...corner);
        at.setXYZ(k * 4 + 3, ...next);
      });
      at.needsUpdate = true;
    }
    const autoClear = this.#renderer.autoClear;
    this.#renderer.autoClear = false;
    this.#renderer.setRenderTarget(null);
    this.#renderer.clearDepth();
    this.#renderer.render(this.#scene, camera);
    this.#renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.setFlights([]);
    this.#model.dispose();
    for (const material of [this.#body, this.#solid, this.#dashed, this.#sight]) material.dispose();
  }
}
