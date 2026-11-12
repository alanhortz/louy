/**
 * Rail de navigation : une colonne d'icônes toujours visible,
 * qui ouvre un panneau à la fois. Le principe (barre d'activité : icônes
 * permanentes, une seule section affichée, l'icône active marque la position)
 * vient de l'interface de process-cartography-ai ; l'habillage reste celui de
 * L'Oûy.
 */

import {
  HandRaisedIcon, InformationCircleIcon, Square3Stack3DIcon, SwatchIcon, VideoCameraIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType, SVGProps } from 'react';
import type { PanelId } from '../machines/chrome.machine.ts';

export interface RailItem {
  panel: PanelId;
  /** Nom lu par les lecteurs d'écran et montré en infobulle : l'icône ne suffit jamais seule. */
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

export const RAIL_ITEMS: readonly RailItem[] = [
  { panel: 'layers', label: 'Calques', Icon: Square3Stack3DIcon },
  { panel: 'render', label: 'Rendu', Icon: SwatchIcon },
  { panel: 'controls', label: 'Navigation', Icon: HandRaisedIcon },
  { panel: 'camera', label: 'Caméras', Icon: VideoCameraIcon },
  { panel: 'about', label: 'À propos', Icon: InformationCircleIcon },
];
