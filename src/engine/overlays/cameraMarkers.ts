/**
 * Marqueurs des caméras routières.
 *
 * Même gabarit que les marqueurs de l'imagerie 3D : cible de 44 px, icône de
 * 28 px au halo cyan (or quand elle est sélectionnée), et sous elle une légende
 * à deux lignes — le genre, puis le nom. De loin l'icône est seule ; de près la
 * légende apparaît, avec au-dessus la dernière image de la caméra.
 *
 * Le dessin de l'icône et ses teintes (repos `#6be8ff`, active `#ffd97a`)
 * reprennent God's Eye View — © 2026 Bilawal Sidhu, licence MIT.
 */

import type { OverlayFeature, OverlayStyle } from '../OverlayLayer.ts';
import { TINT_ACTIVE, TINT_IDLE, tinted } from './tint.ts';

export interface CameraFeature extends OverlayFeature {
  thumbnail: string;
}

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <defs>
    <linearGradient id="lens" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#c9f6ff"/>
      <stop offset="45%" stop-color="#6fd9ff"/>
      <stop offset="100%" stop-color="#1a5f78"/>
    </linearGradient>
  </defs>
  <g transform="translate(4 6)">
    <rect x="0" y="8" width="20" height="9" rx="2.5" fill="#0e1720" stroke="#75e7ff" stroke-width="1.2"/>
    <rect x="17" y="10" width="10" height="5" rx="1.5" fill="#132433" stroke="#75e7ff" stroke-width="1"/>
    <circle cx="24" cy="12.5" r="3.1" fill="url(#lens)" stroke="#dbfbff" stroke-width="0.8"/>
    <rect x="6.4" y="17" width="4.2" height="8.5" rx="1.2" fill="#10212d" stroke="#75e7ff" stroke-width="1"/>
    <rect x="4.2" y="24" width="8.6" height="2.5" rx="1.1" fill="#0b151d" stroke="#4ecde7" stroke-width="0.8"/>
  </g>
</svg>`;

const ICON_IDLE = tinted(ICON, TINT_IDLE);
const ICON_ACTIVE = tinted(ICON, TINT_ACTIVE);

export const cameraMarkerStyle: OverlayStyle<CameraFeature> = {
  className: 'overlay-cameras',
  maxVisible: 64,
  detailDistance: 6000,
  footprint: () => ({ width: 30, height: 30 }),
  create() {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'scan-marker camera-marker';
    element.innerHTML =
      '<img class="scan-marker-icon" alt="" width="28" height="28" />'
      + '<span class="camera-card"><img alt="" width="96" height="54" /></span>'
      + '<span class="scan-caption"><b>Caméra</b><span></span></span>';
    return element;
  },
  paint(element, camera, { active, detailed }) {
    const [icon, card, caption] = element.children as unknown as [HTMLImageElement, HTMLElement, HTMLElement];
    const thumbnail = card.firstElementChild as HTMLImageElement;
    element.setAttribute('aria-label', `Caméra ${camera.label}`);
    element.classList.toggle('active', active);
    icon.src = active ? ICON_ACTIVE : ICON_IDLE;
    caption.lastElementChild!.textContent = camera.label;
    // de loin, des centaines de légendes se recouvriraient : seule la caméra sélectionnée garde la sienne
    caption.hidden = !detailed && !active;
    // la caméra active n'a pas de vignette : son image est dans le panneau
    card.hidden = !detailed || active;
    if (!card.hidden) thumbnail.src = camera.thumbnail;
  },
};
