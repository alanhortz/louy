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

import { dyno, SparkRenderer, SplatEdit, SplatEditRgbaBlendMode, SplatEditSdf, SplatEditSdfType, SplatMesh } from '@sparkjsdev/spark';
import { Scene as ThreeScene, Vector3, type PerspectiveCamera, type WebGLRenderer } from 'three';
import { nearestFirst, type Scan } from '../domain/scans.ts';
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
/** Demi-largeur à l'écran du trait d'un tracé, en pixels. */
const STROKE_PIXELS = 3.2;
/** Nombre d'écarts-types auquel une tache de tracé est coupée net. */
const STROKE_CUT = 1.6;
/** Hauteur d'où un tracé descend se poser sur le relief, en mètres. */
const LANDING_HEIGHT = 6000;
/** L'avancement est annoncé par pas de 5 % : assez pour le lire, sans noyer le journal. */
const PROGRESS_STEPS = 20;
/** Fichiers complets téléchargés et décodés en même temps. */
const ARRIVING_AT_ONCE = 2;

export class SplatLayer {
  readonly #renderer: WebGLRenderer;
  readonly #scene = new ThreeScene();
  readonly #spark: SparkRenderer;
  /**
   * Les tracés ont leur propre scène et leur propre moteur, créés au premier tracé : ils se dessinent
   * autrement que les lieux filmés — à bords nets, et sur des centaines de kilomètres.
   */
  #traces: { scene: ThreeScene; spark: SparkRenderer } | null = null;
  /** Scène des images du sol tirées d'un drone : elles passent devant le relief. */
  #covers: { scene: ThreeScene; spark: SparkRenderer } | null = null;
  readonly #meshes = new Map<string, SplatMesh>();
  /** Scans reçus en entier : leurs splats peuvent être lus. */
  readonly #loaded = new Set<string>();
  /** Sol de chaque lieu, déduit de ses splats à la première balade ; `null` si l'on ne peut pas y marcher. */
  readonly #grounds = new Map<string, WalkGround | null>();
  /**
   * Tracés dont le trait garde la même épaisseur à l'écran, comme sur une carte routière : pour chacun de
   * leurs fichiers, la demi-largeur du trait tel qu'il est fabriqué, et le facteur appliqué à ses taches.
   */
  readonly #strokes = new Map<SplatMesh, { width: number; floor: number; factor: ReturnType<typeof dyno.dynoFloat> }>();
  /** Finesses plus grossières des tracés, à montrer à mesure que l'on s'éloigne. */
  readonly #levels = new Map<string, { mesh: SplatMesh; beyond: number }[]>();
  /** Fichier voulu pour chaque relevé, chargé ou encore en file : il change avec la définition choisie. */
  readonly #urls = new Map<string, string>();
  /** Suites des relevés partagés en plusieurs fichiers : le détail qui s'ajoute à l'essentiel. */
  readonly #extras = new Map<string, SplatMesh[]>();
  /** Aperçus à l'écran, en attendant le fichier complet. */
  readonly #previews = new Map<string, SplatMesh>();
  /** Relevés dont le fichier complet attend son tour, et ceux qui sont en train d'arriver. */
  #queue: Scan[] = [];
  readonly #arriving = new Set<string>();
  #focus = { x: 0, y: 0 };
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

