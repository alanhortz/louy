import type { Place, PlaceKind } from '../../domain/places.ts';
import type { OverlayStyle } from '../OverlayLayer.ts';

/** Largeur moyenne d'un caractère de l'étiquette, en pixels, par type de lieu. */
const CHARACTER_WIDTH: Record<PlaceKind, number> = { city: 11, town: 8.2, village: 7.4 };

/** Noms de villes et de villages : texte seul, hiérarchisé par la typographie. */
export const placeLabelStyle: OverlayStyle<Place> = {
  className: 'overlay-places',
  maxVisible: 42,
  detailDistance: 0,
  footprint: (place) => ({
    width: place.label.length * CHARACTER_WIDTH[place.kind] + 18,
    height: place.kind === 'city' ? 26 : 20,
  }),
  create() {
    // ancre sans dimension : le texte se centre dessus quelle que soit sa largeur
    const anchor = document.createElement('span');
    anchor.className = 'place-anchor';
    anchor.append(document.createElement('span'));
    return anchor;
  },
  paint(anchor, place) {
    const label = anchor.firstElementChild as HTMLElement;
    label.className = 'place-label';
    label.textContent = place.label;
    label.dataset.kind = place.kind;
  },
};
