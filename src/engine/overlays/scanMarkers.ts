/**
 * Marqueurs de l'imagerie aérienne et des objets scannés : ils disent où un
 * lieu a été reconstruit, où un objet a été relevé, et un toucher y emmène.
 * Même mécanique et mêmes teintes que les caméras ; le nom reste affiché sous
 * l'icône. Quand plusieurs marqueurs se recouvriraient à l'écran, un seul les
 * représente et porte leur nombre.
 */

import { t } from '../../i18n/index.ts';
import { VIDEOS_LABEL } from '../../domain/videos.ts';
import { AERIAL_LABEL, ART_LABEL, BACKED_LABEL, CLOUD_LABEL, FUN_LABEL, OBJECTS_LABEL, ORTHO_LABEL, SURVIVAL_LABEL } from '../../domain/scans.ts';
import { DRONES_LABEL } from '../../domain/droneFlights.ts';
import { SPORTS_LABEL } from '../../domain/sports.ts';
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

/** Équipement de survie : le cœur barré d'un éclair, pictogramme des défibrillateurs. */
const SURVIVAL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M18 30.500C8.500 24 5 19.500 5 14.200 5 10.300 8 7.500 11.500 7.500c2.600 0 4.900 1.400 6.500 3.800 1.600-2.400 3.900-3.800 6.500-3.800C28 7.500 31 10.300 31 14.200c0 5.300-3.500 9.800-13 16.300Z" fill="#0e1720" stroke="#75e7ff" stroke-width="1.500"/>
    <path d="M19.800 11.500 14.200 19h4.300l-2 6.500 6.300-8.300h-4.500Z" fill="#c9f6ff" stroke="#dbfbff" stroke-width="0.700"/>
  </g>
</svg>`;

/** Fun : une manette — la croix d'un côté, deux boutons de l'autre. */
const FUN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M11 11h14a7 7 0 0 1 6.900 5.800l1.300 7.400a3.300 3.300 0 0 1-5.700 2.700L24.500 23h-13l-3 3.900a3.300 3.300 0 0 1-5.700-2.700l1.300-7.400A7 7 0 0 1 11 11Z" fill="#0e1720" stroke="#75e7ff" stroke-width="1.500"/>
    <path d="M12 14.500v5M9.500 17h5" stroke="#c9f6ff" stroke-width="1.500"/>
    <circle cx="22.500" cy="18.300" r="1.300" fill="#c9f6ff" stroke="#dbfbff" stroke-width="0.600"/>
    <circle cx="26" cy="15.700" r="1.300" fill="#c9f6ff" stroke="#dbfbff" stroke-width="0.600"/>
  </g>
</svg>`;

/** Street art : une bombe de peinture, et son jet. */
const ART_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    <rect x="10" y="14" width="12" height="17" rx="2.500" fill="#0e1720" stroke="#75e7ff" stroke-width="1.500"/>
    <path d="M12.500 14v-2.500a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V14" stroke="#75e7ff" stroke-width="1.400"/>
    <rect x="14.200" y="6" width="3.600" height="3.500" rx="0.800" fill="#c9f6ff" stroke="#dbfbff" stroke-width="0.600"/>
    <path d="M10 20h12" stroke="#4ecde7" stroke-width="1"/>
    <path d="M21.500 7.500h.01M25 5.500h.01M25 9.500h.01M28.500 3.500h.01M28.500 7.500h.01M28.500 11.500h.01" stroke="#c9f6ff" stroke-width="1.800"/>
  </g>
</svg>`;

/**
 * Objet posé dans la carte : son marqueur, une fois touché, change de visage — un œil sur le volume — et dit
 * qu'un second toucher ouvre la visionneuse.
 */
const VIEW_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M18 4 29 10v8.5l-11 6-11-6V10Z" fill="#0e1720" stroke="#75e7ff" stroke-width="1.4"/>
    <path d="M7 10l11 6 11-6M18 16v8.5" stroke="#75e7ff" stroke-width="1.1"/>
    <path d="M5 28.5c3.2-4.2 7.6-6.3 13-6.3s9.8 2.1 13 6.3c-3.2 4.2-7.6 6.3-13 6.3S8.2 32.7 5 28.5Z" fill="#0e1720" stroke="#c9f6ff" stroke-width="1.4"/>
    <circle cx="18" cy="28.5" r="3" fill="#c9f6ff" stroke="#dbfbff" stroke-width="0.6"/>
  </g>
</svg>`;
const VIEW_KICKER = 'marker.view';

