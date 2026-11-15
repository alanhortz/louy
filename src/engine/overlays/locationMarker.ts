/**
 * Repère de la position du visiteur : un point qui bat, entouré d'un halo. Il
 * ne se touche pas — il désigne, sans rien ouvrir.
 */

import type { OverlayFeature, OverlayStyle } from '../OverlayLayer.ts';

export type LocationFeature = OverlayFeature;

export const locationMarkerStyle: OverlayStyle<LocationFeature> = {
  className: 'overlay-location',
  maxVisible: 1,
  detailDistance: Infinity,
  // sans encombrement : le repère ne chasse aucun marqueur, et aucun ne le chasse
  footprint: () => ({ width: 0, height: 0 }),
  create() {
    const element = document.createElement('div');
    element.className = 'location-marker';
    element.innerHTML = '<span class="location-halo"></span><span class="location-dot"></span><span class="location-caption"></span>';
    return element;
  },
  paint(element, feature) {
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', feature.label);
    element.lastElementChild!.textContent = feature.label;
  },
};
