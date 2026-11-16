/**
 * Cartouches des routes : le numéro d'une autoroute, posé le long de son tracé
 * comme sur une carte routière. Ils ne se touchent pas — ils nomment.
 */

import type { OverlayFeature, OverlayStyle } from '../OverlayLayer.ts';

export type RoadShieldFeature = OverlayFeature;

export const roadShieldStyle: OverlayStyle<RoadShieldFeature> = {
  className: 'overlay-motorways',
  maxVisible: 40,
  detailDistance: Infinity,
  // un peu plus que le cartouche lui-même : deux numéros voisins ne se collent pas
  footprint: (feature) => ({ width: 26 + feature.label.length * 8, height: 30 }),
  create() {
    const element = document.createElement('span');
    element.className = 'road-shield';
    return element;
  },
  paint(element, feature) {
    element.textContent = feature.label;
  },
};