/** Clef de traduction d'une légende au pluriel (`{{count}} lieux`…). */
type PluralKey = 'marker.orthophotos' | 'marker.clouds' | 'marker.sequences' | 'marker.flights' | 'marker.videos' | 'marker.places' | 'marker.objects' | 'marker.equipment' | 'marker.projects' | 'marker.artworks';

interface MarkerKind {
  className: string;
  /** Clef de traduction du genre affiché en tête de légende. */
  kicker: typeof AERIAL_LABEL | typeof ART_LABEL | typeof BACKED_LABEL | typeof CLOUD_LABEL | typeof FUN_LABEL | typeof OBJECTS_LABEL | typeof ORTHO_LABEL | typeof SURVIVAL_LABEL | typeof VIDEOS_LABEL | typeof DRONES_LABEL | typeof SPORTS_LABEL;
  /** Clef de la légende d'un marqueur qui rassemble plusieurs éléments. */
  plural: PluralKey;
  icon: string;
  /** Un objet posé dans la carte : touché, son marqueur propose d'ouvrir la visionneuse. */
  placed?: boolean;
}

function scanMarker({ className, kicker, plural, icon, placed = false }: MarkerKind): OverlayStyle<ScanFeature> {
  const idle = tinted(icon, TINT_IDLE);
  const lit = tinted(placed ? VIEW_ICON : icon, TINT_ACTIVE);
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
        + '<span class="scan-caption"><b></b><span></span></span>';
      return element;
    },
    paint(element, scan, { active, members }) {
      const [image, badge, caption] = element.children as unknown as [HTMLImageElement, HTMLElement, HTMLElement];
      const label = members.length > 1 ? t(plural, { count: members.length }) : scan.label;
      // un objet posé dans la carte, une fois touché : le marqueur devient le bouton de sa visionneuse
      const heading = t(active && placed && members.length === 1 ? VIEW_KICKER : kicker);
      element.setAttribute('aria-label', `${heading} : ${label}`);
      element.classList.toggle('active', active);
      image.src = active ? lit : idle;
      badge.hidden = members.length < 2;
      badge.textContent = String(members.length);
      caption.firstElementChild!.textContent = heading;
      caption.lastElementChild!.textContent = label;
    },
  };
}

/** Ortho drone : une image à plat, vue du dessus, avec sa mire. */
const ORTHO_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M18 7 31 14 18 21 5 14Z" fill="#0e1720" stroke="#75e7ff" stroke-width="1.4"/>
    <path d="M5 20l13 7 13-7" stroke="#4ecde7" stroke-width="1.1"/>
    <path d="M11.5 14 18 10.5 24.5 14 18 17.5Z" stroke="#75e7ff" stroke-width="1"/>
    <circle cx="18" cy="14" r="1.6" fill="#c9f6ff" stroke="#dbfbff" stroke-width="0.6"/>
  </g>
</svg>`;

/** Nuage de points : des points épars qui dessinent un volume. */
const CLOUD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <rect x="5" y="5" width="26" height="26" rx="4" fill="#0e1720" stroke="#75e7ff" stroke-width="1.4"/>
  <g fill="#c9f6ff">
    <circle cx="18" cy="9.500" r="1.900"/><circle cx="11" cy="13.500" r="1.900"/><circle cx="25" cy="13.500" r="1.900"/>
    <circle cx="18" cy="18" r="2.900"/><circle cx="11" cy="22.500" r="2.300"/><circle cx="25" cy="22.500" r="2.300"/><circle cx="18" cy="26.500" r="2.600"/>
  </g>
</svg>`;

export const orthoMarkerStyle = scanMarker({
  className: 'overlay-orthophoto', kicker: ORTHO_LABEL, plural: 'marker.orthophotos', icon: ORTHO_ICON,
});

export const cloudMarkerStyle = scanMarker({
  className: 'overlay-clouds', kicker: CLOUD_LABEL, plural: 'marker.clouds', icon: CLOUD_ICON,
});

