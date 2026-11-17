/**
 * Marqueurs des caméras routières.
 *
 * Même gabarit que les marqueurs de l'imagerie 3D : cible de 44 px, icône au
 * halo cyan — de 14 px, moitié moins grande : les caméras sont nombreuses — (or quand elle est sélectionnée), et sous elle une légende
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
  /** La pose de la caméra est connue : elle offre « Vue caméra », et son marqueur le montre. */
  view: boolean;
}

/**
 * Le pictogramme d'une caméra routière, dessiné pour L'Oûy dans la famille des autres marqueurs :
 * un boîtier sur son pied, l'objectif clair au milieu. Le fond sombre le détache
 * de l'orthophoto.
 */
// Peu de formes, épaisses et pleines : le marqueur se lit encore à 18 px sur une orthophoto.
const BODY = `<rect x="3" y="10" width="21" height="15" rx="4" fill="#0e1720" stroke="#75e7ff" stroke-width="2.800"/>`;
const LENS = `<circle cx="13.500" cy="17.500" r="3.600" fill="#c9f6ff"/>`;
const FOOT = `<path d="M13.500 25v6M8 31h11" stroke="#75e7ff" stroke-width="2.800"/>`;
const frame = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">${inner}</g>
</svg>`;
const ICON = frame(FOOT + BODY + LENS);
/**
 * La même caméra quand sa vue est connue : son champ s'ouvre devant elle, plein. C'est elle
 * qui offre « Vue caméra » — se tenir à sa place, son image posée sur le relief.
 */
const ICON_VIEW = frame(`<path d="M24 17.500 34 9v17Z" fill="#75e7ff" stroke="#75e7ff" stroke-width="1.600"/>` + FOOT + BODY + LENS);

const ICONS = {
  plain: { idle: tinted(ICON, TINT_IDLE), active: tinted(ICON, TINT_ACTIVE) },
  view: { idle: tinted(ICON_VIEW, TINT_IDLE), active: tinted(ICON_VIEW, TINT_ACTIVE) },
};

export const cameraMarkerStyle: OverlayStyle<CameraFeature> = {
  className: 'overlay-cameras',
  maxVisible: 64,
  detailDistance: 6000,
  footprint: () => ({ width: 22, height: 22 }),
  create() {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'scan-marker camera-marker';
    element.innerHTML =
      '<img class="scan-marker-icon" alt="" width="18" height="18" />'
      + '<span class="camera-card"><img alt="" width="96" height="54" /></span>'
      + '<span class="scan-caption"><b>Caméra</b><span></span></span>';
    return element;
  },
  paint(element, camera, { active, detailed }) {
    const [icon, card, caption] = element.children as unknown as [HTMLImageElement, HTMLElement, HTMLElement];
    const thumbnail = card.firstElementChild as HTMLImageElement;
    element.setAttribute('aria-label', `Caméra ${camera.label}`);
    element.classList.toggle('active', active);
    const icons = camera.view ? ICONS.view : ICONS.plain;
    icon.src = active ? icons.active : icons.idle;
    // une caméra qui a sa vue se distingue de loin : icône plus grande, anneau d'accent
    element.classList.toggle('has-view', camera.view);
    icon.width = icon.height = camera.view ? 26 : 18;
    caption.firstElementChild!.textContent = camera.view ? 'Caméra · vue' : 'Caméra';
    caption.lastElementChild!.textContent = camera.label;
    // de loin, des centaines de légendes se recouvriraient : seule la caméra sélectionnée garde la sienne
    caption.hidden = !detailed && !active;
    // la caméra active n'a pas de vignette : son image est dans le panneau
    card.hidden = !detailed || active;
    if (!card.hidden) thumbnail.src = camera.thumbnail;
  },
};
