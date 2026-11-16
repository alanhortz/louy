/**
 * Navigation à pied dans un lieu filmé : la caméra est à hauteur d'yeux, posée
 * sur le sol déduit des splats, et le visiteur regarde et avance comme dans une
 * vue de rue.
 *
 *   glisser                    : tourner la tête
 *   toucher le sol             : s'y rendre
 *   flèches haut/bas, Z/S      : avancer, reculer      flèches gauche/droite : tourner
 *   Q/D                        : pas de côté           Maj : presser le pas
 *   molette / pincement        : avancer, reculer
 *
 * À la souris, un repère posé sur le sol suit le pointeur : il montre où un clic mènerait.
 * Une fois le clic donné, il reste sur la destination jusqu'à ce qu'on y soit. Au doigt,
 * il n'y a pas de pointeur à suivre, donc pas de repère.
 *
 * Les touches sont lues par leur position sur le clavier : Z, Q, S, D sur un
 * clavier belge sont W, A, S, D sur un clavier américain.
 */

import {
  BufferGeometry, DoubleSide, Euler, Float32BufferAttribute, Group, MathUtils, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, RingGeometry, Scene as ThreeScene, Vector3,
  type PerspectiveCamera, type WebGLRenderer,
} from 'three';
import { EYE_HEIGHT, canStep, castGround, groundAt, type WalkGround } from '../domain/walk.ts';

