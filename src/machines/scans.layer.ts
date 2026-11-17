/**
 * Les deux calques tirés du manifeste des scans, décrits pour l'état générique
 * des calques à sélection.
 *
 *   - « Imagerie aérienne » : les lieux filmés au drone et reconstruits en volume.
 *     En sélectionner un le dessine dans la carte et ouvre son panneau ; on peut
 *     l'y garder affiché pendant que l'on en regarde un autre.
 *   - « Objets scannés » : les objets relevés de près. En toucher un l'ouvre dans
 *     sa visionneuse ; ceux d'un même marqueur s'y feuillettent.
 *   - « Équipements de survie » : parmi ces objets, ceux qui peuvent sauver une
 *     vie, signalés à part.
 *
 * Chaque scan a son marqueur. Quand plusieurs se recouvrent à l'écran, c'est la
 * carte qui les rassemble sous un seul, avec leur nombre.
 */

import { cloudScans, isArtScan, isBackedScan, isFunScan, isObjectScan, isSurvivalScan, orthophotoScans, placeScans, type Scan } from '../domain/scans.ts';
import type { ScanFeature } from '../engine/overlays/scanMarkers.ts';
import { loadScans } from '../services/scans.ts';
import type { SportSequence } from '../domain/sports.ts';
import { loadSports } from '../services/sports.ts';
import type { DroneFlight } from '../domain/droneFlights.ts';
import { loadDroneFlights } from '../services/droneFlights.ts';
import type { SelectionLayerSpec } from './selectionLayer.machine.ts';

export const AERIAL_LAYER = 'scans';
export const OBJECTS_LAYER = 'objects';
export const SURVIVAL_LAYER = 'survival';
export const FUN_LAYER = 'fun';
export const ART_LAYER = 'art';
export const BACKED_LAYER = 'backed';
export const ORTHO_LAYER = 'orthophoto';
export const CLOUD_LAYER = 'clouds';
export const SPORTS_LAYER = 'sports';
export const DRONES_LAYER = 'drones';

/** Calques dont l'élément sélectionné est dessiné dans la carte, avec sa fiche dans le panneau « Imagerie ». */
export const DRAWN_LAYERS: readonly string[] = [AERIAL_LAYER, ORTHO_LAYER, CLOUD_LAYER];

/**
 * Éloignement sous lequel le marqueur d'un lieu dessiné s'efface : on a alors
 * le lieu lui-même sous les yeux, le marqueur ne ferait que le recouvrir.
 */
const MARKER_CLEARANCE = 1200;

const toFeature = (scan: Scan): ScanFeature =>
  ({ id: scan.id, x: scan.marker?.x ?? scan.x, y: scan.marker?.y ?? scan.y, label: scan.name, rank: 1 });

export const aerialLayer: SelectionLayerSpec<Scan> = {
  name: AERIAL_LAYER,
  load: async (signal) => placeScans(await loadScans(signal)),
  markers: (scans, { selectedId, keptIds }) => scans.map((scan): ScanFeature => ({
    ...toFeature(scan),
    // seul un lieu dessiné dans la carte — sélectionné ou gardé affiché — peut masquer son propre marqueur
    ...(scan.id === selectedId || keptIds.includes(scan.id) ? { minDistance: MARKER_CLEARANCE } : {}),
  })),
  // plusieurs lieux sous un même marqueur ne s'ouvrent pas ensemble : on s'en approche, et chacun retrouve le sien
  opensTogether: (members) => members.length === 1,
};

/**
 * Calques mis de côté pour l'instant : ils ne sont proposés nulle part — ni dans le panneau des calques,
 * ni dans le rail. Leurs données restent publiées ; il suffit de vider cette liste pour les rétablir.
 */
export const SHELVED_LAYERS: readonly string[] = ['orthophoto', 'clouds'];

