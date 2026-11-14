/**
 * Moteur de la visionneuse d'objet : affiche un scan maillé (glTF) et laisse
 * le visiteur tourner autour. Les bases viennent du viewer de scans du projet
 * point-cloud — lecture glTF, matière aplatie, cadrage sur l'objet — ; le
 * pilotage, lui, appartient à la machine `object`, qui reçoit tout ce que ce
 * moteur observe par ses `ObjectEngineListeners`.
 *
 * Comme le moteur de la carte, il ne connaît ni React ni XState et ne rend une
 * image que lorsque quelque chose a changé.
 */

import {
  Box3, Color, DirectionalLight, DoubleSide, HemisphereLight, MathUtils, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  PerspectiveCamera, Scene as ThreeScene, Sphere, Vector3, WebGLRenderer, type Material, type Object3D, type Texture,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  DEFAULT_OBJECT_POSE, OBJECT_POSE_LIMITS, clampObjectPose, type ObjectGesture, type ObjectPose,
} from '../domain/objectView.ts';

const DEG = Math.PI / 180;
/** Tour automatique : un tour en quarante secondes environ. */
const TURN_SPEED = 9;
/** Délai sans molette après lequel un zoom est tenu pour terminé. */
const WHEEL_SETTLE_MS = 260;

export interface ObjectStats {
  triangles: number;
  /** Rayon de la sphère englobante, dans l'unité du fichier (le mètre pour un scan). */
  radius: number;
}

export interface ObjectEngineListeners {
  onProgress(fraction: number): void;
  onLoaded(stats: ObjectStats): void;
  onFailed(reason: string): void;
  onFirstFrame(): void;
  onGestureStarted(gesture: ObjectGesture): void;
  onGestureEnded(gesture: ObjectGesture, pose: ObjectPose): void;
  onContextLost(): void;
  onContextRestored(): void;
}

export interface ObjectEngineOptions {
  canvas: HTMLCanvasElement;
  url: string;
  autoRotate: boolean;
  listeners: ObjectEngineListeners;
}

/**
 * Un relevé photogrammétrique porte déjà sa lumière dans sa texture : l'éclairer
 * une seconde fois le noircirait. Une matière texturée est donc remplacée par
 * une matière sans éclairage, qui montre la texture telle quelle.
 *
 * Un maillage sans texture, lui, ne serait qu'une silhouette unie : il garde sa
 * couleur (ou celles de ses sommets) et reçoit la lumière de la scène, qui seule
 * en fait lire le volume.
 */
function flatten(root: Object3D): number {
  let triangles = 0;
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const source = ([] as Material[]).concat(mesh.material)[0] as
      (Material & { map?: Texture | null; emissiveMap?: Texture | null; color?: Color }) | undefined;
    // certains exports posent la texture en émission, sur une couleur de base noire : c'est la même image
    const map = source?.map ?? source?.emissiveMap ?? null;
    // sans normales, la lumière n'a pas de prise : le maillage sortirait noir
    if (!map && mesh.geometry.attributes.normal === undefined) mesh.geometry.computeVertexNormals();
    mesh.material = map
      ? new MeshBasicMaterial({ map, side: DoubleSide })
      : new MeshLambertMaterial({
        side: DoubleSide,
        color: source?.color ?? new Color(0xb8c2c8),
        vertexColors: mesh.geometry.attributes.color !== undefined,
      });
    const { index, attributes } = mesh.geometry;
    triangles += (index ? index.count : attributes.position?.count ?? 0) / 3;
  });
  return Math.round(triangles);
}

export class ObjectEngine {
  readonly #canvas: HTMLCanvasElement;
  readonly #listeners: ObjectEngineListeners;
  readonly #renderer: WebGLRenderer;
  readonly #scene = new ThreeScene();
  readonly #camera = new PerspectiveCamera(40, 1, 0.01, 1000);
  readonly #headlight = new DirectionalLight(0xffffff, 2.2);
  readonly #teardown = new AbortController();
  readonly #resizeObserver: ResizeObserver;
  readonly #centre = new Vector3();
  readonly #pointers = new Map<number, { x: number; y: number }>();

