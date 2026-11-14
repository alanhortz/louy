/**
 * Acteur du moteur de rendu : la passerelle entre la machine `viewer` et la
 * boucle d'images. Il crée le moteur sur le canvas fourni, traduit les
 * commandes reçues en appels de méthode, et renvoie ce que le moteur observe.
 */

import { fromCallback } from 'xstate';
import { EDGE_PREFIX, TILE_ENDPOINT } from '../../config/project.ts';
import type { QualityProfile } from '../../domain/quality.ts';
import type { ScanProgress } from '../../engine/SplatLayer.ts';
import type { Scan } from '../../domain/scans.ts';
import type { SceneSource } from '../../domain/scene.ts';
import { directTileUrl, edgeTileUrl } from '../../domain/tiles.ts';
import type { Pose } from '../../domain/view.ts';
import type { OverlayFeature } from '../../engine/OverlayLayer.ts';
import type { AircraftModel } from '../../engine/AircraftLayer.ts';
import { aircraftMarkerStyle } from '../../engine/overlays/aircraftMarkers.ts';
import { cameraMarkerStyle } from '../../engine/overlays/cameraMarkers.ts';
import { placeLabelStyle } from '../../engine/overlays/placeLabels.ts';
import { scanMarkerStyle } from '../../engine/overlays/scanMarkers.ts';
import { SceneEngine, type Altimeter, type Flyover, type FollowTarget } from '../../engine/SceneEngine.ts';

export type OverlayName = 'places' | 'cameras' | 'scans' | 'aircraft';

export interface ViewerMount {
  canvas: HTMLCanvasElement;
  overlayRoot: HTMLElement;
  altimeter: Altimeter;
}

/** Commandes adressées au moteur. */
export type EngineCommand =
  | { type: 'viewer.sceneChanged'; source: SceneSource }
  | { type: 'viewer.overlayChanged'; layer: OverlayName; features: OverlayFeature[] }
  | { type: 'viewer.overlayActivated'; layer: OverlayName; id: string | null }
  | { type: 'viewer.scansChanged'; scans: Scan[] }
  | { type: 'viewer.poseApplied'; pose: Pose; sharpen?: boolean }
  | { type: 'viewer.flyoverRequested'; flyover: Flyover }
  | { type: 'viewer.orbitStopped' }
  | { type: 'viewer.followChanged'; target: FollowTarget | null }
  | { type: 'viewer.poseCaptureRequested' };

/** Ce que le moteur rapporte. */
export type EngineReport =
  | { type: 'engine.ready' }
  | { type: 'engine.failed'; reason: string }
  | { type: 'engine.viewSettled'; pose: Pose }
  | { type: 'engine.poseCaptured'; pose: Pose }
  | { type: 'engine.activityChanged'; loading: boolean; points: number }
  | { type: 'engine.orbitEnded' }
  | { type: 'engine.scanProgressed'; id: string; phase: ScanProgress['phase']; fraction: number }
  | { type: 'engine.followEnded' }
  | { type: 'engine.overlayPicked'; layer: OverlayName; id: string }
  | { type: 'engine.contextLost' }
  | { type: 'engine.contextRestored' };

export interface EngineInput {
  mount: ViewerMount;
  quality: QualityProfile;
  source: SceneSource;
  pose: Pose;
  sharpStart: boolean;
  orbitStart: boolean;
  overlays: Record<OverlayName, OverlayFeature[]>;
  active: Record<OverlayName, string | null>;
  scans: Scan[];
}

const OVERLAYS: readonly OverlayName[] = ['places', 'cameras', 'scans', 'aircraft'];

export const engineActor = fromCallback<EngineCommand, EngineInput, EngineReport>(
  ({ input, sendBack, receive }) => {
    let engine: SceneEngine;
    try {
      engine = new SceneEngine({
        ...input.mount,
        quality: input.quality,
        source: input.source,
        pose: input.pose,
        sharpStart: input.sharpStart,
        orbitStart: input.orbitStart,
        tileUrl: TILE_ENDPOINT === 'edge' ? edgeTileUrl(EDGE_PREFIX) : directTileUrl,
        listeners: {
          onReady: () => sendBack({ type: 'engine.ready' }),
          onViewSettled: (pose) => sendBack({ type: 'engine.viewSettled', pose }),
          onActivity: (activity) => sendBack({ type: 'engine.activityChanged', ...activity }),
          onOrbitEnded: () => sendBack({ type: 'engine.orbitEnded' }),
          onScanProgress: (progress) => sendBack({ type: 'engine.scanProgressed', ...progress }),
          onFollowEnded: () => sendBack({ type: 'engine.followEnded' }),
          onOverlayPicked: (layer, id) =>
            sendBack({ type: 'engine.overlayPicked', layer: layer as OverlayName, id }),
          onContextLost: () => sendBack({ type: 'engine.contextLost' }),
          onContextRestored: () => sendBack({ type: 'engine.contextRestored' }),
        },
      });
    } catch (error) {
      sendBack({ type: 'engine.failed', reason: error instanceof Error ? error.message : String(error) });
      return;
    }

    engine.addOverlay('places', placeLabelStyle);
    engine.addOverlay('cameras', cameraMarkerStyle);
    engine.addOverlay('scans', scanMarkerStyle);
    engine.addOverlay('aircraft', aircraftMarkerStyle);
    for (const layer of OVERLAYS) {
      engine.setOverlayFeatures(layer, input.overlays[layer]);
      engine.setOverlayActive(layer, input.active[layer]);
    }
    engine.setAircraftModels(input.overlays.aircraft as unknown as AircraftModel[]);
    engine.setAircraftActive(input.active.aircraft);
    engine.setScans(input.scans);

    receive((command) => {
      switch (command.type) {
        case 'viewer.sceneChanged': return engine.setSource(command.source);
        case 'viewer.overlayChanged':
          // les avions sont aussi dessinés en volume : leurs marqueurs n'en gardent que l'étiquette
          if (command.layer === 'aircraft') engine.setAircraftModels(command.features as unknown as AircraftModel[]);
          return engine.setOverlayFeatures(command.layer, command.features);
        case 'viewer.overlayActivated':
          if (command.layer === 'aircraft') engine.setAircraftActive(command.id);
          return engine.setOverlayActive(command.layer, command.id);
        case 'viewer.scansChanged': return engine.setScans(command.scans);
        case 'viewer.poseApplied': return engine.setPose(command.pose, { sharpen: command.sharpen });
        case 'viewer.flyoverRequested': return engine.flyOver(command.flyover);
        case 'viewer.orbitStopped': return engine.stopOrbit();
        case 'viewer.followChanged': return engine.follow(command.target);
        case 'viewer.poseCaptureRequested':
          return sendBack({ type: 'engine.poseCaptured', pose: engine.getPose() });
      }
    });

    return () => engine.dispose();
  },
);
