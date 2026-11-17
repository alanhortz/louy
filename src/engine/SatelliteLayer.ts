/**
 * Calque de la vue « Satellite » : chaque image redressée est tendue à
 * l'horizontale, nord en haut, juste au-dessus du plus haut point du relief
 * qu'elle couvre. Vue du dessus, elle se lit comme une carte.
 */

import {
  DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, Scene as ThreeScene, SRGBColorSpace, TextureLoader,
  type PerspectiveCamera, type WebGLRenderer,
} from 'three';
import { SATELLITE_CLEARANCE, type SatelliteImage } from '../domain/satellite.ts';
import * as T from '../domain/tiling.ts';

export class SatelliteLayer {
  readonly #renderer: WebGLRenderer;
  readonly #scene = new ThreeScene();
  readonly #loader = new TextureLoader();
  readonly #sheets = new Map<string, Mesh<PlaneGeometry, MeshBasicMaterial>>();
  /** Image chargée pour chaque emprise : elle change avec la définition choisie. */
  readonly #sources = new Map<string, string>();
  readonly #onChange: () => void;

  constructor(renderer: WebGLRenderer, onChange: () => void) {
    this.#renderer = renderer;
    this.#onChange = onChange;
  }

  get count(): number { return this.#sheets.size; }

  /** Altitude de la plus haute image : la caméra doit rester au-dessus. */
  get ceiling(): number {
    let top = -Infinity;
    for (const sheet of this.#sheets.values()) top = Math.max(top, sheet.position.y);
    return top;
  }

  setImages(images: readonly SatelliteImage[]): void {
    const wanted = new Map(images.map((image) => [image.id, image.src]));
    for (const [id, sheet] of this.#sheets) {
      if (wanted.get(id) === this.#sources.get(id)) continue;
      this.#sources.delete(id);
      this.#discard(sheet);
      this.#sheets.delete(id);
    }
    for (const image of images) {
      if (this.#sheets.has(image.id)) continue;
      const material = new MeshBasicMaterial({ transparent: true, depthTest: false, toneMapped: false, side: DoubleSide, opacity: 0 });
      const sheet = new Mesh(new PlaneGeometry(image.east - image.west, image.north - image.south), material);
      // le plan est dressé face au ciel : le haut de l'image part vers le nord
      sheet.rotation.x = -Math.PI / 2;
      sheet.position.set((image.west + image.east) / 2 - T.ORIGIN.x, image.top + SATELLITE_CLEARANCE, -((image.south + image.north) / 2 - T.ORIGIN.y));
      this.#loader.load(image.src, (texture) => {
        if (this.#sheets.get(image.id) !== sheet) { texture.dispose(); return; }
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = this.#renderer.capabilities.getMaxAnisotropy();
        material.map = texture;
        material.opacity = 1;
        material.needsUpdate = true;
        this.#onChange();
      });
      this.#scene.add(sheet);
      this.#sheets.set(image.id, sheet);
      this.#sources.set(image.id, image.src);
    }
    this.#onChange();
  }

  #discard(sheet: Mesh<PlaneGeometry, MeshBasicMaterial>): void {
    this.#scene.remove(sheet);
    sheet.geometry.dispose();
    sheet.material.map?.dispose();
    sheet.material.dispose();
  }

  /** À appeler après le relief : dessine par-dessus, sans rien effacer. */
  render(camera: PerspectiveCamera): void {
    if (this.#sheets.size === 0) return;
    const autoClear = this.#renderer.autoClear;
    this.#renderer.autoClear = false;
    this.#renderer.setRenderTarget(null);
    this.#renderer.render(this.#scene, camera);
    this.#renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.setImages([]);
  }
}
