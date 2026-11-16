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
import { buildGround, type WalkGround } from '../domain/walk.ts';

/** Où en est l'arrivée d'un scan : son téléchargement, puis sa construction à l'écran. */
export interface ScanProgress {
  id: string;
  phase: 'loading' | 'building' | 'ready';
  /** Avancement de la phase en cours, de 0 à 1. */
  fraction: number;
}

/** Durée de la construction à l'écran, une fois le scan reçu. */
const BUILD_MS = 4500;
/** Hauteur d'où un tracé descend se poser sur le relief, en mètres. */
const LANDING_HEIGHT = 6000;
/** L'avancement est annoncé par pas de 5 % : assez pour le lire, sans noyer le journal. */
const PROGRESS_STEPS = 20;

export class SplatLayer {
  readonly #renderer: WebGLRenderer;
  readonly #scene = new ThreeScene();
  readonly #spark: SparkRenderer;
  readonly #meshes = new Map<string, SplatMesh>();
  /** Scans reçus en entier : leurs splats peuvent être lus. */
  readonly #loaded = new Set<string>();
  /** Sol de chaque lieu, déduit de ses splats à la première balade ; `null` si l'on ne peut pas y marcher. */
  readonly #grounds = new Map<string, WalkGround | null>();
  /** Finesses plus grossières des tracés, à montrer à mesure que l'on s'éloigne. */
  readonly #levels = new Map<string, { mesh: SplatMesh; beyond: number }[]>();
  readonly #onDirty: () => void;
  readonly #onProgress: (progress: ScanProgress) => void;

  /** `onDirty` : le tri des splats ou un chargement vient d'aboutir, il faut redessiner. */
  constructor(renderer: WebGLRenderer, onDirty: () => void, onProgress: (progress: ScanProgress) => void = () => {}) {
    this.#onProgress = onProgress;
    this.#renderer = renderer;
    // Le moteur rassemble ce qu'il dessine dans un encodage compact, où une position ne dépasse pas 65 km :
    // un tracé large de deux cents kilomètres y disparaîtrait par morceaux. On lui demande donc l'encodage
    // étendu, dès sa création — c'est le seul moment où ce choix est pris en compte.
    this.#spark = new SparkRenderer({ renderer, onDirty, accumExtSplats: true });
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
      this.#loaded.delete(id);
      this.#grounds.delete(id);
      for (const level of this.#levels.get(id) ?? []) { this.#scene.remove(level.mesh); level.mesh.dispose(); }
      this.#levels.delete(id);
    }
    for (const scan of scans) {
      if (this.#meshes.has(scan.id)) continue;
      if (!scan.splats) continue;
      let step = -1;
      const mesh = new SplatMesh({
        url: scan.splats,
        // un tracé couvre des centaines de kilomètres : ses positions ne tiennent pas dans l'encodage compact
        ...(scan.trace ? { extSplats: true } : {}),
        onProgress: (event) => {
          if (!event.lengthComputable || !this.#meshes.has(scan.id)) return;
          const fraction = event.loaded / event.total;
          const reached = Math.floor(fraction * PROGRESS_STEPS);
          if (reached === step) return;
          step = reached;
          this.#onProgress({ id: scan.id, phase: 'loading', fraction });
        },
        onLoad: (loaded) => this.#build(scan.id, loaded, scan.trace === true),
      });
      this.#addLevels(scan);
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
  #build(id: string, mesh: SplatMesh, lands = false, level = false): void {
    // une finesse d'un tracé se dévoile comme lui, mais sans rien annoncer : c'est le tracé qui parle
    const announce = level ? () => {} : this.#onProgress;
    if (level ? !this.#levels.get(id)?.some((other) => other.mesh === mesh) : this.#meshes.get(id) !== mesh) return;
    if (!level) this.#loaded.add(id);
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
      // un tracé descend du ciel se poser sur le relief, en ralentissant
      if (lands) mesh.position.y = LANDING_HEIGHT * (1 - elapsed) ** 3;
      if (elapsed >= 1) {
        mesh.remove(edit);
        mesh.onFrame = undefined;
        announce({ id, phase: 'ready', fraction: 1 });
      } else {
        const reached = Math.floor(elapsed * PROGRESS_STEPS);
        if (reached !== step) { step = reached; announce({ id, phase: 'building', fraction: elapsed }); }
      }
      // tant que la construction dure, chaque image en appelle une autre
      this.#onDirty();
    };
    this.#onDirty();
  }

  /**
   * Sol sur lequel marcher dans un lieu, dans le repère du viewer. `undefined` tant
   * que le lieu n'est pas reçu en entier ; `null` s'il est trop pauvre pour y marcher.
   */
  ground(id: string): WalkGround | null | undefined {
    const mesh = this.#meshes.get(id);
    if (!mesh || !this.#loaded.has(id)) return undefined;
    if (!this.#grounds.has(id)) {
      const points: number[] = [];
      const { x, y, z } = mesh.position;
      // les splats presque transparents sont du brouillard de reconstruction, pas de la matière
      mesh.forEachSplat((_index, center, _scales, _quaternion, opacity) => {
        if (opacity >= 0.3) points.push(center.x + x, center.y + y, center.z + z);
      });
      this.#grounds.set(id, buildGround(new Float32Array(points)));
    }
    return this.#grounds.get(id);
  }

  /**
   * Un tracé se regarde du bord de la route comme de toute la Wallonie : un ruban large de quelques
   * mètres ferait, de loin, moins d'un pixel. Il vient donc en plusieurs finesses, chacune dans son fichier.
   */
  #addLevels(scan: Scan): void {
    if (!scan.levels) return;
    this.#levels.set(scan.id, scan.levels.map(({ splats, beyond }) => {
      const mesh = new SplatMesh({ url: splats, extSplats: true, onLoad: (loaded) => this.#build(scan.id, loaded, true, true) });
      mesh.position.set(scan.x - T.ORIGIN.x, 0, -(scan.y - T.ORIGIN.y));
      mesh.visible = false;
      this.#scene.add(mesh);
      return { mesh, beyond };
    }));
  }

  /** Ne montre, de chaque tracé, que la finesse qui convient à l'éloignement de la vue. */
  #pickLevels(distance: number): void {
    for (const [id, levels] of this.#levels) {
      const base = this.#meshes.get(id);
      let shown = -1;
      levels.forEach((level, at) => { if (distance >= level.beyond && (shown < 0 || level.beyond >= levels[shown]!.beyond)) shown = at; });
      if (base) base.visible = shown < 0;
      levels.forEach((level, at) => { level.mesh.visible = at === shown; });
    }
  }

  /** À appeler après la passe du relief : dessine par-dessus, sans rien effacer. `distance` : éloignement de la vue. */
  render(camera: PerspectiveCamera, distance = 0): void {
    if (this.#meshes.size === 0) return;
    this.#pickLevels(distance);
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
