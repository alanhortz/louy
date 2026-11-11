/**
 * Navigation cartographique.
 *
 * Le viewer couvre 250 km de large et se descend jusqu'au demi-metre : une
 * vitesse constante serait inutilisable aux deux bouts. Tous les deplacements
 * sont donc proportionnels a la distance au sol — deplacer la souris d'un
 * centimetre couvre toujours la meme fraction de l'ecran, que l'on survole la
 * Wallonie entiere ou un toit.
 *
 *   glisser gauche / un doigt   : deplacer la carte
 *   glisser droit / Maj         : pivoter et incliner
 *   molette / pincement         : zoomer
 *   deux doigts (tourner, lever): pivoter et incliner
 *   fleches                     : deplacer      +/-  : zoomer
 */

import { MathUtils, Vector3 } from 'three';

const DEG = Math.PI / 180;
const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '=', '-', '_']);

export class MapControls {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;

    this.target = new Vector3(0, 0, 0);
    this.distance = 30000;
    this.azimuth = 0;
    this.polar = 55 * DEG;

    this.minDistance = 12;
    this.maxDistance = 260000;
    this.minPolar = 2 * DEG;
    this.maxPolar = 88 * DEG;
    this.damping = 0.16;

    /** Renseigne l'altitude du sol sous un point, pour caler la cible. */
    this.groundProbe = null;
    /** Orbite automatique autour de la cible, en radians par seconde (0 = arret). */
    this.autoRotate = 0;
    /** Angle restant a parcourir en orbite, en radians ; Infinity = sans fin. */
    this.autoRotateBudget = Infinity;
    /** Appele quand l'orbite a parcouru tout son angle. */
    this.onAutoRotateEnd = () => {};
    /** Appele a chaque geste de l'utilisateur (pointeur, molette, clavier). */
    this.onUserInput = () => {};

    this._d = { pan: new Vector3(), dist: 0, az: 0, pol: 0 };
    this._ptr = new Map();
    this._mode = null;
    this._last = { x: 0, y: 0 };
    this._pinch = 0;
    this._twist = null;
    this._keys = new Set();
    this._listeners = new AbortController();
    this.changed = true;

