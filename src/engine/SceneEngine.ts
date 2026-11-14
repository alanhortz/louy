/**
 * Moteur de rendu : assemble le streaming du nuage de points, la navigation et
 * les calques en superposition derrière une interface impérative étroite.
 *
 * Il ne connaît ni React ni XState : la machine `viewer` le pilote par des
 * appels de méthode et l'écoute par les `EngineListeners`. C'est la seule
 * frontière entre le monde déclaratif de l'application et la boucle d'images.
 */

import { Color, Group, PerspectiveCamera, Scene as ThreeScene, Vector3, WebGLRenderer } from 'three';

import { cockpitPose } from '../domain/aircraft.ts';
import type { QualityProfile } from '../domain/quality.ts';
import type { Scan } from '../domain/scans.ts';
import type { SceneSource } from '../domain/scene.ts';
import type { TileUrlBuilder } from '../domain/tiles.ts';
import * as T from '../domain/tiling.ts';
import { POSE_LIMITS, type Pose } from '../domain/view.ts';
import { EyeDomeLighting } from './core/EyeDomeLighting.js';
import { MapControls } from './core/MapControls.js';
import { PointMaterialCache } from './core/PointMaterial.js';
import { TileLoader } from './core/TileLoader.js';
import { TileTree } from './core/TileTree.js';
import mntLut from './lut/mnt.json';
import mnsLut from './lut/mns.json';
import { AircraftLayer, type AircraftModel } from './AircraftLayer.ts';
import { OverlayLayer, type OverlayFeature, type OverlayStyle } from './OverlayLayer.ts';
import type { ScanProgress, SplatLayer } from './SplatLayer.ts';

const DEG = Math.PI / 180;
const METRES = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 });

/** Passes de reconstruction de la surface sous contrainte de quantification. */
const SMOOTHING_PASSES = 14;
/** Intensité de l'éclairage Eye-Dome : lisible sans écraser l'orthophoto. */
const EDL_STRENGTH = 0.3;
/** Durée d'immobilité après laquelle la vue est dite « posée ». */
const SETTLE_DELAY_MS = 320;
/** Images rendues après le dernier changement, pour laisser l'inertie s'éteindre. */
const IDLE_FRAMES = 4;
/** Vitesse de l'orbite automatique : un tour en une minute environ. */
const ORBIT_SPEED = (2 * Math.PI) / 64;
/** Inclinaison adoptée pour survoler un lieu. */
const FLYOVER_TILT = 58;

export interface EngineActivity {
  loading: boolean;
  points: number;
}

export interface EngineListeners {
  onReady(): void;
  onViewSettled(pose: Pose): void;
  onActivity(activity: EngineActivity): void;
  onOrbitEnded(): void;
  /** Un scan 3D arrive : téléchargement, puis construction à l'écran. */
  onScanProgress(progress: ScanProgress): void;
  onOverlayPicked(layer: string, id: string): void;
  /** Le visiteur a repris la main : la caméra ne suit plus rien. */
  onFollowEnded(): void;
  onContextLost(): void;
  onContextRestored(): void;
}

/**
 * Afficheurs de l'altimètre. Comme les calques, ils sont tenus à jour par la
 * boucle d'images : une valeur qui change à chaque image n'a pas à traverser
 * les machines à états.
 */
export interface Altimeter {
  /** Altitude de la caméra, en mètres au-dessus du niveau de la mer. */
  camera: HTMLElement;
  /** Altitude du sol au point visé. */
  ground: HTMLElement;
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  overlayRoot: HTMLElement;
  altimeter: Altimeter;
  quality: QualityProfile;
  tileUrl: TileUrlBuilder;
  source: SceneSource;
  pose: Pose;
  /** Ouvrir à la précision maximale : la pose de départ est rapprochée si nécessaire. */
  sharpStart: boolean;
  /** Ouvrir par un tour complet autour du lieu visé. */
  orbitStart: boolean;
  listeners: EngineListeners;
}