const WALK_SPEED = 5;
const RUN_SPEED = 14;
const TURN_SPEED = 1.3;
const LOOK_SENSITIVITY = 0.0035;
const MAX_PITCH = 80 * MathUtils.DEG2RAD;
/** Un pointeur qui a bougé de moins que cela, relâché vite, a touché et non glissé. */
const TAP_SLOP_PX = 6;
const TAP_MS = 450;
/** Portée du toucher : au-delà, on ne s'y rend pas d'une traite. */
const TAP_REACH = 250;
/** On entre dans la visite à cette distance du point visé, en mètres, sur la ligne qui mène de la caméra à lui. */
const ENTRY_DISTANCE = 10;
/** Repère au sol : sa couleur, son rayon selon l'éloignement (il doit rester lisible de loin sans devenir énorme de près). */
const POINTER_COLOUR = 0x00d4ff;
const POINTER_RADIUS = { perMetre: 0.035, min: 0.45, max: 4 };
/** Hauteur du repère au-dessus du sol déduit : assez pour ne pas se noyer dans les splats du sol. */
const POINTER_LIFT = 0.08;
/** Silence de la molette ou du pincement après lequel ces gestes redeviennent des ordres de marche, en millisecondes. */
const ZOOM_QUIET_MS = 400;
/** Durée de la descente jusqu'à hauteur d'yeux. */
const ARRIVAL_S = 1.8;
const FORWARD_KEYS = ['KeyW', 'ArrowUp'];
const BACK_KEYS = ['KeyS', 'ArrowDown'];
const KEYS = new Set([...FORWARD_KEYS, ...BACK_KEYS, 'KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

export class WalkControls {
  readonly #camera: PerspectiveCamera;
  readonly #dom: HTMLElement;
  readonly #ground: WalkGround;
  readonly #listeners = new AbortController();
  readonly #keys = new Set<string>();
  readonly #pointers = new Map<number, { x: number; y: number }>();
  readonly #position = new Vector3();
  readonly #from = { position: new Vector3(), quaternion: new Quaternion() };
  readonly #look = new Quaternion();
  readonly #euler = new Euler(0, 0, 0, 'YXZ');

  #yaw: number;
  #pitch = 0;
  /** Altitude des yeux, lissée : le sol déduit des splats n'est pas un sol d'architecte. */
  #eye: number;
  /** Lieu désigné d'un toucher, vers lequel le promeneur marche seul. */
  #goal: { x: number; z: number } | null = null;
  /** Mètres encore à parcourir vers l'avant (molette, pincement) ; négatif pour reculer. */
  #advance = 0;
  #arrival = 0;
  /** Dernier geste de zoom ignoré à l'entrée ; `null` une fois que le zoom s'est tu. */
  #zoomHeardAt: number | null = performance.now();
  #press: { x: number; y: number; at: number; moved: number } | null = null;
  #pinch = 0;
  #changed = true;
  /** Point du sol que survole la souris ; `null` au doigt, hors du lieu, ou quand on tourne la tête. */
  #hover: { x: number; z: number } | null = null;
  readonly #pointerScene = new ThreeScene();
  readonly #pointer = new Group();
  readonly #stem = new Mesh(
    new PlaneGeometry(0.07, 1.8),
    new MeshBasicMaterial({ color: POINTER_COLOUR, transparent: true, opacity: 0.75, side: DoubleSide, depthTest: false }),
  );

  constructor(camera: PerspectiveCamera, dom: HTMLElement, ground: WalkGround, start: { x: number; z: number }, yaw: number) {
    this.#camera = camera;
    this.#dom = dom;
    this.#ground = ground;
    this.#yaw = yaw;
    this.#position.set(start.x, 0, start.z);
    this.#eye = (groundAt(ground, start.x, start.z) ?? 0) + EYE_HEIGHT;
    // La visite commence dix mètres avant le point visé, sur la ligne de visée : de plus loin, la caméra
    // y est amenée d'un coup ; déjà plus près, elle part d'où elle est. Puis elle descend à hauteur d'yeux.
    const aim = new Vector3(start.x, this.#eye - EYE_HEIGHT, start.z);
    const back = camera.position.clone().sub(aim);
    if (back.length() > ENTRY_DISTANCE) back.setLength(ENTRY_DISTANCE);
    this.#from.position.copy(aim).add(back);
    this.#from.quaternion.copy(camera.quaternion);
    this.#bind();
    this.#buildPointer();
  }

  /** Un anneau et son centre, à plat sur le sol. */
  #buildPointer(): void {
    const material = (opacity: number) =>
      new MeshBasicMaterial({ color: POINTER_COLOUR, transparent: true, opacity, side: DoubleSide, depthTest: false });
    const ring = new Mesh(new RingGeometry(0.78, 1, 48), material(0.95));
    const disc = new Mesh(new RingGeometry(0, 0.78, 48), material(0.22));
    const centre = new Mesh(new RingGeometry(0, 0.16, 24), material(0.95));
    const flat = new Group();
    for (const mesh of [disc, ring, centre]) flat.add(mesh);
    flat.rotation.x = -Math.PI / 2;
    // de loin, un anneau à plat se réduit à un trait : une tige dressée en son centre le signale encore
    this.#stem.position.y = 0.9;
    // un petit drapeau en haut de la tige : un triangle, qui tourne avec elle pour rester de face
    const flag = new BufferGeometry();
    flag.setAttribute('position', new Float32BufferAttribute([0.035, 0.9, 0, 0.035, 0.46, 0, 0.62, 0.68, 0], 3));
    this.#stem.add(new Mesh(flag, material(0.95)));
    this.#pointer.add(flat, this.#stem);
    this.#pointer.visible = false;
    this.#pointerScene.add(this.#pointer);
  }

  /** Dessine le repère au sol par-dessus le lieu ; à appeler après lui. */
  renderPointer(renderer: WebGLRenderer): void {
    // la destination d'un clic prime sur le survol ; rien pendant l'entrée dans la visite
    const at = this.#arrival < 1 ? null : this.#goal ?? this.#hover;
    const ground = at && groundAt(this.#ground, at.x, at.z);
    this.#pointer.visible = at !== null && ground !== null && ground !== undefined;
    if (!this.#pointer.visible || !at) return;
    this.#pointer.position.set(at.x, (ground as number) + POINTER_LIFT, at.z);
    const range = this.#pointer.position.distanceTo(this.#camera.position);
    this.#pointer.scale.setScalar(MathUtils.clamp(range * POINTER_RADIUS.perMetre, POINTER_RADIUS.min, POINTER_RADIUS.max));
    // la tige fait toujours face au promeneur
    this.#stem.rotation.y = Math.atan2(this.#camera.position.x - at.x, this.#camera.position.z - at.z);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.render(this.#pointerScene, this.#camera);
    renderer.autoClear = autoClear;
  }

  /** Le sol que vise un pixel de l'écran, à portée de clic ; `null` s'il n'y en a pas. */
  #groundUnder(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.#dom.getBoundingClientRect();
    const direction = new Vector3(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
      0.5,
    ).unproject(this.#camera).sub(this.#camera.position).normalize();
    return castGround(this.#ground, this.#camera.position, direction, TAP_REACH);
  }

  get x(): number { return this.#position.x; }
  get z(): number { return this.#position.z; }
  get yaw(): number { return this.#yaw; }
  /** Avancement de l'entrée, de 0 (dix mètres avant le point visé) à 1 (à hauteur d'yeux). */
  get arrival(): number { return this.#arrival; }
  /** Altitude du sol sous le promeneur. */
  get groundY(): number { return this.#eye - EYE_HEIGHT; }

  dispose(): void {
    this.#listeners.abort();
    this.#pointer.traverse((node) => {
      const mesh = node as Mesh;
      mesh.geometry?.dispose();
      (mesh.material as MeshBasicMaterial | undefined)?.dispose();
    });
  }

  #bind(): void {
    const { signal } = this.#listeners;
    const dom = this.#dom;
    dom.addEventListener('pointerdown', (event) => {
      dom.setPointerCapture(event.pointerId);
      this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.#press = this.#pointers.size === 1 ? { x: event.clientX, y: event.clientY, at: performance.now(), moved: 0 } : null;
      if (this.#pointers.size === 2) this.#pinch = this.#pinchDistance();
      // reprendre la main interrompt la marche vers le lieu touché
      this.#goal = null;
    }, { signal });
    dom.addEventListener('pointermove', (event) => {
      const last = this.#pointers.get(event.pointerId);
      if (!last) {
        // la souris survole le lieu sans rien presser : le repère la suit sur le sol
        if (event.pointerType === 'mouse') { this.#hover = this.#groundUnder(event.clientX, event.clientY); this.#changed = true; }
        return;
      }
      // on tourne la tête : le repère s'efface le temps du geste
      this.#hover = null;
      const dx = event.clientX - last.x, dy = event.clientY - last.y;
      this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.#pointers.size === 2) {
        const distance = this.#pinchDistance();
        if (this.#pinch > 0 && !this.#stillZooming()) this.#advance += Math.log(distance / this.#pinch) * 30;
        this.#pinch = distance;
        return;
      }
      if (this.#press) this.#press.moved += Math.abs(dx) + Math.abs(dy);
      // on saisit le décor : le tirer vers la droite fait tourner la tête à gauche
      this.#yaw += dx * LOOK_SENSITIVITY;
      this.#pitch = MathUtils.clamp(this.#pitch + dy * LOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
      this.#changed = true;
    }, { signal });
    const release = (event: PointerEvent) => {
      if (!this.#pointers.delete(event.pointerId)) return;
      const press = this.#press;
      this.#press = null;
      if (event.type === 'pointerup' && press && press.moved < TAP_SLOP_PX && performance.now() - press.at < TAP_MS) {
        this.#walkTo(event.clientX, event.clientY);
      }
    };
    dom.addEventListener('pointerup', release, { signal });
    dom.addEventListener('pointerleave', () => { this.#hover = null; this.#changed = true; }, { signal });
    dom.addEventListener('pointercancel', release, { signal });
    (dom.parentElement ?? dom).addEventListener('wheel', (event) => {
      event.preventDefault();
      if (this.#stillZooming()) return;
      this.#goal = null;
      this.#advance -= Math.sign(event.deltaY) * 3;
    }, { passive: false, signal });
    window.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
      if (!KEYS.has(event.code)) return;
      // les flèches ne font pas défiler la page
      if (event.code.startsWith('Arrow')) event.preventDefault();
      this.#keys.add(event.code);
      this.#goal = null;
    }, { signal });
    window.addEventListener('keyup', (event) => this.#keys.delete(event.code), { signal });
    window.addEventListener('blur', () => this.#keys.clear(), { signal });
  }

  /**
   * Le geste de zoom qui a fait entrer dans la visite n'est pas un ordre de marche : tant qu'il dure
   * — pendant la descente, puis jusqu'à ce que la molette ou les doigts se soient tus un instant —
   * il est ignoré. Sans cela, on partirait en avant sur l'élan du zoom.
   */
  #stillZooming(): boolean {
    const now = performance.now();
    const carried = this.#arrival < 1 || (this.#zoomHeardAt !== null && now - this.#zoomHeardAt < ZOOM_QUIET_MS);
    this.#zoomHeardAt = carried ? now : null;
    return carried;
  }

  #pinchDistance(): number {
    const [a, b] = [...this.#pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  /** Le visiteur a touché l'écran : s'il a touché le sol, le promeneur s'y rend. */
  #walkTo(clientX: number, clientY: number): void {
    this.#goal = this.#groundUnder(clientX, clientY);
  }

  /** Avance d'un pas si le sol le permet ; à défaut, glisse le long de l'obstacle. */
  #move(dx: number, dz: number): boolean {
    const from = { x: this.#position.x, z: this.#position.z };
    for (const [sx, sz] of [[dx, dz], [dx, 0], [0, dz]] as const) {
      if (sx === 0 && sz === 0) continue;
      const to = { x: from.x + sx, z: from.z + sz };
      if (!canStep(this.#ground, from, to)) continue;
      this.#position.x = to.x;
      this.#position.z = to.z;
      return true;
    }
    return false;
  }

  /** Avance la marche d'un pas de temps et place la caméra ; rend `true` si la vue a changé. */
  update(dt: number): boolean {
    let moved = this.#changed;
    this.#changed = false;
    const keys = this.#keys;
    const pressed = (codes: readonly string[]) => codes.some((code) => keys.has(code));
    const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;

    if (keys.has('ArrowLeft')) { this.#yaw += TURN_SPEED * dt; moved = true; }
    if (keys.has('ArrowRight')) { this.#yaw -= TURN_SPEED * dt; moved = true; }

    // devant soi : −z tourné du cap ; à sa droite : +x tourné du cap
    const sin = Math.sin(this.#yaw), cos = Math.cos(this.#yaw);
    let forward = (pressed(FORWARD_KEYS) ? 1 : 0) - (pressed(BACK_KEYS) ? 1 : 0);
    const side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let stride = speed * dt;
    if (forward === 0 && side === 0 && Math.abs(this.#advance) > 0.01) {
      // la molette se dépense en douceur, pas d'un bond
      const spent = MathUtils.clamp(this.#advance, -RUN_SPEED * dt, RUN_SPEED * dt);
      this.#advance -= spent;
      forward = Math.sign(spent);
      stride = Math.abs(spent);
    } else if (forward !== 0 || side !== 0) {
      this.#advance = 0;
    }
    if (forward !== 0 || side !== 0) {
      const norm = Math.hypot(forward, side);
      const dx = ((-sin * forward + cos * side) / norm) * stride;
      const dz = ((-cos * forward - sin * side) / norm) * stride;
      if (this.#move(dx, dz)) moved = true;
      else this.#advance = 0;
    } else if (this.#goal) {
      const dx = this.#goal.x - this.#position.x, dz = this.#goal.z - this.#position.z;
      const left = Math.hypot(dx, dz);
      const step = Math.min(left, RUN_SPEED * dt);
      if (left < 0.3 || !this.#move((dx / left) * step, (dz / left) * step)) this.#goal = null;
      moved = true;
    }

    const ground = groundAt(this.#ground, this.#position.x, this.#position.z);
    if (ground !== null) {
      const target = ground + EYE_HEIGHT;
      if (Math.abs(target - this.#eye) > 0.005) {
        this.#eye += (target - this.#eye) * Math.min(1, 6 * dt);
        moved = true;
      }
    }
    this.#position.y = this.#eye;
    this.#look.setFromEuler(this.#euler.set(this.#pitch, this.#yaw, 0));

    if (this.#arrival < 1) {
      this.#arrival = Math.min(1, this.#arrival + dt / ARRIVAL_S);
      const eased = MathUtils.smootherstep(this.#arrival, 0, 1);
      this.#camera.position.lerpVectors(this.#from.position, this.#position, eased);
      this.#camera.quaternion.slerpQuaternions(this.#from.quaternion, this.#look, eased);
      return true;
    }
    this.#camera.position.copy(this.#position);
    this.#camera.quaternion.copy(this.#look);
    return moved;
  }
}
