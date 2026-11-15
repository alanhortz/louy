import type { StreetLabel } from '../../domain/streets.ts';
import type { OverlayStyle } from '../OverlayLayer.ts';

/** Largeur moyenne d'un caractère de l'étiquette, en pixels. */
const CHARACTER_WIDTH = 5.6;
/** Demi-longueur du bout de rue, en mètres, dont on lit la direction à l'écran. */
const TANGENT = 30;
const DEG = Math.PI / 180;

/**
 * Noms de rues, à la manière d'un plan : le texte se couche le long de la rue,
 * dans le sens où elle se présente à l'écran, et reste toujours lisible de
 * gauche à droite. Plus discrets que les noms de lieux, les grands axes un peu
 * plus marqués.
 */
export const streetLabelStyle: OverlayStyle<StreetLabel> = {
  className: 'overlay-streets',
  maxVisible: 60,
  detailDistance: 0,
  footprint: (street) => ({ width: street.label.length * CHARACTER_WIDTH + 14, height: 17 }),
  create() {
    // ancre sans dimension : le texte se centre dessus quelle que soit sa largeur
    const anchor = document.createElement('span');
    anchor.className = 'place-anchor';
    anchor.append(document.createElement('span'));
    return anchor;
  },
  paint(anchor, street) {
    const label = anchor.firstElementChild as HTMLElement;
    label.className = 'street-label';
    label.textContent = street.label;
    label.dataset.rank = String(street.rank);
  },
  orient(anchor, street, frame) {
    const dx = Math.cos(street.bearing * DEG) * TANGENT, dy = Math.sin(street.bearing * DEG) * TANGENT;
    const from = frame.project(street.x - dx, street.y - dy, false);
    const to = frame.project(street.x + dx, street.y + dy, false);
    if (!from || !to) return;
    let angle = Math.atan2(to.sy - from.sy, to.sx - from.sx) / DEG;
    // jamais la tête en bas : au-delà du quart de tour, le texte se lit dans l'autre sens
    if (angle > 90) angle -= 180;
    else if (angle <= -90) angle += 180;
    (anchor.firstElementChild as HTMLElement).style.setProperty('--street-angle', `${angle.toFixed(1)}deg`);
  },
};