export interface Flyover {
  x: number;
  y: number;
  /** Hauteur de la caméra au-dessus du lieu, en mètres. */
  height: number;
  orbit: boolean;
  /** Cap de la vue, en degrés ; à défaut, le cap courant est conservé. */
  azimuth?: number;
  /** Nombre de tours de l'orbite, négatif pour l'autre sens ; à défaut, elle dure jusqu'au premier geste. */
  turns?: number;
}

/**
 * Mobile à suivre depuis son poste de pilotage : sa dernière position connue,
 * sa vitesse (m/s, repère Lambert) et sa route, valables depuis l'instant `at`.
 */
export interface FollowTarget {
  x: number;
  y: number;
  altitude: number | null;
  vx: number;
  vy: number;
  vz: number;
  track: number;
  at: number;
  /** Durée, en secondes, au-delà de laquelle la position n'est plus extrapolée. */
  horizon: number;
}

interface TileLike { level: number; i: number; j: number }

export class SceneEngine {
  readonly #canvas: HTMLCanvasElement;
  readonly #overlayRoot: HTMLElement;
  readonly #altimeter: Altimeter;
  readonly #quality: QualityProfile;
  readonly #tileUrl: TileUrlBuilder;
  readonly #listeners: EngineListeners;

  readonly #renderer: WebGLRenderer;
  readonly #scene = new ThreeScene();
  readonly #points = new Group();
  readonly #camera = new PerspectiveCamera(55, 1, 10, 400000);
  readonly #controls: MapControls;
  readonly #materials = new PointMaterialCache();
  readonly #edl: EyeDomeLighting;
  readonly #loader: TileLoader;
  readonly #tree: TileTree;
  readonly #overlays = new Map<string, OverlayLayer<any>>();
  readonly #resizeObserver: ResizeObserver;
  readonly #teardown = new AbortController();
  readonly #probe = new Vector3();

  #source: SceneSource;
  #scans: readonly Scan[] = [];
  /** Fichiers de scans à faire venir d'avance, dès que le relief de la vue est chargé. */
  #preload: string[] = [];
  #splats: SplatLayer | null = null;
  #disposed = false;
  #follow: FollowTarget | null = null;
  /** Maquettes des avions ; créé au premier appareil à dessiner. */
  #aircraft: AircraftLayer | null = null;
  #raf = 0;
  #last = performance.now();
  #idleFrames = IDLE_FRAMES;
  #movedAt = 0;
  #unsettled = true;
  #ready = false;
  #activity: EngineActivity = { loading: false, points: 0 };
  #size = { width: 1, height: 1 };