/** Sports : un haltère, deux disques pleins sur leur barre. */
const SPORTS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M4 18h28" stroke="#75e7ff" stroke-width="2.400"/>
    <rect x="7" y="9" width="5.500" height="18" rx="2" fill="#0e1720" stroke="#75e7ff" stroke-width="2.400"/>
    <rect x="23.500" y="9" width="5.500" height="18" rx="2" fill="#0e1720" stroke="#75e7ff" stroke-width="2.400"/>
    <path d="M14.500 18h7" stroke="#c9f6ff" stroke-width="3.200"/>
  </g>
</svg>`;

export const sportsMarkerStyle = scanMarker({
  className: 'overlay-sports', kicker: SPORTS_LABEL, plural: 'marker.sequences', icon: SPORTS_ICON,
});

/** Vol de drone : le drone vu du dessus — un corps, quatre rotors pleins. */
const DRONE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M10 10 26 26M26 10 10 26" stroke="#75e7ff" stroke-width="2.600"/>
    <circle cx="9" cy="9" r="5" fill="#0e1720" stroke="#75e7ff" stroke-width="2.200"/><circle cx="27" cy="9" r="5" fill="#0e1720" stroke="#75e7ff" stroke-width="2.200"/>
    <circle cx="9" cy="27" r="5" fill="#0e1720" stroke="#75e7ff" stroke-width="2.200"/><circle cx="27" cy="27" r="5" fill="#0e1720" stroke="#75e7ff" stroke-width="2.200"/>
    <rect x="13.500" y="12" width="9" height="12" rx="3" fill="#c9f6ff"/>
  </g>
</svg>`;

export const droneMarkerStyle = scanMarker({
  className: 'overlay-drones', kicker: DRONES_LABEL, plural: 'marker.flights', icon: DRONE_ICON,
});

/** Un écran et son triangle de lecture : la vidéo se regarde ailleurs, ce marqueur dit seulement où elle a été tournée. */
const VIDEO_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <circle cx="18" cy="18" r="16" fill="#0e1720" fill-opacity="0.92" stroke="#75e7ff" stroke-width="1.600"/>
  <rect x="8.500" y="11.500" width="19" height="13" rx="3.600" fill="none" stroke="#75e7ff" stroke-width="2"/>
  <path d="M16 15.200v5.600l5-2.800z" fill="#c9f6ff"/>
</svg>`;

export const videoMarkerStyle = scanMarker({
  className: 'overlay-videos', kicker: VIDEOS_LABEL, plural: 'marker.videos', icon: VIDEO_ICON,
});

export const aerialMarkerStyle = scanMarker({
  className: 'overlay-scans', kicker: AERIAL_LABEL, plural: 'marker.places', icon: AERIAL_ICON,
});

export const objectMarkerStyle = scanMarker({
  className: 'overlay-objects', kicker: OBJECTS_LABEL, plural: 'marker.objects', icon: OBJECT_ICON, placed: true,
});

export const survivalMarkerStyle = scanMarker({
  className: 'overlay-survival', kicker: SURVIVAL_LABEL, plural: 'marker.equipment', icon: SURVIVAL_ICON, placed: true,
});

export const funMarkerStyle = scanMarker({
  className: 'overlay-fun', kicker: FUN_LABEL, plural: 'marker.objects', icon: FUN_ICON, placed: true,
});

/** Soutenu par la Wallonie : un écusson, et dedans la poignée de main réduite à deux traits qui se croisent. */
const BACKED_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M18 4.500 29 8.500v8.500c0 7-4.600 11.800-11 14.500C11.600 28.800 7 24 7 17V8.500Z" fill="#0e1720" stroke="#75e7ff" stroke-width="2.200"/>
    <path d="m12.500 17.500 4 4 7.500-8" stroke="#c9f6ff" stroke-width="2.800"/>
  </g>
</svg>`;

export const backedMarkerStyle = scanMarker({
  className: 'overlay-backed', kicker: BACKED_LABEL, plural: 'marker.projects', icon: BACKED_ICON, placed: true,
});

export const artMarkerStyle = scanMarker({
  className: 'overlay-art', kicker: ART_LABEL, plural: 'marker.artworks', icon: ART_ICON, placed: true,
});
