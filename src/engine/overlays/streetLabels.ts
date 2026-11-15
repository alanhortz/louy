import type { StreetLabel } from '../../domain/streets.ts';
import type { OverlayStyle } from '../OverlayLayer.ts';

/** Largeur moyenne d'un caractère de l'étiquette, en pixels. */
const CHARACTER_WIDTH = 5.6;
const SVG = 'http://www.w3.org/2000/svg';

let serial = 0;

type Point = readonly [x: number, y: number];

/** Chemin SVG lissé par une suite de points : les sommets deviennent des courbes, pas des angles. */
function smoothPath(points: readonly Point[]): string {
  const at = ([x, y]: Point) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (points.length < 3) return `M${at(points[0]!)}L${at(points.at(-1)!)}`;
  let path = `M${at(points[0]!)}L${at(mid(points[0]!, points[1]!))}`;
  for (let k = 1; k < points.length - 1; k++) path += `Q${at(points[k]!)} ${at(mid(points[k]!, points[k + 1]!))}`;
  return `${path}L${at(points.at(-1)!)}`;
}

/**
 * Noms de rues, à la manière d'un plan : chaque lettre suit la courbe de la
 * rue, telle qu'elle se présente à l'écran, et le nom reste lisible de gauche
 * à droite. Plus discrets que les noms de lieux, les grands axes un peu plus
 * marqués.
 */
export const streetLabelStyle: OverlayStyle<StreetLabel> = {
  className: 'overlay-streets',
  maxVisible: 60,
  detailDistance: 0,
  // le nom peut se présenter dans n'importe quel sens : on lui réserve un carré, celui
  // qu'il occupe quand il est en biais — deux noms ne se croisent alors plus
  footprint: (street) => {
    const side = Math.max(34, (street.label.length * CHARACTER_WIDTH + 14) * 0.72);
    return { width: side, height: side };
  },
  create() {
    // ancre sans dimension, posée sur le point de l'étiquette : le tracé s'y rapporte
    const anchor = document.createElement('span');
    anchor.className = 'place-anchor';
    const id = `street-curve-${serial++}`;
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'street-label');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('id', id);
    const text = document.createElementNS(SVG, 'text');
    const along = document.createElementNS(SVG, 'textPath');
    along.setAttribute('href', `#${id}`);
    along.setAttribute('startOffset', '50%');
    text.append(along);
    svg.append(path, text);
    anchor.append(svg);
    return anchor;
  },
  paint(anchor, street) {
    const svg = anchor.firstElementChild as SVGSVGElement;
    svg.dataset.rank = String(street.rank);
    svg.querySelector('textPath')!.textContent = street.label;
  },
  orient(anchor, street, frame) {
    const origin = frame.project(street.x, street.y, false);
    if (!origin) return;
    // le tracé, à l'écran, relatif à l'ancre ; un point hors champ interrompt la suite
    let run: Point[] = [];
    let best: Point[] = [];
    const middle = street.curve.length / 4;
    let holdsMiddle = false, bestHoldsMiddle = false;
    for (let k = 0; k < street.curve.length; k += 2) {
      const point = frame.project(street.x + street.curve[k]!, street.y + street.curve[k + 1]!, false);
      if (point) {
        run.push([point.sx - origin.sx, point.sy - origin.sy]);
        if (k / 2 >= middle - 1 && k / 2 <= middle) holdsMiddle = true;
      }
      if (!point || k + 2 >= street.curve.length) {
        // on garde la suite qui passe par l'étiquette, à défaut la plus longue
        if ((holdsMiddle && !bestHoldsMiddle) || (holdsMiddle === bestHoldsMiddle && run.length > best.length)) {
          best = run;
          bestHoldsMiddle = holdsMiddle;
        }
        run = [];
        holdsMiddle = false;
      }
    }
    if (best.length < 2) best = [[-40, 0], [40, 0]];
    // jamais la tête en bas : le nom se lit de la gauche vers la droite
    if (best.at(-1)![0] < best[0]![0]) best.reverse();

    // un tracé trop court pour le nom : celui-ci s'écrit droit, dans l'axe de la rue
    const length = best.reduce((sum, point, k) => (k === 0 ? 0 : sum + Math.hypot(point[0] - best[k - 1]![0], point[1] - best[k - 1]![1])), 0);
    const needed = street.label.length * CHARACTER_WIDTH + 10;
    if (length < needed) {
      const first = best[0]!, last = best.at(-1)!;
      const span = Math.hypot(last[0] - first[0], last[1] - first[1]) || 1;
      const ux = (last[0] - first[0]) / span, uy = (last[1] - first[1]) / span;
      best = [[-ux * needed / 2, -uy * needed / 2], [ux * needed / 2, uy * needed / 2]];
    }
    anchor.firstElementChild!.firstElementChild!.setAttribute('d', smoothPath(best));
  },
};
