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
import type { VesselModel } from '../../engine/VesselLayer.ts';
import type { TrajectoryPoint } from '../../engine/TrajectoryLayer.ts';
import { aircraftMarkerStyle } from '../../engine/overlays/aircraftMarkers.ts';
import { vesselMarkerStyle } from '../../engine/overlays/vesselMarkers.ts';
import { cameraMarkerStyle } from '../../engine/overlays/cameraMarkers.ts';
import { placeLabelStyle } from '../../engine/overlays/placeLabels.ts';
import { streetLabelStyle } from '../../engine/overlays/streetLabels.ts';
import { filmMarkerStyle } from '../../engine/overlays/filmMarkers.ts';
import { locationMarkerStyle } from '../../engine/overlays/locationMarker.ts';
import { roadShieldStyle } from '../../engine/overlays/roadShields.ts';
import { aerialMarkerStyle, artMarkerStyle, funMarkerStyle, objectMarkerStyle, survivalMarkerStyle } from '../../engine/overlays/scanMarkers.ts';
import { SceneEngine, type Altimeter, type Flyover, type FollowTarget } from '../../engine/SceneEngine.ts';

export type OverlayName = 'streets' | 'places' | 'cameras' | 'scans' | 'objects' | 'survival' | 'fun' | 'art' | 'vessels' | 'aircraft' | 'films' | 'location' | 'motorways';

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
  /** Lieux à préparer d'avance : leur fichier sera déjà là quand on les demandera. */
  | { type: 'viewer.scansPreloaded'; scans: Scan[] }
  | { type: 'viewer.poseApplied'; pose: Pose; sharpen?: boolean }
  | { type: 'viewer.flyoverRequested'; flyover: Flyover }
  | { type: 'viewer.orbitStopped' }
  | { type: 'viewer.followChanged'; target: FollowTarget | null }
  | { type: 'viewer.poseCaptureRequested' }
  | { type: 'viewer.captureRequested' }
  /** Balade au sol : armer la désignation d'un point, se poser dans un lieu filmé, revenir à la carte. */
  | { type: 'viewer.pickArmed'; armed: boolean }
  /** `strict` : ne se poser que sur le point demandé, sans être emmené au sol le plus proche. */
  | { type: 'viewer.walkRequested'; scanId: string; x: number; y: number; azimuth?: number; strict?: boolean }
  | { type: 'viewer.walkStopped' }
  /** Passer la visite en réalité virtuelle : à demander dans le geste même du visiteur. */
  | { type: 'viewer.vrRequested' }
  /** Trajectoire du vol sélectionné : chemin parcouru, estimation, instant désigné. */
  | { type: 'viewer.trajectoryChanged'; past: TrajectoryPoint[]; future: TrajectoryPoint[]; cursor: TrajectoryPoint | null };

/** Ce que le moteur rapporte. */
export type EngineReport =
  | { type: 'engine.ready' }
  | { type: 'engine.failed'; reason: string }
  | { type: 'engine.viewSettled'; pose: Pose }
  | { type: 'engine.poseCaptured'; pose: Pose }
  | { type: 'engine.captured'; blob: Blob | null; blank: boolean }
  | { type: 'engine.activityChanged'; loading: boolean; points: number }
  | { type: 'engine.orbitEnded' }
  | { type: 'engine.scanProgressed'; id: string; phase: ScanProgress['phase']; fraction: number }
  | { type: 'engine.followEnded' }
  | { type: 'engine.groundPicked'; x: number; y: number }
  | { type: 'engine.zoomedThrough'; x: number; y: number }
  | { type: 'engine.walkEntered' }
  | { type: 'engine.walkFailed' }
  | { type: 'engine.immersiveChanged'; immersive: boolean }
  | { type: 'engine.clipPicked'; clipId: string }
  | { type: 'engine.overlayPicked'; layer: OverlayName; id: string; members: string[] }
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
  preload: Scan[];
}

