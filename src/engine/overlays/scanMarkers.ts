/**
 * Marqueurs de l'imagerie aérienne et des objets scannés : ils disent où un
 * lieu a été reconstruit, où un objet a été relevé, et un toucher y emmène.
 * Même mécanique et mêmes teintes que les caméras ; le nom reste affiché sous
 * l'icône. Quand plusieurs marqueurs se recouvriraient à l'écran, un seul les
 * représente et porte leur nombre.
 */

import { AERIAL_LABEL, OBJECTS_LABEL } from '../../domain/scans.ts';
import type { OverlayFeature, OverlayStyle } from '../OverlayLayer.ts';
import { TINT_ACTIVE, TINT_IDLE, tinted } from './tint.ts';

export type ScanFeature = OverlayFeature;

/** Objet scanné : un volume en fil de fer. */
const OBJECT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M18 5 30 11.5v13L18 31 6 24.5v-13Z" fill="#0e1720" stroke="#75e7ff" stroke-width="1.4"/>
    <path d="M6 11.5 18 18l12-6.5M18 18v13" stroke="#75e7ff" stroke-width="1.2"/>
    <path d="M18 5v6.5M6 24.5l5.6-3M30 24.5l-5.6-3" stroke="#4ecde7" stroke-width="0.9" stroke-dasharray="1.6 2"/>
    <circle cx="18" cy="18" r="2.2" fill="#c9f6ff" stroke="#dbfbff" stroke-width="0.6"/>
  </g>
</svg>`;

/** Imagerie aérienne : le cadre d'une prise de vue, vu du ciel, et le relief qu'il contient. */
const AERIAL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    <rect x="6" y="8" width="24" height="20" rx="3" fill="#0e1720" stroke="#75e7ff" stroke-width="1.4"/>
    <path d="M9 24.500 15 17l4 4.500 3-3.200 5 6.200" stroke="#75e7ff" stroke-width="1.3"/>
    <circle cx="23.500" cy="13.500" r="1.800" fill="#c9f6ff" stroke="#dbfbff" stroke-width="0.6"/>
    <path d="M3 12V7a2 2 0 0 1 2-2h5M33 12V7a2 2 0 0 0-2-2h-5M3 24v5a2 2 0 0 0 2 2h5M33 24v5a2 2 0 0 1-2 2h-5" stroke="#4ecde7" stroke-width="1"/>
  </g>
</svg>`;

interface MarkerKind {
  className: string;
  /** Genre affiché en tête de légende. */
  kicker: string;
  /** Légende d'un marqueur qui rassemble `count` éléments. */
  plural(count: number): string;
  icon: string;
}

function scanMarker({ className, kicker, plural, icon }: MarkerKind): OverlayStyle<ScanFeature> {
  const idle = tinted(icon, TINT_IDLE);
  const lit = tinted(icon, TINT_ACTIVE);
  return {
    className,
    maxVisible: 32,
    detailDistance: Infinity,
    footprint: () => ({ width: 132, height: 62 }),
    clusters: true,
    create() {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'scan-marker';
      element.innerHTML =
        '<img class="scan-marker-icon" alt="" width="28" height="28" /><i class="scan-count" hidden></i>'
        + `<span class="scan-caption"><b>${kicker}</b><span></span></span>`;
      return element;
    },
    paint(element, scan, { active, members }) {
      const [image, badge, caption] = element.children as unknown as [HTMLImageElement, HTMLElement, HTMLElement];
      const label = members.length > 1 ? plural(members.length) : scan.label;
      element.setAttribute('aria-label', `${kicker} : ${label}`);
      element.classList.toggle('active', active);
      image.src = active ? lit : idle;
      badge.hidden = members.length < 2;
      badge.textContent = String(members.length);
      caption.lastElementChild!.textContent = label;
    },
  };
}

export const aerialMarkerStyle = scanMarker({
  className: 'overlay-scans', kicker: AERIAL_LABEL, plural: (count) => `${count} lieux`, icon: AERIAL_ICON,
});

export const objectMarkerStyle = scanMarker({
  className: 'overlay-objects', kicker: OBJECTS_LABEL, plural: (count) => `${count} objets`, icon: OBJECT_ICON,
});
