/**
 * Calque de « gaussian splats » : les scans 3D, dessinés par-dessus le relief.
 *
 * Les splats sont translucides et triés à chaque image : ils ne peuvent pas
 * traverser la passe Eye-Dome du nuage de points. Ils ont donc leur propre
 * scène, rendue après elle. Ce module embarque le moteur Spark (plusieurs Mo) :
 * il n'est chargé qu'à la première demande d'affichage d'un scan.
 */

import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { Scene as ThreeScene, type PerspectiveCamera, type WebGLRenderer } from 'three';
import type { Scan } from '../domain/scans.ts';
import * as T from '../domain/tiling.ts';

export class SplatLayer {
  readonly #renderer: WebGLRenderer;
  readonly #scene = new ThreeScene();
  readonly #spark: SparkRenderer;
  readonly #meshes = new Map<string, SplatMesh>();
  readonly #onDirty: () => void;

  /** `onDirty` : le tri des splats ou un chargement vient d'aboutir, il faut redessiner. */
  constructor(renderer: WebGLRenderer, onDirty: () => void) {
    this.#renderer = renderer;
    this.#spark = new SparkRenderer({ renderer, onDirty });
    this.#scene.add(this.#spark);
    this.#onDirty = onDirty;
  }

  setScans(scans: readonly Scan[]): void {
    const wanted = new Map(scans.map((scan) => [scan.id, scan]));
    for (const [id, mesh] of this.#meshes) {
      if (wanted.has(id)) continue;
      this.#scene.remove(mesh);
      mesh.dispose();
      this.#meshes.delete(id);
    }
    for (const scan of scans) {
      if (this.#meshes.has(scan.id)) continue;
      const mesh = new SplatMesh({ url: scan.splats, onLoad: () => this.#onDirty() });
      // le fichier est déjà dans le repère du viewer : il ne reste qu'à le poser sur son ancrage
      mesh.position.set(scan.x - T.ORIGIN.x, 0, -(scan.y - T.ORIGIN.y));
      this.#scene.add(mesh);
      this.#meshes.set(scan.id, mesh);
    }
  }

  /** À appeler après la passe du relief : dessine par-dessus, sans rien effacer. */
  render(camera: PerspectiveCamera): void {
    if (this.#meshes.size === 0) return;
    const autoClear = this.#renderer.autoClear;
    this.#renderer.autoClear = false;
    this.#renderer.setRenderTarget(null);
    this.#renderer.render(this.#scene, camera);
    this.#renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.setScans([]);
    this.#scene.remove(this.#spark);
  }
}
