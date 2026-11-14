/**
 * Marqueurs des films du temps : ils disent où un lieu a son film, et un clic
 * le lance. Même mécanique et mêmes teintes que les caméras et l'imagerie 3D ;
 * l'icône est un cadran d'horloge, et le nom du lieu reste affiché sous elle.
 */

import { FILMS_LABEL } from '../../domain/timeline.ts';
import type { OverlayFeature, OverlayStyle } from '../OverlayLayer.ts';
import { TINT_ACTIVE, TINT_IDLE, tinted } from './tint.ts';

export type FilmFeature = OverlayFeature;

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    <circle cx="18" cy="18" r="12.5" fill="#0e1720" stroke="#75e7ff" stroke-width="1.4"/>
    <path d="M18 10.5V18l5 3" stroke="#c9f6ff" stroke-width="1.6"/>
    <path d="M18 3.5v2.4M18 30.1v2.4M3.5 18h2.4M30.1 18h2.4" stroke="#4ecde7" stroke-width="1.2"/>
    <circle cx="18" cy="18" r="1.6" fill="#c9f6ff" stroke="#dbfbff" stroke-width="0.6"/>
  </g>
</svg>`;

const ICON_IDLE = tinted(ICON, TINT_IDLE);
const ICON_ACTIVE = tinted(ICON, TINT_ACTIVE);

export const filmMarkerStyle: OverlayStyle<FilmFeature> = {
  className: 'overlay-films',
  maxVisible: 32,
  detailDistance: Infinity,
  footprint: () => ({ width: 132, height: 62 }),
  create() {
    const element = document.createElement('button');
    element.type = 'button';
    // même gabarit que le marqueur d'imagerie 3D : cible de 44 px, légende dessous
    element.className = 'scan-marker film-marker';
    element.innerHTML =
      '<img class="scan-marker-icon" alt="" width="28" height="28" />'
      + '<span class="scan-caption"><b>Film du temps</b><span></span></span>';
    return element;
  },
  paint(element, place, { active }) {
    const [icon, caption] = element.children as unknown as [HTMLImageElement, HTMLElement];
    element.setAttribute('aria-label', `${FILMS_LABEL} : ${place.label}`);
    element.classList.toggle('active', active);
    icon.src = active ? ICON_ACTIVE : ICON_IDLE;
    caption.lastElementChild!.textContent = place.label;
  },
};
