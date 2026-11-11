/**
 * Marqueurs des caméras routières.
 *
 * L'icône, ses teintes (repos `#6be8ff`, active `#ffd97a` agrandie ×1,25) et la
 * vignette (96×54 px sous un filet cyan, titre en capitales tronqué à 15
 * caractères) reprennent God's Eye View — © 2026 Bilawal Sidhu, licence MIT.
 */

import type { OverlayFeature, OverlayStyle } from '../OverlayLayer.ts';

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

/**
 * Teinte multiplicative, comme le fait un billboard : chaque couleur de l'icône
 * est multipliée, canal par canal, par la teinte demandée.
 */
function tinted(svg: string, tint: string): string {
  const channels = [1, 3, 5].map((at) => parseInt(tint.slice(at, at + 2), 16) / 255);
  const multiplied = svg.replace(/#([0-9a-f]{6})\b/gi, (_, hex: string) =>
    `#${channels
      .map((channel, k) => Math.round(parseInt(hex.slice(k * 2, k * 2 + 2), 16) * channel))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')}`);
  return `data:image/svg+xml;base64,${btoa(multiplied)}`;
}

const ICON_IDLE = tinted(ICON, '#6be8ff');
const ICON_ACTIVE = tinted(ICON, '#ffd97a');
const CARD_TITLE_LENGTH = 15;

export const cameraMarkerStyle: OverlayStyle<CameraFeature> = {
  className: 'overlay-cameras',
  maxVisible: 64,
  detailDistance: 6000,
  footprint: () => ({ width: 30, height: 30 }),
  create() {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'camera-marker';
    element.innerHTML =
      '<img class="camera-marker-icon" alt="" width="24" height="24" />'
      + '<span class="camera-card"><img alt="" width="96" height="54" /><span></span></span>';
    return element;
  },
  paint(element, camera, { active, detailed }) {
    const [icon, card] = element.children as unknown as [HTMLImageElement, HTMLElement];
    const [thumbnail, title] = card.children as unknown as [HTMLImageElement, HTMLElement];
    element.setAttribute('aria-label', `Caméra ${camera.label}`);
    element.classList.toggle('active', active);
    icon.src = active ? ICON_ACTIVE : ICON_IDLE;
    title.textContent = camera.label.toUpperCase().slice(0, CARD_TITLE_LENGTH);
    // la caméra active n'a pas de vignette : son image est dans le panneau
    card.hidden = !detailed || active;
    if (!card.hidden) thumbnail.src = camera.thumbnail;
  },
};