  constructor(options: EngineOptions) {
    this.#canvas = options.canvas;
    this.#overlayRoot = options.overlayRoot;
    this.#altimeter = options.altimeter;
    this.#quality = options.quality;
    this.#tileUrl = options.tileUrl;
    this.#listeners = options.listeners;
    this.#source = options.source;

    // lève une erreur si aucun contexte WebGL2 n'est disponible : la machine l'attrape
    this.#renderer = new WebGLRenderer({
      canvas: this.#canvas,
      antialias: false, // l'EDL fait le travail de lisibilité
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.#quality.maxPixelRatio));
    this.#renderer.setClearColor(new Color(0x0a0a0f), 1);
    this.#scene.add(this.#points);

    this.#controls = new MapControls(this.#camera, this.#canvas);
    this.#controls.minDistance = POSE_LIMITS.distance.min;
    this.#controls.maxDistance = POSE_LIMITS.distance.max;
    this.#controls.groundProbe = (x: number, z: number) => this.#groundAt(x, z);
    this.#controls.onUserInput = () => { this.#endOrbit(); this.#endFollow(); };
    this.#controls.onAutoRotateEnd = () => this.#listeners.onOrbitEnded();

    this.#edl = new EyeDomeLighting(this.#renderer);
    this.#edl.strength = EDL_STRENGTH;
    this.#materials.set('uScale', this.#quality.pointSize);

    this.#loader = new TileLoader({
      luts: { mnt: mntLut, mns: mnsLut },
      workerCount: this.#quality.workers,
      maxConcurrent: this.#quality.maxConcurrent,
    });
    this.#tree = new TileTree({ scene: this.#points, materials: this.#materials, loader: this.#loader });

    const { signal } = this.#teardown;
    this.#canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      cancelAnimationFrame(this.#raf);
      this.#listeners.onContextLost();
    }, { signal });
    this.#canvas.addEventListener('webglcontextrestored', () => {
      this.#tree.reset();
      this.#wake();
      this.#loop();
      this.#listeners.onContextRestored();
    }, { signal });

    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(this.#canvas);

    this.#resize();
    this.setPose(options.pose, { sharpen: options.sharpStart });
    if (options.orbitStart) this.#orbit(1);
    this.#loop();
  }

  /* ------------------------------------------------------------ commandes -- */

  /** Change le contenu des tuiles (campagne, surface, habillage). */
  setSource(source: SceneSource): void {
    if (source.key === this.#source.key) return;
    this.#source = source;
    this.#tree.reset();
    this.#wake();
  }

  /**
   * Place la caméra. Avec `sharpen`, la distance est ramenée au besoin à celle
   * où le lieu visé s'affiche à la résolution native du relief.
   */
  setPose(pose: Pose, { sharpen = false } = {}): void {
    const distance = sharpen ? Math.min(pose.distance, this.#nativeDistance()) : pose.distance;
    this.#controls.autoRotate = 0;
    this.#controls.goTo(pose.x - T.ORIGIN.x, -(pose.y - T.ORIGIN.y), distance, {
      azimuth: -pose.azimuth * DEG,
      polar: pose.tilt * DEG,
    });
    this.#wake();
  }

  getPose(): Pose {
    const { target, distance, azimuth, polar } = this.#controls;
    return {
      x: target.x + T.ORIGIN.x,
      y: -target.z + T.ORIGIN.y,
      distance,
      azimuth: (((-azimuth / DEG) % 360) + 360) % 360,
      tilt: polar / DEG,
    };
  }

  /** Amène la caméra à `height` mètres au-dessus d'un lieu, en orbite si demandé. */
  flyOver({ x, y, height, orbit, azimuth, turns }: Flyover): void {
    this.setPose({
      x, y,
      distance: height / Math.cos(FLYOVER_TILT * DEG),
      azimuth: azimuth ?? this.getPose().azimuth,
      tilt: FLYOVER_TILT,
    });
    if (orbit) this.#orbit(turns ?? Infinity);
    // la destination est connue : on l'annonce sans attendre la fin de l'orbite
    this.#unsettled = false;
    this.#listeners.onViewSettled(this.getPose());
  }

  stopOrbit(): void {
    this.#endOrbit();
  }

  /**
   * Installe la caméra au poste de pilotage d'un mobile et l'y maintient ; `null`
   * la libère. Chaque nouvelle position connue du mobile se donne par un nouvel appel.
   */
  follow(target: FollowTarget | null): void {
    this.#follow = target;
    if (target) this.#controls.autoRotate = 0;
    this.#wake();
  }

  /** Avions à dessiner en volume, à leur altitude et dans leur assiette. */
  setAircraftModels(models: readonly AircraftModel[]): void {
    if (models.length > 0) this.#aircraft ??= new AircraftLayer(this.#renderer);
    this.#aircraft?.setModels(models);
    this.#wake();
  }

  setAircraftActive(id: string | null): void {
    this.#aircraft?.setActive(id);
    this.#wake();
  }

  /** Déclare un calque en superposition ; sans effet s'il existe déjà. */
  addOverlay<F extends OverlayFeature>(name: string, style: OverlayStyle<F>): void {
    if (this.#overlays.has(name)) return;
    this.#overlays.set(name, new OverlayLayer(this.#overlayRoot, style,
      (id) => this.#listeners.onOverlayPicked(name, id)));
  }

  setOverlayFeatures(name: string, features: readonly OverlayFeature[]): void {
    this.#overlays.get(name)?.setFeatures(features);
    this.#wake();
  }

  setOverlayActive(name: string, id: string | null): void {
    this.#overlays.get(name)?.setActive(id);
    this.#wake();
  }

  /** Scans 3D à dessiner par-dessus le relief ; le moteur de splats n'est chargé qu'au premier. */
  /**
   * Prépare des scans avant qu'on les demande : leur fichier (plusieurs mégaoctets)
   * et le moteur de splats sont téléchargés en tâche de fond, une fois le relief
   * de la vue arrivé — jamais en concurrence avec lui. Le jour où le visiteur
   * touche le marqueur, tout vient du cache du navigateur.
   */
  preloadScans(scans: readonly Scan[]): void {
    this.#preload = scans.flatMap((scan) => (scan.splats ? [scan.splats] : []));
    this.#wake();
  }

  #prewarm(): void {
    const urls = this.#preload;
    this.#preload = [];
    // le visiteur a demandé d'économiser ses données, ou sa liaison est trop lente : on ne télécharge rien d'avance
    const link = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (link?.saveData || link?.effectiveType === '2g' || link?.effectiveType === 'slow-2g') return;
    void import('./SplatLayer.ts').catch(() => {});
    for (const url of urls) {
      // priorité basse : la navigation et les tuiles passent d'abord ; le corps est lu pour que le cache le garde
      void fetch(url, { priority: 'low' } as RequestInit).then((response) => response.blob()).catch(() => {});
    }
  }

  setScans(scans: readonly Scan[]): void {
    this.#scans = scans;
    // annoncé tout de suite : le moteur de splats lui-même met un instant à arriver
    if (!this.#splats && scans[0]) this.#listeners.onScanProgress({ id: scans[0].id, phase: 'loading', fraction: 0 });
    if (this.#splats) {
      this.#splats.setScans(scans);
      this.#wake();
    } else if (scans.length > 0) {
      void this.#loadSplats();
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#splats?.dispose();
    this.#aircraft?.dispose();
    cancelAnimationFrame(this.#raf);
    this.#teardown.abort();
    this.#resizeObserver.disconnect();
    this.#controls.dispose();
    this.#tree.reset();
    this.#loader.dispose();
    for (const overlay of this.#overlays.values()) overlay.dispose();
    this.#overlays.clear();
    this.#materials.dispose();
    this.#edl.dispose();
    this.#renderer.dispose();
  }

  /* -------------------------------------------------------------- interne -- */

  /**
   * Distance de visée sous laquelle le quadtree descend à son dernier niveau au
   * point visé : le relief y est alors dessiné à sa résolution native (50 cm
   * pour le LiDAR 2021-2022). Plus loin, afficher cette précision demanderait
   * des dizaines de millions de points pour un détail plus fin qu'un pixel.
   */
  #nativeDistance(): number {
    const pixelsPerMeter = (this.#size.height * 0.5) / Math.tan((this.#camera.fov * DEG) / 2);
    const coarserSpacing = T.tileSpacing(this.#source.maxLevel - 1);
    // marge de 10 % : le niveau le plus fin est atteint franchement, pas à la limite
    return (coarserSpacing * pixelsPerMeter / this.#quality.screenSpaceError) * 0.9;
  }

  /** Met la caméra en orbite autour du point visé, pour `turns` tours ; un nombre négatif tourne dans l'autre sens. */
  #orbit(turns: number): void {
    this.#controls.autoRotateBudget = Math.abs(turns) * 2 * Math.PI;
    this.#controls.autoRotate = turns < 0 ? -ORBIT_SPEED : ORBIT_SPEED;
  }

  async #loadSplats(): Promise<void> {
    const { SplatLayer } = await import('./SplatLayer.ts');
    if (this.#disposed || this.#splats) return;
    this.#splats = new SplatLayer(this.#renderer, () => this.#wake(), (progress) => this.#listeners.onScanProgress(progress));
    this.#splats.setScans(this.#scans);
    this.#wake();
  }

  /** Force quelques images : quelque chose a changé hors de la navigation. */
  #wake(): void {
    this.#idleFrames = 0;
  }

  #endFollow(): void {
    if (!this.#follow) return;
    this.#follow = null;
    this.#listeners.onFollowEnded();
  }

  /** Replace la caméra sur le mobile suivi, à sa position de l'instant. */
  #trackFollow(): void {
    const target = this.#follow;
    if (!target) return;
    const dt = Math.min(target.horizon, Math.max(0, (Date.now() - target.at) / 1000));
    const position = {
      x: target.x + target.vx * dt,
      y: target.y + target.vy * dt,
      altitude: target.altitude === null ? null : target.altitude + target.vz * dt,
    };
    const pose = cockpitPose(position, target.track, this.#controls.target.y);
    this.#controls.goTo(pose.x - T.ORIGIN.x, -(pose.y - T.ORIGIN.y), pose.distance, {
      azimuth: -pose.azimuth * DEG,
      polar: pose.tilt * DEG,
    });
  }

  #endOrbit(): void {
    if (this.#controls.autoRotate === 0) return;
    this.#controls.autoRotate = 0;
    this.#listeners.onOrbitEnded();
  }

  /** Altitude rendue du sol sous un point monde, lue dans les tuiles chargées. */
  #groundAt(worldX: number, worldZ: number): number | null {
    const mapX = worldX + T.ORIGIN.x;
    const mapY = -worldZ + T.ORIGIN.y;
    for (let level = T.MAX_LEVEL; level >= 0; level--) {
      const size = T.tileSize(level);
      const i = Math.floor((mapX - T.ROOT_X0) / size);
      const j = Math.floor((mapY - T.ROOT_Y0) / size);
      const tile = this.#tree.tiles.get(`${level}/${i}/${j}`);
      if (tile && tile.state === 'ready') return (tile.minY + tile.maxY) / 2;
    }
    return null;
  }

  #resize(): void {
    const width = this.#canvas.clientWidth || window.innerWidth;
    const height = this.#canvas.clientHeight || window.innerHeight;
    this.#size = { width, height };
    this.#renderer.setSize(width, height, false);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
    const ratio = this.#renderer.getPixelRatio();
    this.#edl.setSize(width, height, ratio);
    this.#materials.set('uViewport', height * ratio);
    this.#wake();
  }

  /** Message de chargement d'une tuile, construit à la demande du quadtree. */
  #describe(tile: TileLike) {
    const source = this.#source;
    const sup = T.levelSuper(tile.level, this.#quality.superSample);
    const address = { level: tile.level, i: tile.i, j: tile.j };
    return {
      px: T.REQUEST_PX,
      cpx: T.REQUEST_PX * sup,
      sup,
      spacing: T.tileSpacing(tile.level),
      elevUrl: this.#tileUrl({ ...address, service: source.elevationService, px: T.REQUEST_PX, format: 'png' }),
      // au niveau le plus fin la couleur est demandée à sa résolution native (25 cm)
      colorUrl: source.colorService
        ? this.#tileUrl({ ...address, service: source.colorService, px: T.REQUEST_PX * sup, format: source.colorFormat })
        : null,
      lutKey: source.lutKey,
      colorMode: source.colorMode,
      stride: 1,
      smooth: SMOOTHING_PASSES,
      generation: this.#tree.generation,
    };
  }

  /**
   * Projette un point Lambert à l'écran. Un point donné avec son altitude est en
   * l'air, là où il est ; sinon il est posé sur le relief, que `refine` lit précisément.
   */
  #project = (x: number, y: number, refine: boolean, altitude?: number): { sx: number; sy: number; range: number } | null => {
    const worldX = x - T.ORIGIN.x;
    const worldZ = -(y - T.ORIGIN.y);
    const ground = altitude === undefined && refine ? this.#groundAt(worldX, worldZ) : null;
    const p = this.#probe.set(worldX, altitude ?? ground ?? this.#controls.target.y, worldZ);
    const range = p.distanceTo(this.#camera.position);
    p.project(this.#camera);
    // marge généreuse au passage grossier : l'altitude réelle peut déplacer le point
    const margin = refine ? 1 : 1.35;
    if (p.z < -1 || p.z > 1 || Math.abs(p.x) > margin || Math.abs(p.y) > margin) return null;
    return {
      sx: (p.x * 0.5 + 0.5) * this.#size.width,
      sy: (-p.y * 0.5 + 0.5) * this.#size.height,
      range,
    };
  };

  #loop(): void {
    this.#raf = requestAnimationFrame(() => this.#loop());
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.#last) / 1000);
    this.#last = now;

    this.#trackFollow();
    const moved = this.#controls.update(dt);
    if (moved) {
      this.#movedAt = now;
      this.#unsettled = true;
    }

    // Rendu à la demande : une vue immobile dont toutes les tuiles sont arrivées
    // ne coûte plus rien — ni GPU, ni batterie.
    // des maquettes d'avions à l'écran avancent et s'inclinent à chaque image
    const busy = moved || this.#loader.pending > 0 || (this.#aircraft?.count ?? 0) > 0;
    this.#idleFrames = busy ? 0 : this.#idleFrames + 1;
    if (this.#idleFrames <= IDLE_FRAMES) this.#render();
    // la vue est immobile mais des entités bougent (avions) : seules leurs étiquettes sont replacées
    else if (this.#hasMovingOverlay()) this.#updateOverlays();

    if (this.#unsettled && !moved && this.#controls.autoRotate === 0
        && now - this.#movedAt > SETTLE_DELAY_MS) {
      this.#unsettled = false;
      this.#listeners.onViewSettled(this.getPose());
    }
    // le relief de la vue est là : c'est le moment de faire venir ce qui a été demandé d'avance
    if (this.#preload.length > 0 && this.#ready && this.#loader.pending === 0) this.#prewarm();
    this.#reportActivity();
  }

  #render(): void {
    // plans de coupe adaptés à l'altitude : indispensable sur 250 km d'étendue
    const distance = this.#controls.distance;
    this.#camera.near = Math.max(1, distance * 0.008);
    this.#camera.far = Math.max(distance * 6, 60000);
    this.#camera.updateProjectionMatrix();
    this.#camera.updateMatrixWorld();

    this.#tree.update(this.#camera, {
      viewportHeight: this.#size.height,
      sse: this.#quality.screenSpaceError,
      exaggeration: 1,
      maxPoints: this.#quality.maxPoints,
      maxLevel: this.#source.maxLevel,
      cacheSize: this.#quality.cacheTiles,
      cachePoints: this.#quality.cachePoints,
      describe: (tile: TileLike) => this.#describe(tile),
    });
    this.#edl.render(this.#scene, this.#camera);
    this.#splats?.render(this.#camera);
    this.#aircraft?.render(this.#camera, this.#size.height, Date.now(),
      (worldX, worldZ) => this.#groundAt(worldX, worldZ) ?? this.#controls.target.y);

    this.#updateOverlays();
    this.#updateAltimeter();

    if (!this.#ready && this.#tree.stats.points > 0) {
      this.#ready = true;
      this.#listeners.onReady();
    }
  }

  #hasMovingOverlay(): boolean {
    for (const overlay of this.#overlays.values()) if (overlay.animated) return true;
    return false;
  }

  /** Replace les entités à l'écran : du DOM seulement, sans redessiner le relief. */
  #updateOverlays(): void {
    const frame = {
      project: this.#project,
      distance: this.#controls.distance,
      azimuth: this.getPose().azimuth,
      now: Date.now(),
    };
    for (const overlay of this.#overlays.values()) overlay.update(frame);
  }

  #updateAltimeter(): void {
    const camera = METRES.format(this.#camera.position.y);
    const ground = METRES.format(this.#controls.target.y);
    // le DOM n'est touché que lorsque la valeur affichée change
    if (this.#altimeter.camera.textContent !== camera) this.#altimeter.camera.textContent = camera;
    if (this.#altimeter.ground.textContent !== ground) this.#altimeter.ground.textContent = ground;
  }

  /** Ne signale l'activité qu'aux changements d'état, jamais à chaque image. */
  #reportActivity(): void {
    const loading = this.#loader.pending > 0;
    if (loading === this.#activity.loading) return;
    this.#activity = { loading, points: this.#tree.stats.points };
    this.#listeners.onActivity(this.#activity);
  }
}
