/**
 * Le calque « Imagerie 3D », décrit pour l'état générique des calques à
 * sélection : sa liste vient du manifeste des scans, chaque lieu a son marqueur,
 * et les objets trop proches pour être distingués à l'écran en partagent un,
 * qui porte leur nombre.
 */

import { groupScans, isObjectScan, scanGroupRadius, type Scan } from '../domain/scans.ts';
import type { ScanFeature } from '../engine/overlays/scanMarkers.ts';
import { loadScans } from '../services/scans.ts';
import type { LayerView, SelectionLayerSpec } from './selectionLayer.machine.ts';

export const SCANS_LAYER = 'scans';

/**
 * Éloignement sous lequel le marqueur d'un lieu dessiné s'efface : on a alors
 * le lieu lui-même sous les yeux, le marqueur ne ferait que le recouvrir.
 */
const MARKER_CLEARANCE = 1200;

const groups = (scans: readonly Scan[], { distance }: LayerView): Scan[][] => groupScans(scans, scanGroupRadius(distance));

/** Un groupe qui mêle un lieu à d'autres scans ne s'ouvre pas : on s'en approche, et il se défait. */
const isMixed = (group: readonly Scan[]): boolean => group.length > 1 && group.some((scan) => !isObjectScan(scan));

/**
 * Marqueur d'un groupe de scans voisins : posé au milieu d'eux, il porte leur
 * nombre et l'identifiant du premier. Seul, un scan garde son nom.
 */
const toFeature = (group: readonly Scan[], view: LayerView): ScanFeature => {
  const [first] = group as [Scan];
  if (group.length === 1) {
    return {
      id: first.id, x: first.x, y: first.y, label: first.name, rank: 1,
      // seul un lieu dessiné dans la carte — le lieu sélectionné — peut masquer son propre marqueur
      ...(!isObjectScan(first) && first.id === view.selectedId ? { minDistance: MARKER_CLEARANCE } : {}),
    };
  }
  return {
    id: first.id,
    x: Math.round(group.reduce((sum, scan) => sum + scan.x, 0) / group.length),
    y: Math.round(group.reduce((sum, scan) => sum + scan.y, 0) / group.length),
    label: isMixed(group) ? `${group.length} lieux et objets en 3D` : `${group.length} objets en 3D`,
    rank: 1,
    count: group.length,
  };
};

export const scansLayer: SelectionLayerSpec<Scan> = {
  name: SCANS_LAYER,
  load: loadScans,
  markers: (scans, view) => groups(scans, view).map((group) => toFeature(group, view)),
  members: (scans, markerId, view) => groups(scans, view).find((group) => group[0]!.id === markerId) ?? [],
  expands: (scans, markerId, view) => isMixed(groups(scans, view).find((group) => group[0]!.id === markerId) ?? []),
};

/** Lieux à dessiner dans la carte pour une sélection donnée : le lieu sélectionné, s'il y en a un. */
export const drawnScans = (selection: Scan | null): Scan[] => (selection && !isObjectScan(selection) ? [selection] : []);
