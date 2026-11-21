/**
 * Rail de navigation : une colonne d'icônes toujours visible,
 * qui ouvre un panneau à la fois. Le principe (barre d'activité : icônes
 * permanentes, une seule section affichée, l'icône active marque la position)
 * vient de l'interface de process-cartography-ai ; l'habillage reste celui de
 * L'Oûy.
 */

import {
  Cog6ToothIcon, GlobeEuropeAfricaIcon, InformationCircleIcon, LifebuoyIcon, PaperAirplaneIcon, PhotoIcon, PlayCircleIcon, Square3Stack3DIcon, SwatchIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType, SVGProps } from 'react';
import type { PanelId } from '../machines/chrome.machine.ts';
import { DroneIcon } from './components/DroneIcon.tsx';
import { PointCloudIcon } from './components/PointCloudIcon.tsx';

export interface RailItem {
  panel: PanelId;
  /** Clef de traduction du nom lu par les lecteurs d'écran et montré en infobulle : l'icône ne suffit jamais seule. */
  label: `rail.${PanelId}`;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

export const RAIL_ITEMS: readonly RailItem[] = [
  { panel: 'layers', label: 'rail.layers', Icon: Square3Stack3DIcon },
  { panel: 'render', label: 'rail.render', Icon: SwatchIcon },
  { panel: 'camera', label: 'rail.camera', Icon: VideoCameraIcon },
  { panel: 'imagery', label: 'rail.imagery', Icon: PhotoIcon },
  { panel: 'orthophoto', label: 'rail.orthophoto', Icon: GlobeEuropeAfricaIcon },
  { panel: 'clouds', label: 'rail.clouds', Icon: PointCloudIcon },
  { panel: 'drones', label: 'rail.drones', Icon: DroneIcon },
  { panel: 'videos', label: 'rail.videos', Icon: PlayCircleIcon },
  { panel: 'aircraft', label: 'rail.aircraft', Icon: PaperAirplaneIcon },
  { panel: 'vessels', label: 'rail.vessels', Icon: LifebuoyIcon },
  { panel: 'settings', label: 'rail.settings', Icon: Cog6ToothIcon },
  { panel: 'about', label: 'rail.about', Icon: InformationCircleIcon },
];
