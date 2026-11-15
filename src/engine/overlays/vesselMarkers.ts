/**
 * Marqueurs des bateaux : la zone de toucher et l'étiquette — longueur du
 * bateau, et ce qu'il fait. La coque elle-même est dessinée en volume par
 * `VesselLayer`. Mêmes teintes que les autres marqueurs.
 */

import type { OverlayFeature, OverlayStyle } from '../OverlayLayer.ts';

export interface VesselFeature extends OverlayFeature {
  /** Route suivie, en degrés depuis le nord. */
  course: number;
  /** Dimensions de la coque en volume, en mètres. */
  length: number;
  beam: number;
  moving: boolean;
  /** Seconde ligne de l'étiquette : ce que fait le bateau. */
  detail: string;
}

export const vesselMarkerStyle: OverlayStyle<VesselFeature> = {
  className: 'overlay-vessels',
  maxVisible: 120,
  detailDistance: Infinity,
  footprint: () => ({ width: 30, height: 30 }),
  create() {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'vessel-marker';
    element.innerHTML = '<span class="vessel-caption"><b></b><span></span></span>';
    return element;
  },
  paint(element, vessel, { active }) {
    const [length, detail] = (element.firstElementChild as HTMLElement).children as unknown as [HTMLElement, HTMLElement];
    element.setAttribute('aria-label', `Bateau, ${vessel.label}, ${vessel.detail}`);
    element.classList.toggle('active', active);
    element.classList.toggle('moving', vessel.moving);
    length.textContent = vessel.label;
    detail.textContent = vessel.detail;
  },
};