    this.#bind();
    this.update(0);
  }

  #bind() {
    const d = this.dom;
    const { signal } = this._listeners;
    d.style.touchAction = 'none';
    d.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    d.addEventListener('pointerdown', (e) => this.#down(e), { signal });
    d.addEventListener('pointermove', (e) => this.#move(e), { signal });
    d.addEventListener('pointerup', (e) => this.#up(e), { signal });
    d.addEventListener('pointercancel', (e) => this.#up(e), { signal });
    // La molette est ecoutee sur le conteneur du canvas : les entites posees sur la
    // carte (marqueurs, etiquettes) sont ses voisines, et zoomer au-dessus d'un
    // marqueur doit zoomer la carte.
    (d.parentElement ?? d).addEventListener('wheel', (e) => this.#wheel(e), { passive: false, signal });
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      this._keys.add(e.key);
      if (NAV_KEYS.has(e.key)) this.onUserInput();
    }, { signal });
    window.addEventListener('keyup', (e) => this._keys.delete(e.key), { signal });
    window.addEventListener('blur', () => this._keys.clear(), { signal });
  }

  /** Detache tous les ecouteurs : le canvas peut etre demonte sans fuite. */
  dispose() {
    this._listeners.abort();
  }

  #down(e) {
    this.onUserInput();
    this.dom.setPointerCapture(e.pointerId);
    this._ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this._ptr.size === 1) {
      this._mode = (e.button === 2 || e.shiftKey) ? 'orbit' : 'pan';
      this._last = { x: e.clientX, y: e.clientY };
    } else if (this._ptr.size === 2) {
      this._mode = 'pinch';
      this._pinch = this.#pinchDistance();
      this._twist = this.#pinchPose();
    }
  }

  /** Angle et hauteur moyenne des deux doigts : rotation et inclinaison tactiles. */
  #pinchPose() {
    const [a, b] = [...this._ptr.values()];
    return { angle: Math.atan2(b.y - a.y, b.x - a.x), midY: (a.y + b.y) / 2 };
  }

  #pinchDistance() {
    const [a, b] = [...this._ptr.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  #move(e) {
    if (!this._ptr.has(e.pointerId)) return;
    this._ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._mode === 'pinch' && this._ptr.size === 2) {
      const d = this.#pinchDistance();
      if (this._pinch > 0) this._d.dist += Math.log(this._pinch / d) * 1.6;
      this._pinch = d;

      // tourner les deux doigts fait pivoter, les glisser ensemble incline
      const pose = this.#pinchPose();
      if (this._twist) {
        let turn = pose.angle - this._twist.angle;
        if (turn > Math.PI) turn -= 2 * Math.PI;
        if (turn < -Math.PI) turn += 2 * Math.PI;
        this._d.az -= turn;
        this._d.pol -= (pose.midY - this._twist.midY) * 0.005;
      }
      this._twist = pose;
      return;
    }

    const dx = e.clientX - this._last.x;
    const dy = e.clientY - this._last.y;
    this._last = { x: e.clientX, y: e.clientY };

    if (this._mode === 'orbit') {
      this._d.az -= dx * 0.005;
      this._d.pol -= dy * 0.005;
    } else if (this._mode === 'pan') {
      // un pixel d'ecran = une distance au sol constante, quel que soit le zoom
      const k = 2 * this.distance
        * Math.tan((this.camera.fov * DEG) / 2) / this.dom.clientHeight;
      const cos = Math.cos(this.azimuth), sin = Math.sin(this.azimuth);
      // le deplacement vertical de la souris suit le sol, pas l'ecran
      const fwd = dy * k / Math.max(0.25, Math.sin(this.polar));
      this._d.pan.x += (-dx * k * cos - fwd * sin);
      this._d.pan.z += (dx * k * sin - fwd * cos);
    }
  }

  #up(e) {
    this._ptr.delete(e.pointerId);
    if (this._ptr.size === 0) this._mode = null;
    else if (this._ptr.size === 1) { this._mode = 'pan'; const p = [...this._ptr.values()][0]; this._last = { x: p.x, y: p.y }; }
  }

  #wheel(e) {
    e.preventDefault();
    this.onUserInput();
    const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? 380 : 1;
    this._d.dist += Math.sign(e.deltaY) * Math.min(1.6, Math.abs(e.deltaY * unit) / 260);
    const r = this.dom.getBoundingClientRect();
    this._zoomTo = {
      x: ((e.clientX - r.left) / r.width) * 2 - 1,
      y: -((e.clientY - r.top) / r.height) * 2 + 1,
    };
  }

  /** Point du plan du sol vise par le curseur (repere monde). */
  #groundAt(ndc, out) {
    const dir = new Vector3(ndc.x, ndc.y, 0.5)
      .unproject(this.camera).sub(this.camera.position).normalize();
    if (Math.abs(dir.y) < 1e-5) return null;
    const t = (this.target.y - this.camera.position.y) / dir.y;
    if (t <= 0) return null;
    return out.copy(this.camera.position).addScaledVector(dir, t);
  }

  /** Recentre la vue sur un point donne en coordonnees monde. */
  goTo(x, z, distance, { azimuth = this.azimuth, polar = this.polar } = {}) {
    this.target.set(x, this.target.y, z);
    this.distance = MathUtils.clamp(distance, this.minDistance, this.maxDistance);
    this.azimuth = azimuth;
    this.polar = MathUtils.clamp(polar, this.minPolar, this.maxPolar);
    this._d.pan.set(0, 0, 0); this._d.dist = 0; this._d.az = 0; this._d.pol = 0;
    this.changed = true;
  }

  update(dt) {
    const k = this._keys;
    if (k.size) {
      const step = this.distance * 0.9 * Math.min(0.05, dt);
      const cos = Math.cos(this.azimuth), sin = Math.sin(this.azimuth);
      if (k.has('ArrowUp'))    { this._d.pan.x -= step * sin; this._d.pan.z -= step * cos; }
      if (k.has('ArrowDown'))  { this._d.pan.x += step * sin; this._d.pan.z += step * cos; }
      if (k.has('ArrowLeft'))  { this._d.pan.x -= step * cos; this._d.pan.z += step * sin; }
      if (k.has('ArrowRight')) { this._d.pan.x += step * cos; this._d.pan.z -= step * sin; }
      if (k.has('+') || k.has('=')) this._d.dist -= 0.06;
      if (k.has('-') || k.has('_')) this._d.dist += 0.06;
    }

    const orbiting = this.autoRotate !== 0 && dt > 0;
    if (orbiting) {
      // le dernier pas est raccourci : l'orbite s'arrete exactement sur son angle
      const step = Math.sign(this.autoRotate)
        * Math.min(Math.abs(this.autoRotate * dt), this.autoRotateBudget);
      this.azimuth += step;
      this.autoRotateBudget -= Math.abs(step);
      if (this.autoRotateBudget <= 0) {
        this.autoRotate = 0;
        this.onAutoRotateEnd();
      }
    }

    const a = 1 - Math.pow(1 - this.damping, Math.max(1, dt * 60));
    const moved = orbiting
      || this._d.pan.lengthSq() > 1e-9
      || Math.abs(this._d.dist) > 1e-5
      || Math.abs(this._d.az) > 1e-6 || Math.abs(this._d.pol) > 1e-6;

    if (moved) {
      this.target.x += this._d.pan.x * a;
      this.target.z += this._d.pan.z * a;
      this._d.pan.multiplyScalar(1 - a);

      this.azimuth += this._d.az * a;
      this.polar = MathUtils.clamp(this.polar + this._d.pol * a, this.minPolar, this.maxPolar);
      this._d.az *= (1 - a); this._d.pol *= (1 - a);

      const step = this._d.dist * a;
      if (Math.abs(step) > 1e-6) {
        const before = this._zoomTo ? this.#groundAt(this._zoomTo, new Vector3()) : null;
        const next = MathUtils.clamp(this.distance * Math.exp(step),
          this.minDistance, this.maxDistance);
        const ratio = next / this.distance;
        this.distance = next;
        // zoom vers le curseur : la cible glisse vers le point vise
        if (before) {
          this.target.x += (before.x - this.target.x) * (1 - ratio);
          this.target.z += (before.z - this.target.z) * (1 - ratio);
        }
      }
      this._d.dist *= (1 - a);
      this.changed = true;
    }

    // la cible epouse doucement le relief, pour garder une navigation naturelle
    if (this.groundProbe) {
      const g = this.groundProbe(this.target.x, this.target.z);
      if (g !== null && Number.isFinite(g)) {
        this.target.y += (g - this.target.y) * Math.min(1, 3 * dt);
      }
    }

    const sp = Math.sin(this.polar), cp = Math.cos(this.polar);
    this.camera.position.set(
      this.target.x + this.distance * sp * Math.sin(this.azimuth),
      this.target.y + this.distance * cp,
      this.target.z + this.distance * sp * Math.cos(this.azimuth),
    );
    this.camera.lookAt(this.target);

    const dirty = this.changed;
    this.changed = false;
    return dirty || moved;
  }
}
