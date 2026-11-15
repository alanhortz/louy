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

import { isFunScan, isObjectScan, isSurvivalScan, placeScans, type Scan } from '../domain/scans.ts';
import type { ScanFeature } from '../engine/overlays/scanMarkers.ts';
import { loadScans } from '../services/scans.ts';
import type { SelectionLayerSpec } from './selectionLayer.machine.ts';

export const AERIAL_LAYER = 'scans';
export const OBJECTS_LAYER = 'objects';
export const SURVIVAL_LAYER = 'survival';
export const FUN_LAYER = 'fun';

/**
 * Éloignement sous lequel le marqueur d'un lieu dessiné s'efface : on a alors
 * le lieu lui-même sous les yeux, le marqueur ne ferait que le recouvrir.
 */
const MARKER_CLEARANCE = 1200;

const toFeature = (scan: Scan): ScanFeature => ({ id: scan.id, x: scan.x, y: scan.y, label: scan.name, rank: 1 });

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

export const objectsLayer: SelectionLayerSpec<Scan> = {
  name: OBJECTS_LAYER,
  load: async (signal) => (await loadScans(signal)).filter((scan) => isObjectScan(scan) && !isSurvivalScan(scan) && !isFunScan(scan)),
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

/** Lieux à dessiner dans la carte : celui qui est sélectionné, et ceux que le visiteur garde affichés. */
export function drawnScans(selection: Scan | null, kept: readonly Scan[]): Scan[] {
  return selection && !kept.includes(selection) ? [...kept, selection] : [...kept];
}
