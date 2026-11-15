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
 * Les touches sont lues par leur position sur le clavier : Z, Q, S, D sur un
 * clavier belge sont W, A, S, D sur un clavier américain.
 */

import { Euler, MathUtils, Quaternion, Vector3, type PerspectiveCamera } from 'three';
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
/**
 * L'arrivée est un atterrissage : la caméra descend vers le point où se poser en le regardant,
 * redresse le regard vers l'horizon à l'approche du sol, puis touche terre — les genoux
 * plient un peu, et se redressent.
 * Durée de la descente, en secondes : d'autant plus longue que l'on vient de loin, entre deux bornes.
 */
const ARRIVAL_MIN_S = 2.4;
const ARRIVAL_MAX_S = 4;
const ARRIVAL_S_PER_METRE = 1 / 45;
/** Part de la descente après laquelle le regard commence à se redresser. */
const FLARE_FROM = 0.4;
/** Toucher du sol : enfoncement, en mètres, et durée de l'amorti, en secondes. */
const TOUCHDOWN_DIP = 0.22;
const TOUCHDOWN_S = 0.9;
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
  #arrivalSeconds = ARRIVAL_MIN_S;
  /** Secondes écoulées depuis le toucher du sol ; l'amorti s'éteint de lui-même. */
  #landed = 0;
  #press: { x: number; y: number; at: number; moved: number } | null = null;
  #pinch = 0;
  #changed = true;

  constructor(camera: PerspectiveCamera, dom: HTMLElement, ground: WalkGround, start: { x: number; z: number }, yaw: number) {
    this.#camera = camera;
    this.#dom = dom;
    this.#ground = ground;
    this.#yaw = yaw;
    this.#position.set(start.x, 0, start.z);
    this.#eye = (groundAt(ground, start.x, start.z) ?? 0) + EYE_HEIGHT;
    // la caméra part d'où elle est, au-dessus de la carte, et descend se poser
    this.#from.position.copy(camera.position);
    this.#from.quaternion.copy(camera.quaternion);
    const travel = Math.hypot(camera.position.x - start.x, camera.position.y - this.#eye, camera.position.z - start.z);
    this.#arrivalSeconds = MathUtils.clamp(ARRIVAL_MIN_S + travel * ARRIVAL_S_PER_METRE, ARRIVAL_MIN_S, ARRIVAL_MAX_S);
    this.#bind();
  }

  get x(): number { return this.#position.x; }
  get z(): number { return this.#position.z; }
  get yaw(): number { return this.#yaw; }
  /** Avancement de l'atterrissage, de 0 (on quitte la carte) à 1 (on a touché le sol). */
  get arrival(): number { return this.#arrival; }
  /** Altitude du sol sous le promeneur. */
  get groundY(): number { return this.#eye - EYE_HEIGHT; }

  dispose(): void {
    this.#listeners.abort();
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
      if (!last) return;
      const dx = event.clientX - last.x, dy = event.clientY - last.y;
      this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.#pointers.size === 2) {
        const distance = this.#pinchDistance();
        if (this.#pinch > 0) this.#advance += Math.log(distance / this.#pinch) * 30;
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
    dom.addEventListener('pointercancel', release, { signal });
    (dom.parentElement ?? dom).addEventListener('wheel', (event) => {
      event.preventDefault();
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

  #pinchDistance(): number {
    const [a, b] = [...this.#pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  /** Le visiteur a touché l'écran : s'il a touché le sol, le promeneur s'y rend. */
  #walkTo(clientX: number, clientY: number): void {
    const rect = this.#dom.getBoundingClientRect();
    const direction = new Vector3(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
      0.5,
    ).unproject(this.#camera).sub(this.#camera.position).normalize();
    this.#goal = castGround(this.#ground, this.#camera.position, direction, TAP_REACH);
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
      this.#arrival = Math.min(1, this.#arrival + dt / this.#arrivalSeconds);
      const e = this.#arrival;
      // on avance vers le point d'un mouvement souple ; on descend vite d'abord, puis de plus en plus doucement
      const along = MathUtils.smootherstep(e, 0, 1);
      const down = 1 - (1 - e) ** 2.4;
      this.#camera.position.set(
        MathUtils.lerp(this.#from.position.x, this.#position.x, along),
        MathUtils.lerp(this.#from.position.y, this.#position.y, down),
        MathUtils.lerp(this.#from.position.z, this.#position.z, along),
      );
      // l'arrondi : le regard reste sur le sol pendant l'approche, puis se relève vers l'horizon
      this.#camera.quaternion.slerpQuaternions(this.#from.quaternion, this.#look, MathUtils.smootherstep(e, FLARE_FROM, 1));
      return true;
    }
    this.#camera.position.copy(this.#position);
    if (this.#landed < TOUCHDOWN_S) {
      // le toucher : un enfoncement qui s'amortit
      this.#landed += dt;
      const t = this.#landed / TOUCHDOWN_S;
      this.#camera.position.y -= TOUCHDOWN_DIP * Math.sin(Math.PI * Math.min(1, t * 1.6)) * (1 - t) ** 2;
      moved = true;
    }
    this.#camera.quaternion.copy(this.#look);
    return moved;
  }
}
