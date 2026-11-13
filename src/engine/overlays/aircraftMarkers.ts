/**
 * Marqueurs des avions : une silhouette orientée sur la route de l'appareil,
 * son indicatif et son altitude. Mêmes teintes que les autres marqueurs —
 * repos cyan, sélection dorée — ; la silhouette est redessinée à chaque image,
 * car son orientation à l'écran dépend aussi du cap de la vue.
 */

import type { Attitude } from '../../domain/airframes.ts';
import type { OverlayFeature, OverlayStyle } from '../OverlayLayer.ts';
import { TINT_ACTIVE, TINT_IDLE, tinted } from './tint.ts';

export interface AircraftFeature extends OverlayFeature {
  /** Route suivie, en degrés depuis le nord. */
  track: number;
  /** Ce qu'il faut à la maquette en volume (`AircraftLayer`) : cellule, assiette, taux de virage. */
  airframe: string;
  attitude: Attitude;
  turnRate: number;
  /** Seconde ligne de l'étiquette : l'altitude, ou « au sol ». */
  detail: string;
}

/** Silhouette vue du dessus, nez vers le haut. */
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <path d="M18 3c1.3 0 2.1 1.6 2.1 3.6v6.9l11.4 7v3l-11.4-3.4v6.5l3.3 2.5v2.4L18 30l-5.4 1.5v-2.4l3.3-2.5v-6.5L4.500 23.500v-3l11.400-7V6.600C15.900 4.600 16.700 3 18 3Z"
    fill="#0e1720" stroke="#75e7ff" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

const ICON_IDLE = tinted(ICON, TINT_IDLE);
const ICON_ACTIVE = tinted(ICON, TINT_ACTIVE);

export const aircraftMarkerStyle: OverlayStyle<AircraftFeature> = {
  className: 'overlay-aircraft',
  maxVisible: 90,
  detailDistance: Infinity,
  footprint: () => ({ width: 34, height: 34 }),
  create() {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'aircraft-marker';
    element.innerHTML =
      '<img class="aircraft-marker-icon" alt="" width="26" height="26" />'
      + '<span class="aircraft-caption"><b></b><span></span></span>';
    return element;
  },
  paint(element, aircraft, { active }) {
    const [icon, caption] = element.children as unknown as [HTMLImageElement, HTMLElement];
    const [callsign, detail] = caption.children as unknown as [HTMLElement, HTMLElement];
    element.setAttribute('aria-label', `Avion ${aircraft.label}, ${aircraft.detail}`);
    element.classList.toggle('active', active);
    icon.src = active ? ICON_ACTIVE : ICON_IDLE;
    callsign.textContent = aircraft.label;
    detail.textContent = aircraft.detail;
  },
  orient(element, aircraft, frame) {
    // à l'écran, le nord est tourné du cap de la vue : la silhouette suit sa route réelle
    const icon = element.firstElementChild as HTMLElement;
    const rotation = Math.round(aircraft.track - frame.azimuth);
    if (icon.dataset.rotation !== String(rotation)) {
      icon.dataset.rotation = String(rotation);
      icon.style.transform = `rotate(${rotation}deg)`;
    }
  },
};