const OVERLAYS: readonly OverlayName[] = ['streets', 'places', 'cameras', 'scans', 'objects', 'survival', 'fun', 'art', 'vessels', 'aircraft', 'films', 'location', 'motorways'];

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
          onGroundPicked: (x, y) => sendBack({ type: 'engine.groundPicked', x, y }),
          onZoomedThrough: (x, y) => sendBack({ type: 'engine.zoomedThrough', x, y }),
          onWalkEntered: () => sendBack({ type: 'engine.walkEntered' }),
          onWalkFailed: () => sendBack({ type: 'engine.walkFailed' }),
          onImmersiveChanged: (immersive) => sendBack({ type: 'engine.immersiveChanged', immersive }),
          onClipPicked: (clipId) => sendBack({ type: 'engine.clipPicked', clipId }),
          onOverlayPicked: (layer, id, members) =>
            sendBack({ type: 'engine.overlayPicked', layer: layer as OverlayName, id, members }),
          onContextLost: () => sendBack({ type: 'engine.contextLost' }),
          onContextRestored: () => sendBack({ type: 'engine.contextRestored' }),
        },
      });
    } catch (error) {
      sendBack({ type: 'engine.failed', reason: error instanceof Error ? error.message : String(error) });
      return;
    }

    // déclaré en premier : les noms de rues passent sous les noms de lieux et les marqueurs
    engine.addOverlay('streets', streetLabelStyle);
    engine.addOverlay('motorways', roadShieldStyle);
    engine.addOverlay('places', placeLabelStyle);
    engine.addOverlay('cameras', cameraMarkerStyle);
    engine.addOverlay('scans', aerialMarkerStyle);
    engine.addOverlay('objects', objectMarkerStyle);
    engine.addOverlay('survival', survivalMarkerStyle);
    engine.addOverlay('fun', funMarkerStyle);
    engine.addOverlay('art', artMarkerStyle);
    engine.addOverlay('vessels', vesselMarkerStyle);
    engine.addOverlay('aircraft', aircraftMarkerStyle);
    engine.addOverlay('films', filmMarkerStyle);
    // en dernier : le repère du visiteur passe par-dessus tout le reste
    engine.addOverlay('location', locationMarkerStyle);
    for (const layer of OVERLAYS) {
      engine.setOverlayFeatures(layer, input.overlays[layer]);
      engine.setOverlayActive(layer, input.active[layer]);
    }
    engine.setAircraftModels(input.overlays.aircraft as unknown as AircraftModel[]);
    engine.setAircraftActive(input.active.aircraft);
    engine.setVesselModels(input.overlays.vessels as unknown as VesselModel[]);
    engine.setVesselActive(input.active.vessels);
    engine.setScans(input.scans);
    engine.preloadScans(input.preload);

    receive((command) => {
      switch (command.type) {
        case 'viewer.sceneChanged': return engine.setSource(command.source);
        case 'viewer.overlayChanged':
          // les avions sont aussi dessinés en volume : leurs marqueurs n'en gardent que l'étiquette
          if (command.layer === 'aircraft') engine.setAircraftModels(command.features as unknown as AircraftModel[]);
          if (command.layer === 'vessels') engine.setVesselModels(command.features as unknown as VesselModel[]);
          return engine.setOverlayFeatures(command.layer, command.features);
        case 'viewer.overlayActivated':
          if (command.layer === 'aircraft') engine.setAircraftActive(command.id);
          if (command.layer === 'vessels') engine.setVesselActive(command.id);
          return engine.setOverlayActive(command.layer, command.id);
        case 'viewer.scansChanged': return engine.setScans(command.scans);
        case 'viewer.scansPreloaded': return engine.preloadScans(command.scans);
        case 'viewer.poseApplied': return engine.setPose(command.pose, { sharpen: command.sharpen });
        case 'viewer.flyoverRequested': return engine.flyOver(command.flyover);
        case 'viewer.orbitStopped': return engine.stopOrbit();
        case 'viewer.followChanged': return engine.follow(command.target);
        case 'viewer.pickArmed': return engine.armPick(command.armed);
        case 'viewer.walkRequested': return engine.startWalk(command.scanId, command.x, command.y, command.azimuth, command.strict);
        case 'viewer.walkStopped': return engine.stopWalk();
        case 'viewer.vrRequested': return void engine.enterVr();
        case 'viewer.poseCaptureRequested':
          return sendBack({ type: 'engine.poseCaptured', pose: engine.getPose() });
        case 'viewer.trajectoryChanged': return engine.setTrajectory(command.past, command.future, command.cursor);
        case 'viewer.captureRequested':
          return void engine.capture().then((capture) => sendBack({ type: 'engine.captured', ...capture }));
      }
    });

    return () => engine.dispose();
  },
);