  #pose: ObjectPose = { ...DEFAULT_OBJECT_POSE };
  #radius = 1;
  #autoRotate: boolean;
  #gesture: ObjectGesture | null = null;
  #pinch = 0;
  #wheelTimer: ReturnType<typeof setTimeout> | undefined;
  #raf = 0;
  #last = performance.now();
  #dirty = true;
  #loaded = false;
  #shown = false;
  #disposed = false;

  constructor({ canvas, url, autoRotate, listeners }: ObjectEngineOptions) {
    this.#canvas = canvas;
    this.#listeners = listeners;
    this.#autoRotate = autoRotate;

    // lève une erreur si aucun contexte WebGL n'est disponible : l'acteur l'attrape
    this.#renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.setClearColor(0x000000, 0);

    // lumière des maillages sans texture : un ciel doux, et un projecteur qui suit le regard
    this.#scene.add(new HemisphereLight(0xffffff, 0x3a4250, 1.5));
    this.#headlight.position.set(0.4, 0.8, 1);
    this.#camera.add(this.#headlight);
    this.#scene.add(this.#camera);

    const { signal } = this.#teardown;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (event) => this.#down(event), { signal });
    canvas.addEventListener('pointermove', (event) => this.#move(event), { signal });
    canvas.addEventListener('pointerup', (event) => this.#up(event), { signal });
    canvas.addEventListener('pointercancel', (event) => this.#up(event), { signal });
    canvas.addEventListener('wheel', (event) => this.#wheel(event), { passive: false, signal });
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      cancelAnimationFrame(this.#raf);
      this.#listeners.onContextLost();
    }, { signal });
    canvas.addEventListener('webglcontextrestored', () => {
      this.#dirty = true;
      this.#loop();
      this.#listeners.onContextRestored();
    }, { signal });

    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(canvas);
    this.#resize();

    new GLTFLoader().load(
      url,
      (gltf) => {
        if (this.#disposed) return;
        const triangles = flatten(gltf.scene);
        const sphere = new Box3().setFromObject(gltf.scene).getBoundingSphere(new Sphere());
        this.#centre.copy(sphere.center);
        this.#radius = Math.max(sphere.radius, 1e-3);
        this.#scene.add(gltf.scene);
        this.#loaded = true;
        this.#dirty = true;
        this.#listeners.onLoaded({ triangles, radius: this.#radius });
      },
      (event) => { if (event.lengthComputable) this.#listeners.onProgress(event.loaded / event.total); },
      (error) => {
        if (!this.#disposed) this.#listeners.onFailed(error instanceof Error ? error.message : 'fichier illisible');
      },
    );

    this.#loop();
  }

  /* ------------------------------------------------------------ commandes -- */

  resetView(): void {
    this.#pose = { ...DEFAULT_OBJECT_POSE };
    this.#dirty = true;
  }

  setAutoRotate(on: boolean): void {
    this.#autoRotate = on;
    this.#dirty = true;
  }

  getPose(): ObjectPose {
    return clampObjectPose(this.#pose);
  }

  dispose(): void {
    this.#disposed = true;
    cancelAnimationFrame(this.#raf);
    clearTimeout(this.#wheelTimer);
    this.#teardown.abort();
    this.#resizeObserver.disconnect();
    this.#scene.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const material = mesh.material as MeshBasicMaterial | MeshLambertMaterial;
      material.map?.dispose();
      material.dispose();
    });
    this.#renderer.dispose();
  }

  /* --------------------------------------------------------------- gestes -- */

  #begin(gesture: ObjectGesture): void {
    if (this.#gesture === gesture) return;
    if (this.#gesture) this.#end();
    this.#gesture = gesture;
    this.#listeners.onGestureStarted(gesture);
  }

  #end(): void {
    if (!this.#gesture) return;
    const gesture = this.#gesture;
    this.#gesture = null;
    this.#listeners.onGestureEnded(gesture, this.getPose());
  }

  #spread(): number {
    const [a, b] = [...this.#pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  #down(event: PointerEvent): void {
    this.#canvas.setPointerCapture(event.pointerId);
    this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.#pointers.size === 2) {
      this.#pinch = this.#spread();
      this.#begin('zoom');
    } else {
      this.#begin('rotate');
    }
  }

  #move(event: PointerEvent): void {
    const previous = this.#pointers.get(event.pointerId);
    if (!previous) return;
    this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.#pointers.size === 2) {
      const spread = this.#spread();
      if (this.#pinch > 0 && spread > 0) this.#zoomBy(this.#pinch / spread);
      this.#pinch = spread;
      return;
    }
    // l'objet suit le doigt : glisser vers la droite le fait tourner vers la droite
    this.#pose = clampObjectPose({
      ...this.#pose,
      azimuth: this.#pose.azimuth - (event.clientX - previous.x) * 0.4,
      polar: this.#pose.polar - (event.clientY - previous.y) * 0.3,
    });
    this.#dirty = true;
  }

  #up(event: PointerEvent): void {
    if (!this.#pointers.delete(event.pointerId)) return;
    if (this.#pointers.size === 0) this.#end();
    else if (this.#pointers.size === 1) this.#begin('rotate');
  }

  #wheel(event: WheelEvent): void {
    event.preventDefault();
    this.#begin('zoom');
    this.#zoomBy(Math.exp(Math.sign(event.deltaY) * Math.min(0.25, Math.abs(event.deltaY) / 600)));
    // une molette n'a pas de fin : le zoom est tenu pour terminé quand elle se tait
    clearTimeout(this.#wheelTimer);
    this.#wheelTimer = setTimeout(() => { if (this.#gesture === 'zoom' && this.#pointers.size === 0) this.#end(); }, WHEEL_SETTLE_MS);
  }

  #zoomBy(factor: number): void {
    this.#pose = clampObjectPose({ ...this.#pose, distance: this.#pose.distance * factor });
    this.#dirty = true;
  }

  /* -------------------------------------------------------------- interne -- */

  #resize(): void {
    const width = this.#canvas.clientWidth || 1;
    const height = this.#canvas.clientHeight || 1;
    this.#renderer.setSize(width, height, false);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
    this.#dirty = true;
  }

  #loop(): void {
    this.#raf = requestAnimationFrame(() => this.#loop());
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.#last) / 1000);
    this.#last = now;

    // le tour automatique s'efface dès que le visiteur a la main
    if (this.#autoRotate && this.#loaded && !this.#gesture) {
      this.#pose = { ...this.#pose, azimuth: (this.#pose.azimuth + TURN_SPEED * dt) % 360 };
      this.#dirty = true;
    }
    if (!this.#dirty) return;
    this.#dirty = false;

    // la sphère englobante remplit la vue à la distance 1, dans le petit côté de l'écran
    const fov = this.#camera.fov * DEG;
    const fit = this.#radius / Math.sin(Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * this.#camera.aspect)) / 2);
    const distance = fit * MathUtils.clamp(this.#pose.distance, OBJECT_POSE_LIMITS.distance.min, OBJECT_POSE_LIMITS.distance.max);
    const azimuth = this.#pose.azimuth * DEG, polar = this.#pose.polar * DEG;
    this.#camera.position.set(
      this.#centre.x + distance * Math.sin(polar) * Math.sin(azimuth),
      this.#centre.y + distance * Math.cos(polar),
      this.#centre.z + distance * Math.sin(polar) * Math.cos(azimuth),
    );
    this.#camera.near = Math.max(distance - this.#radius * 1.5, this.#radius / 500);
    this.#camera.far = distance + this.#radius * 3;
    this.#camera.updateProjectionMatrix();
    this.#camera.lookAt(this.#centre);
    this.#renderer.render(this.#scene, this.#camera);

    if (this.#loaded && !this.#shown) {
      this.#shown = true;
      this.#listeners.onFirstFrame();
    }
  }
}
