/**
 * Marqueurs des scans 3D : ils disent où un lieu a été reconstruit, et un clic
 * y emmène. Même mécanique et mêmes teintes que les caméras ; l'icône est un
 * volume en fil de fer, et le nom du lieu reste affiché sous elle.
 */

import { SCANS_LABEL } from '../../domain/scans.ts';
import type { OverlayFeature, OverlayStyle } from '../OverlayLayer.ts';
import { TINT_ACTIVE, TINT_IDLE, tinted } from './tint.ts';

export interface ScanFeature extends OverlayFeature {
  /** Nombre d'objets que ce marqueur rassemble, quand il y en a plusieurs. */
  count?: number;
}

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M18 5 30 11.5v13L18 31 6 24.5v-13Z" fill="#0e1720" stroke="#75e7ff" stroke-width="1.4"/>
    <path d="M6 11.5 18 18l12-6.5M18 18v13" stroke="#75e7ff" stroke-width="1.2"/>
    <path d="M18 5v6.5M6 24.5l5.6-3M30 24.5l-5.6-3" stroke="#4ecde7" stroke-width="0.9" stroke-dasharray="1.6 2"/>
    <circle cx="18" cy="18" r="2.2" fill="#c9f6ff" stroke="#dbfbff" stroke-width="0.6"/>
  </g>
</svg>`;

const ICON_IDLE = tinted(ICON, TINT_IDLE);
const ICON_ACTIVE = tinted(ICON, TINT_ACTIVE);

export const scanMarkerStyle: OverlayStyle<ScanFeature> = {
  className: 'overlay-scans',
  maxVisible: 32,
  detailDistance: Infinity,
  footprint: () => ({ width: 132, height: 62 }),
  create() {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'scan-marker';
    element.innerHTML =
      '<img class="scan-marker-icon" alt="" width="28" height="28" /><i class="scan-count" hidden></i>'
      + `<span class="scan-caption"><b>${SCANS_LABEL}</b><span></span></span>`;
    return element;
  },
  paint(element, scan, { active }) {
    const [icon, badge, caption] = element.children as unknown as [HTMLImageElement, HTMLElement, HTMLElement];
    badge.hidden = scan.count === undefined;
    badge.textContent = String(scan.count ?? '');
    element.setAttribute('aria-label', `${SCANS_LABEL} : ${scan.label}`);
    element.classList.toggle('active', active);
    icon.src = active ? ICON_ACTIVE : ICON_IDLE;
    caption.lastElementChild!.textContent = scan.label;
  },
};
