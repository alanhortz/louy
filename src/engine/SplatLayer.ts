/**
 * Calque de « gaussian splats » : les scans 3D, dessinés par-dessus le relief.
 *
 * Les splats sont translucides et triés à chaque image : ils ne peuvent pas
 * traverser la passe Eye-Dome du nuage de points. Ils ont donc leur propre
 * scène, rendue après elle. Ce module embarque le moteur Spark (plusieurs Mo) :
 * il n'est chargé qu'à la première demande d'affichage d'un scan.
 *
 * Un scan pèse plusieurs mégaoctets et ne peut être dessiné qu'une fois reçu en
 * entier. Le visiteur n'est jamais laissé devant un relief inchangé : le
 * téléchargement est annoncé pas à pas, puis le lieu se construit sous ses yeux —
 * les splats apparaissent du centre vers les bords, en quelques secondes.
 */

import { SparkRenderer, SplatEdit, SplatEditRgbaBlendMode, SplatEditSdf, SplatEditSdfType, SplatMesh } from '@sparkjsdev/spark';
import { Scene as ThreeScene, Vector3, type PerspectiveCamera, type WebGLRenderer } from 'three';
import type { Scan } from '../domain/scans.ts';
import * as T from '../domain/tiling.ts';

/** Où en est l'arrivée d'un scan : son téléchargement, puis sa construction à l'écran. */
export interface ScanProgress {
  id: string;
  phase: 'loading' | 'building' | 'ready';
  /** Avancement de la phase en cours, de 0 à 1. */
  fraction: number;
}

/** Durée de la construction à l'écran, une fois le scan reçu. */
const BUILD_MS = 4500;
/** L'avancement est annoncé par pas de 5 % : assez pour le lire, sans noyer le journal. */
const PROGRESS_STEPS = 20;

export class SplatLayer {
  readonly #renderer: WebGLRenderer;
  readonly #scene = new ThreeScene();
  readonly #spark: SparkRenderer;
  readonly #meshes = new Map<string, SplatMesh>();
  readonly #onDirty: () => void;
  readonly #onProgress: (progress: ScanProgress) => void;

  /** `onDirty` : le tri des splats ou un chargement vient d'aboutir, il faut redessiner. */
  constructor(renderer: WebGLRenderer, onDirty: () => void, onProgress: (progress: ScanProgress) => void = () => {}) {
    this.#onProgress = onProgress;
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
      if (!scan.splats) continue;
      let step = -1;
      const mesh = new SplatMesh({
        url: scan.splats,
        onProgress: (event) => {
          if (!event.lengthComputable || !this.#meshes.has(scan.id)) return;
          const fraction = event.loaded / event.total;
          const reached = Math.floor(fraction * PROGRESS_STEPS);
          if (reached === step) return;
          step = reached;
          this.#onProgress({ id: scan.id, phase: 'loading', fraction });
        },
        onLoad: (loaded) => this.#build(scan.id, loaded),
      });
      this.#onProgress({ id: scan.id, phase: 'loading', fraction: 0 });
      // le fichier est déjà dans le repère du viewer : il ne reste qu'à le poser sur son ancrage
      mesh.position.set(scan.x - T.ORIGIN.x, 0, -(scan.y - T.ORIGIN.y));
      this.#scene.add(mesh);
      this.#meshes.set(scan.id, mesh);
    }
  }

  /**
   * Fait apparaître un scan tout juste reçu : une sphère grandit depuis son centre,
   * et seuls les splats qu'elle a atteints sont visibles. Son bord est flou, pour
   * que le lieu semble se déposer plutôt que se découper.
   */
  #build(id: string, mesh: SplatMesh): void {
    if (this.#meshes.get(id) !== mesh) return;
    const box = mesh.getBoundingBox(true);
    const reach = box.getSize(new Vector3()).length() / 2;
    const veil = new SplatEditSdf({ type: SplatEditSdfType.SPHERE, radius: 0, opacity: 0 });
    box.getCenter(veil.position);
    // hors de la sphère, l'opacité des splats est multipliée par zéro
    const edit = new SplatEdit({
      rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY, invert: true, softEdge: reach * 0.08, sdfs: [veil],
    });
    edit.add(veil);
    mesh.add(edit);

    const startedAt = performance.now();
    let step = -1;
    mesh.onFrame = () => {
      const elapsed = Math.min(1, (performance.now() - startedAt) / BUILD_MS);
      // L'emprise d'un scan est tirée par ses splats les plus lointains : son cœur n'en
      // occupe qu'un tiers. La sphère part donc lentement, pour que ce cœur se construise
      // pendant la première moitié du temps, puis accélère vers les abords.
      veil.radius = elapsed ** 1.6 * reach * 1.2;
      if (elapsed >= 1) {
        mesh.remove(edit);
        mesh.onFrame = undefined;
        this.#onProgress({ id, phase: 'ready', fraction: 1 });
      } else {
        const reached = Math.floor(elapsed * PROGRESS_STEPS);
        if (reached !== step) { step = reached; this.#onProgress({ id, phase: 'building', fraction: elapsed }); }
      }
      // tant que la construction dure, chaque image en appelle une autre
      this.#onDirty();
    };
    this.#onDirty();
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
