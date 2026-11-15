import type { StreetLabel } from '../../domain/streets.ts';
import type { OverlayStyle } from '../OverlayLayer.ts';

/** Largeur moyenne d'un caractère de l'étiquette, en pixels. */
const CHARACTER_WIDTH = 5.6;

/** Noms de rues : texte seul, plus discret que les noms de lieux, les grands axes un peu plus marqués. */
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
};