  /**
   * `focus` : le point regardé, dans le repère des relevés (Lambert). Il fixe l'ordre de chargement — le lieu
   * le plus proche d'abord.
   */
  setScans(scans: readonly Scan[], focus?: { x: number; y: number }): void {
    if (focus) this.#focus = focus;
    const wanted = new Map(scans.map((scan) => [scan.id, scan]));
    for (const [id, url] of this.#urls) {
      // même relevé, même fichier : rien à faire ; un autre fichier (une autre définition) le remplace
      if (wanted.get(id)?.splats !== url) this.#drop(id);
    }
    for (const scan of scans) {
      if (this.#urls.has(scan.id) || !scan.splats) continue;
      this.#urls.set(scan.id, scan.splats);
      this.#onProgress({ id: scan.id, phase: 'loading', fraction: 0 });
      // un tracé n'attend pas son tour : il est léger, et c'est lui qui situe le reste
      if (scan.trace) { this.#open(scan); continue; }
      if (scan.preview) this.#openPreview(scan, scan.preview);
      this.#queue.push(scan);
    }
    this.#pump();
  }

  /** Retire un relevé : son fichier, son aperçu, ses finesses, et sa place dans la file. */
  #drop(id: string): void {
    this.#urls.delete(id);
    this.#queue = this.#queue.filter((scan) => scan.id !== id);
    this.#arriving.delete(id);
    const mesh = this.#meshes.get(id);
    if (mesh) { mesh.removeFromParent(); mesh.dispose(); this.#strokes.delete(mesh); }
    this.#meshes.delete(id);
    this.#closePreview(id);
    for (const extra of this.#extras.get(id) ?? []) { extra.removeFromParent(); extra.dispose(); }
    this.#extras.delete(id);
    this.#loaded.delete(id);
    this.#grounds.delete(id);
    for (const level of this.#levels.get(id) ?? []) { level.mesh.removeFromParent(); level.mesh.dispose(); this.#strokes.delete(level.mesh); }
    this.#levels.delete(id);
  }

  /**
   * Les fichiers complets arrivent deux par deux, le plus proche du point regardé d'abord. Tous à la fois,
   * ils se partageraient la liaison, et leur décodage simultané ferait saccader la carte.
   */
  #pump(): void {
    while (this.#arriving.size < ARRIVING_AT_ONCE && this.#queue.length > 0) {
      const [next] = nearestFirst(this.#queue, this.#focus);
      this.#queue = this.#queue.filter((scan) => scan !== next);
      this.#arriving.add(next!.id);
      this.#open(next!);
    }
  }

  #sceneOf(scan: Scan): ThreeScene {
    return scan.trace ? this.#traceScene() : scan.orthophoto ? this.#coverScene() : this.#scene;
  }

  /** Demande le fichier complet d'un relevé. */
  #open(scan: Scan): void {
    let step = -1;
    const mesh = new SplatMesh({
      url: scan.splats!,
      // un tracé couvre des centaines de kilomètres : ses positions ne tiennent pas dans l'encodage compact
      ...(scan.trace ? { extSplats: true } : {}),
      onProgress: (event) => {
        if (!event.lengthComputable || this.#meshes.get(scan.id) !== mesh) return;
        const fraction = event.loaded / event.total;
        const reached = Math.floor(fraction * PROGRESS_STEPS);
        if (reached === step) return;
        step = reached;
        this.#onProgress({ id: scan.id, phase: 'loading', fraction });
      },
      onLoad: (loaded) => this.#arrived(scan, loaded),
    });
    // de près, le trait n'est jamais plus fin que la route elle-même
    if (scan.trace && scan.width) this.#followZoom(mesh, scan.width, 1);
    this.#addLevels(scan);
    // le fichier est déjà dans le repère du viewer : il ne reste qu'à le poser sur son ancrage
    mesh.position.set(scan.x - T.ORIGIN.x, 0, -(scan.y - T.ORIGIN.y));
    // tant que l'aperçu tient la place, le fichier complet reste caché : il n'apparaît qu'entier
    mesh.visible = !this.#previews.has(scan.id);
    this.#sceneOf(scan).add(mesh);
    this.#meshes.set(scan.id, mesh);
    // un fichier qui n'arrive pas ne doit pas bloquer les suivants
    void mesh.initialized.catch(() => { if (this.#meshes.get(scan.id) === mesh) { this.#arriving.delete(scan.id); this.#pump(); } });
  }

  /** Le fichier complet est là : il remplace son aperçu d'un coup, ou se construit s'il n'en avait pas. */
  #arrived(scan: Scan, mesh: SplatMesh): void {
    if (this.#meshes.get(scan.id) !== mesh) return;
    this.#arriving.delete(scan.id);
    if (this.#previews.has(scan.id)) {
      this.#closePreview(scan.id);
      mesh.visible = true;
      this.#loaded.add(scan.id);
      this.#onProgress({ id: scan.id, phase: 'ready', fraction: 1 });
      this.#onDirty();
    } else {
      this.#build(scan.id, mesh, scan.trace === true);
    }
    this.#extend(scan, 0);
    this.#pump();
  }

  /**
   * La suite d'un relevé partagé en plusieurs fichiers : ils arrivent l'un après l'autre, une fois l'essentiel
   * à l'écran, et s'y ajoutent sans rien annoncer — le lieu est déjà là, il s'affine.
   */
  #extend(scan: Scan, at: number): void {
    const url = scan.more?.[at];
    if (!url || this.#urls.get(scan.id) !== scan.splats) return;
    const mesh = new SplatMesh({
      url,
      onLoad: () => {
        if (!this.#extras.get(scan.id)?.includes(mesh)) return;
        this.#onDirty();
        this.#extend(scan, at + 1);
      },
    });
    mesh.position.set(scan.x - T.ORIGIN.x, 0, -(scan.y - T.ORIGIN.y));
    this.#sceneOf(scan).add(mesh);
    this.#extras.set(scan.id, [...(this.#extras.get(scan.id) ?? []), mesh]);
  }

  /** L'aperçu d'un relevé : demandé tout de suite, hors file — il est là pour qu'on n'attende pas. */
  #openPreview(scan: Scan, url: string): void {
    const mesh = new SplatMesh({ url, onLoad: (loaded) => this.#build(scan.id, loaded, false, 'preview') });
    mesh.position.set(scan.x - T.ORIGIN.x, 0, -(scan.y - T.ORIGIN.y));
    this.#sceneOf(scan).add(mesh);
    this.#previews.set(scan.id, mesh);
  }

  #closePreview(id: string): void {
    const preview = this.#previews.get(id);
    if (!preview) return;
    preview.onFrame = undefined;
    preview.removeFromParent();
    preview.dispose();
    this.#previews.delete(id);
  }

  /**
   * Fait apparaître un scan tout juste reçu : une sphère grandit depuis son centre,
   * et seuls les splats qu'elle a atteints sont visibles. Son bord est flou, pour
   * que le lieu semble se déposer plutôt que se découper.
   */
  #build(id: string, mesh: SplatMesh, lands = false, role: 'scan' | 'level' | 'preview' = 'scan'): void {
    // une finesse d'un tracé se dévoile comme lui, mais sans rien annoncer : c'est le tracé qui parle ;
    // un aperçu non plus : le relevé n'est prêt que lorsque son fichier complet est là
    const announce = role === 'scan' ? this.#onProgress : () => {};
    const expected = role === 'level' ? this.#levels.get(id)?.some((other) => other.mesh === mesh) : (role === 'preview' ? this.#previews : this.#meshes).get(id) === mesh;
    if (!expected) return;
    if (role === 'scan') this.#loaded.add(id);
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
    this.#levels.set(scan.id, scan.levels.map(({ splats, beyond, width }) => {
      const mesh = new SplatMesh({ url: splats, extSplats: true, onLoad: (loaded) => this.#build(scan.id, loaded, true, 'level') });
      if (width) this.#followZoom(mesh, width, 0);
      mesh.position.set(scan.x - T.ORIGIN.x, 0, -(scan.y - T.ORIGIN.y));
      mesh.visible = false;
      this.#traceScene().add(mesh);
      return { mesh, beyond };
    }));
  }

  /**
   * Scène des tracés. Son moteur diffère de celui des lieux filmés sur trois points :
   * - l'encodage étendu, car l'encodage compact ne porte pas au-delà de 65 km et un tracé en fait deux cents
   *   (ce choix ne se fait qu'à la création du moteur) ;
   * - des taches pleines, sans dégradé vers leur bord ;
   * - coupées net à faible distance de leur centre.
   * Mises bout à bout le long d'une route, elles donnent un trait aux contours francs, comme sur une carte.
   */
  #traceScene(): ThreeScene {
    if (!this.#traces) {
      const scene = new ThreeScene();
      const spark = new SparkRenderer({
        renderer: this.#renderer, onDirty: this.#onDirty, accumExtSplats: true, falloff: 0, maxStdDev: STROKE_CUT,
      });
      scene.add(spark);
      this.#traces = { scene, spark };
    }
    return this.#traces.scene;
  }

  /**
   * Scène des images du sol. Une prise de vue récente, faite de près, est plus juste que le relief
   * LiDAR qu'elle recouvre : là où elle existe, c'est elle qu'on montre, et aucun point du relief
   * ne doit la traverser. Elle a donc sa scène, dessinée sans tenir compte de la profondeur du relief.
   */
  #coverScene(): ThreeScene {
    if (!this.#covers) {
      const scene = new ThreeScene();
      const spark = new SparkRenderer({ renderer: this.#renderer, onDirty: this.#onDirty });
      scene.add(spark);
      this.#covers = { scene, spark };
    }
    return this.#covers.scene;
  }

  /** Fait dépendre la taille des taches d'un fichier d'un facteur, que la vue règle à chaque image. */
  #followZoom(mesh: SplatMesh, width: number, floor: number): void {
    const factor = dyno.dynoFloat(1);
    mesh.objectModifier = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
      if (!gsplat) throw new Error('tache absente');
      const { scales } = dyno.splitGsplat(gsplat).outputs;
      return { gsplat: dyno.combineGsplat({ gsplat, scales: dyno.mul(scales, factor) }) };
    });
    mesh.updateGenerator();
    this.#strokes.set(mesh, { width, floor, factor });
  }

  /** Règle l'épaisseur des traits sur l'éloignement de la vue : `metresPerPixel` au point visé. */
  #sizeStrokes(metresPerPixel: number): void {
    for (const [mesh, stroke] of this.#strokes) {
      // la tache est coupée à `STROKE_CUT` écarts-types : c'est là qu'est le bord du trait
      const wanted = Math.max(stroke.floor, ((STROKE_PIXELS / STROKE_CUT) * metresPerPixel) / stroke.width);
      // le moteur recalcule tout le tracé à chaque changement : on ne le dérange que pour un écart visible
      if (Math.abs(wanted - stroke.factor.value) < stroke.factor.value * 0.02) continue;
      stroke.factor.value = wanted;
      mesh.updateVersion();
    }
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
  render(camera: PerspectiveCamera, distance = 0, viewportHeight = 1, { immersive = false } = {}): void {
    if (this.#meshes.size === 0 && this.#previews.size === 0) return;
    this.#pickLevels(distance);
    this.#sizeStrokes((2 * distance * Math.tan((camera.fov * Math.PI) / 360)) / viewportHeight);
    const autoClear = this.#renderer.autoClear;
    this.#renderer.autoClear = false;
    // dans un casque, la cible du rendu est celle de la séance : on ne la remplace pas par l'écran
    if (!immersive) this.#renderer.setRenderTarget(null);
    // les images du sol d'abord, relief oublié : elles le remplacent là où elles existent
    if (this.#covers && this.#covers.scene.children.length > 1) {
      this.#renderer.clearDepth();
      this.#renderer.render(this.#covers.scene, camera);
    }
    // les tracés ensuite : un lieu filmé posé sur une route passe par-dessus
    if (this.#traces) this.#renderer.render(this.#traces.scene, camera);
    this.#renderer.render(this.#scene, camera);
    this.#renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.setScans([]);
    this.#scene.remove(this.#spark);
    if (this.#traces) this.#traces.scene.remove(this.#traces.spark);
    if (this.#covers) this.#covers.scene.remove(this.#covers.spark);
  }
}
