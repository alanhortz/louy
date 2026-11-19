/**
 * Rail de navigation : une colonne d'icônes toujours visible,
 * qui ouvre un panneau à la fois. Le principe (barre d'activité : icônes
 * permanentes, une seule section affichée, l'icône active marque la position)
 * vient de l'interface de process-cartography-ai ; l'habillage reste celui de
 * L'Oûy.
 */

import {
  Cog6ToothIcon, GlobeEuropeAfricaIcon, HandRaisedIcon, InformationCircleIcon, LifebuoyIcon, PaperAirplaneIcon, PhotoIcon, PlayCircleIcon, Square3Stack3DIcon, SwatchIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType, SVGProps } from 'react';
import type { PanelId } from '../machines/chrome.machine.ts';
import { DroneIcon } from './components/DroneIcon.tsx';
import { PointCloudIcon } from './components/PointCloudIcon.tsx';

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
  { panel: 'imagery', label: 'Imagerie', Icon: PhotoIcon },
  { panel: 'orthophoto', label: 'Ortho drone', Icon: GlobeEuropeAfricaIcon },
  { panel: 'clouds', label: 'Nuages de points', Icon: PointCloudIcon },
  { panel: 'drones', label: 'Vols de drone', Icon: DroneIcon },
  { panel: 'videos', label: 'Vidéos', Icon: PlayCircleIcon },
  { panel: 'aircraft', label: 'Avions', Icon: PaperAirplaneIcon },
  { panel: 'vessels', label: 'Bateaux', Icon: LifebuoyIcon },
  { panel: 'settings', label: 'Réglages', Icon: Cog6ToothIcon },
  { panel: 'about', label: 'À propos', Icon: InformationCircleIcon },
];
