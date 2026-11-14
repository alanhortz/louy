/**
 * Marqueurs des caméras routières.
 *
 * Même gabarit que les marqueurs de l'imagerie 3D : cible de 44 px, icône de
 * 28 px au halo cyan (or quand elle est sélectionnée), et sous elle une légende
 * à deux lignes — le genre, puis le nom. De loin l'icône est seule ; de près la
 * légende apparaît, avec au-dessus la dernière image de la caméra.
 *
 * Les teintes (repos `#6be8ff`, active `#ffd97a`) reprennent God's Eye View —
 * © 2026 Bilawal Sidhu, licence MIT.
 */

import type { OverlayFeature, OverlayStyle } from '../OverlayLayer.ts';
import { TINT_ACTIVE, TINT_IDLE, tinted } from './tint.ts';

export interface CameraFeature extends OverlayFeature {
  thumbnail: string;
}

/**
 * Le pictogramme du panneau « Caméras » (Heroicons, `video-camera`, contour) :
 * une caméra se reconnaît ainsi du rail jusqu'à la carte. Le fond sombre le
 * détache de l'orthophoto, comme les autres marqueurs.
 */
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <g transform="translate(3 3) scale(1.25)" fill="#0e1720" stroke="#75e7ff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"/>
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