/** Un calque dont les éléments se dessinent dans la carte, comme l'imagerie aérienne. */
const drawnLayer = (name: string, pick: (scans: readonly Scan[]) => Scan[]): SelectionLayerSpec<Scan> => ({
  ...aerialLayer,
  name,
  // un calque mis de côté n'a rien à montrer : il n'est alors pas proposé du tout
  load: async (signal) => (SHELVED_LAYERS.includes(name) ? [] : pick(await loadScans(signal))),
});

/**
 * Ortho drone : des prises de vue faites à la verticale, redressées et posées sur le relief.
 * Ce ne sont pas les orthophotos de la Wallonie, qui habillent le relief : celles-ci viennent
 * d'un vol précis, et ont leurs marqueurs comme tout autre relevé.
 */
export const orthoLayer = drawnLayer(ORTHO_LAYER, orthophotoScans);

/** Nuages de points : ce que la reconstruction a retrouvé dans les images, avant d'en faire des gaussian splats. */
export const cloudLayer = drawnLayer(CLOUD_LAYER, cloudScans);

export const objectsLayer: SelectionLayerSpec<Scan> = {
  name: OBJECTS_LAYER,
  load: async (signal) => (await loadScans(signal)).filter((scan) => isObjectScan(scan) && !isBackedScan(scan) && !isSurvivalScan(scan) && !isFunScan(scan) && !isArtScan(scan)),
  markers: (scans) => scans.map(toFeature),
};

/**
 * Équipements de survie : les objets relevés qui peuvent sauver une vie — les défibrillateurs d'abord.
 * Même mécanique que les objets scannés, mais un calque à eux : on doit pouvoir les voir seuls.
 */
export const survivalLayer: SelectionLayerSpec<Scan> = {
  name: SURVIVAL_LAYER,
  load: async (signal) => (await loadScans(signal)).filter(isSurvivalScan),
  markers: (scans) => scans.map(toFeature),
};

/**
 * Fun : les objets relevés pour le plaisir — une borne d'arcade pour commencer.
 * Même mécanique encore, et un calque à eux.
 */
export const funLayer: SelectionLayerSpec<Scan> = {
  name: FUN_LAYER,
  load: async (signal) => (await loadScans(signal)).filter(isFunScan),
  markers: (scans) => scans.map(toFeature),
};

/** Projets soutenus par la Wallonie : même mécanique que les objets scannés, et un calque à eux. */
export const backedLayer: SelectionLayerSpec<Scan> = {
  name: BACKED_LAYER,
  load: async (signal) => (await loadScans(signal)).filter(isBackedScan),
  markers: (scans) => scans.map(toFeature),
};

/**
 * Street art : fresques, lettrages et détails peints relevés dans la rue.
 * Même mécanique toujours, et un calque à eux.
 */
export const artLayer: SelectionLayerSpec<Scan> = {
  name: ART_LAYER,
  load: async (signal) => (await loadScans(signal)).filter(isArtScan),
  markers: (scans) => scans.map(toFeature),
};

/** Sports : des séquences filmées, chacune à l'endroit où elle a été tournée. */
export const sportsLayer: SelectionLayerSpec<SportSequence> = {
  name: SPORTS_LAYER,
  load: (signal) => loadSports(signal),
  markers: (items) => items.map((item): ScanFeature => ({ id: item.id, x: item.x, y: item.y, label: item.name, rank: 1 })),
  opensTogether: (members) => members.length === 1,
};

/** Vols de drone : chacun a son marqueur à son point de départ ; allumé, le calque les montre tous en vol. */
export const dronesLayer: SelectionLayerSpec<DroneFlight> = {
  name: DRONES_LAYER,
  load: (signal) => loadDroneFlights(signal),
  markers: (items) => items.map((item): ScanFeature => ({ id: item.id, x: item.x, y: item.y, label: item.name, rank: 1 })),
  opensTogether: (members) => members.length === 1,
};

/** Lieux à dessiner dans la carte : celui qui est sélectionné, et ceux que le visiteur garde affichés. */
export function drawnScans(selection: Scan | null, kept: readonly Scan[]): Scan[] {
  return selection && !kept.includes(selection) ? [...kept, selection] : [...kept];
}
