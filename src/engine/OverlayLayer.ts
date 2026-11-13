/**
 * Calque d'entités en superposition (noms de lieux, caméras, scans 3D).
 *
 * Les entités sont rendues en HTML plutôt qu'en texture : le texte reste net à
 * toute échelle, se style en CSS et ne coûte aucun appel de dessin. À chaque
 * image utile, elles sont projetées à l'écran puis désencombrées : triées par
 * importance, elles sont acceptées une à une si elles n'empiètent sur aucune
 * entité déjà posée — une ville chasse donc un village, jamais l'inverse.
 */

export interface OverlayFeature {
  id: string;
  /** Position Lambert 2008, en mètres. */
  x: number;
  y: number;
  label: string;
  /** Importance : la plus haute est placée en premier. */
  rank: number;
  /** Éloignement de la caméra, en mètres, au-delà duquel l'entité n'est plus proposée. */
  maxDistance?: number;
  /** Altitude au-dessus du niveau de la mer, en mètres ; à défaut, l'entité est posée sur le relief. */
  altitude?: number;
  /**
   * Mouvement : vitesse en m/s dans le repère Lambert, valable depuis l'instant
   * `at` (millisecondes Unix). L'entité est alors redessinée à chaque image, à
   * sa position extrapolée, pendant `horizon` secondes au plus.
   */
  motion?: { vx: number; vy: number; vz: number; at: number; horizon: number };
  /** Éloignement en deçà duquel elle ne l'est plus : on est dessus, elle masquerait ce qu'elle désigne. */
  minDistance?: number;
}

export interface OverlayPaintState {
  active: boolean;
  /** L'entité est assez proche de la caméra pour montrer son détail (vignette…). */
  detailed: boolean;
}

/** Ce qui distingue un calque d'un autre : son apparence, pas sa mécanique. */
export interface OverlayStyle<F extends OverlayFeature> {
  className: string;
  maxVisible: number;
  /** Éloignement de la caméra sous lequel une entité est montrée en détail. */
  detailDistance: number;
  /** Encombrement à l'écran, en pixels, centré sur le point d'ancrage. */
  footprint(feature: F): { width: number; height: number };
  create(): HTMLElement;
  paint(element: HTMLElement, feature: F, state: OverlayPaintState): void;
  /** Appelé à chaque image pour une entité visible : ce qui dépend du point de vue (l'orientation d'une icône). */
  orient?(element: HTMLElement, feature: F, frame: OverlayFrame): void;
}

export interface OverlayFrame {
  /**
   * Projette un point Lambert en pixels écran ; `null` s'il est hors champ. `range` : éloignement de la caméra.
   * Sans `altitude`, le point est posé sur le relief (`refine` l'y cale précisément).
   */
  project(x: number, y: number, refine: boolean, altitude?: number): { sx: number; sy: number; range: number } | null;
  distance: number;
  /** Cap de la vue, en degrés depuis le nord. */
  azimuth: number;
  /** Instant de l'image, en millisecondes Unix. */
  now: number;
}

interface Box { x0: number; y0: number; x1: number; y1: number }

/**
 * Au-delà de ce multiple de la distance de visée, une entité n'appartient plus à
 * la scène regardée : c'est l'horizon, où tout s'empilerait sur une même ligne.
 */
const HORIZON_FACTOR = 40;

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

export class OverlayLayer<F extends OverlayFeature = OverlayFeature> {
  readonly #host: HTMLElement;
  readonly #style: OverlayStyle<F>;
  readonly #pool: HTMLElement[] = [];
  readonly #shown = new WeakMap<HTMLElement, string>();
  #features: F[] = [];
  #activeId: string | null = null;

  constructor(root: HTMLElement, style: OverlayStyle<F>, onPick?: (id: string) => void) {
    this.#style = style;
    this.#host = document.createElement('div');
    this.#host.className = `overlay ${style.className}`;
    root.append(this.#host);

    if (onPick) {
      this.#host.addEventListener('click', (event) => {
        const element = (event.target as HTMLElement).closest<HTMLElement>('[data-feature]');
        if (element?.dataset.feature) onPick(element.dataset.feature);
      });
    }
  }

  setFeatures(features: readonly F[]): void {
    // tri unique, à la réception : le désencombrement parcourt du plus au moins important
    this.#features = [...features].sort((a, b) => b.rank - a.rank);
  }

  setActive(id: string | null): void {
    this.#activeId = id;
  }

  /** Une entité au moins se déplace : le calque doit être redessiné même quand la vue est immobile. */
  get animated(): boolean {
    return this.#features.some((feature) => feature.motion !== undefined);
  }

  update(frame: OverlayFrame): void {
    const { maxVisible, detailDistance } = this.#style;
    const horizon = frame.distance * HORIZON_FACTOR;
    const placed: Box[] = [];
    let used = 0;

    for (const feature of this.#features) {
      if (used >= maxVisible) break;
      // une entité en mouvement est dessinée là où elle est maintenant, pas là où elle a été vue
      let { x, y, altitude } = feature;
      if (feature.motion) {
        const dt = Math.min(feature.motion.horizon, Math.max(0, (frame.now - feature.motion.at) / 1000));
        x += feature.motion.vx * dt;
        y += feature.motion.vy * dt;
        if (altitude !== undefined) altitude += feature.motion.vz * dt;
      }
      // premier passage grossier (altitude de la cible) pour écarter le hors-champ et le lointain
      const coarse = frame.project(x, y, false, altitude);
      if (!coarse || coarse.range > Math.min(horizon, feature.maxDistance ?? Infinity)) continue;
      if (coarse.range < (feature.minDistance ?? 0)) continue;
      const point = frame.project(x, y, true, altitude);
      if (!point) continue;

      const active = feature.id === this.#activeId;
      const detailed = point.range < detailDistance;
      const { width, height } = this.#style.footprint(feature);
      const box: Box = {
        x0: point.sx - width / 2, y0: point.sy - height / 2,
        x1: point.sx + width / 2, y1: point.sy + height / 2,
      };
      // l'entité active reste toujours visible, même au milieu d'un groupe
      if (!active && placed.some((other) => overlaps(box, other))) continue;
      placed.push(box);

      const element = this.#element(used++);
      element.style.transform = `translate3d(${point.sx.toFixed(1)}px, ${point.sy.toFixed(1)}px, 0)`;
      const signature = `${feature.id}|${active ? 1 : 0}|${detailed ? 1 : 0}`;
      if (this.#shown.get(element) !== signature) {
        element.dataset.feature = feature.id;
        this.#style.paint(element, feature, { active, detailed });
        this.#shown.set(element, signature);
      }
      this.#style.orient?.(element, feature, frame);
      element.hidden = false;
    }

    for (let k = used; k < this.#pool.length; k++) this.#pool[k]!.hidden = true;
  }

  dispose(): void {
    this.#host.remove();
  }

  /** Recycle les nœuds : on n'en crée jamais plus que le plafond du calque. */
  #element(index: number): HTMLElement {
    let element = this.#pool[index];
    if (!element) {
      element = this.#style.create();
      this.#pool[index] = element;
      this.#host.append(element);
    }
    return element;
  }
}
