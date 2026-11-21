/**
 * Machine applicative : elle chapeaute toutes les autres.
 *
 * Elle ne fait elle-même presque rien : elle vérifie d'abord que le navigateur
 * convient, puis fait vivre une machine par responsabilité et relaie leurs
 * annonces. Aucune machine fille n'en connaît une autre — tout passe par ici,
 * ce qui rend chaque interaction lisible à un seul endroit.
 *
 *   scene ──▶ viewer, acquisition          viewer ──▶ places, cameras, acquisition
 *   places, cameras ──▶ viewer             sites ──▶ viewer
 *   (demande de partage) ──▶ viewer ──▶ share          viewer ──▶ activity
 *   layers (imagerie aérienne, objets scannés) ──▶ viewer, object, chrome    aircraft ⇄ viewer
 *   films ──▶ viewer, timeline             timeline ⇄ viewer
 */

import { assign, fromCallback, sendTo, setup, type ActorRefFrom, type SnapshotFrom, enqueueActions } from 'xstate';
import { PROJECT } from '../config/project.ts';
import { QUALITY_PROFILES } from '../domain/quality.ts';
import { fitFlyover, isPlacedObject, scanFlyover, type Scan, scansWorthPreloading } from '../domain/scans.ts';
import { resolveScene } from '../domain/scene.ts';
import { periodPatch } from '../domain/period.ts';
import { timelineSteps, timelineTint, type FilmFraming } from '../domain/timeline.ts';
import { HOME_IMAGERY, PINNED_IMAGERY, encodeView, homePose, viewUrl, type View } from '../domain/view.ts';
import type { SupportReport } from '../services/capabilities.ts';
import { readRecentSearches } from '../services/recentSearches.ts';
import type { TelemetryBuffer } from '../services/telemetry.ts';
import { acquisitionMachine } from './acquisition.machine.ts';
import { activityMachine } from './activity.machine.ts';
import { aircraftMachine, type AircraftEmitted } from './aircraft.machine.ts';
import { vesselsMachine, type VesselsEmitted } from './vessels.machine.ts';
import { cameraViewPose } from '../domain/cameraView.ts';
import { camerasMachine, type CamerasEmitted } from './cameras.machine.ts';
import { chromeMachine, type PanelId } from './chrome.machine.ts';
import { compatibilityMachine } from './compatibility.machine.ts';
import { objectMachine, type ObjectEmitted } from './object.machine.ts';
import { placesMachine, type PlacesEmitted } from './places.machine.ts';
import { createLayersMachine, type LayersEmitted } from './layers.machine.ts';
import {
  AERIAL_LAYER, ART_LAYER, BACKED_LAYER, CLOUD_LAYER, DRONES_LAYER, DRAWN_LAYERS, FUN_LAYER, OBJECT_LAYERS, OBJECTS_LAYER, ORTHO_LAYER, SPORTS_LAYER, SURVIVAL_LAYER, VIDEOS_LAYER,
  aerialLayer, artLayer, backedLayer, cloudLayer, dronesLayer, drawnScans, funLayer, objectsLayer, orthoLayer, sportsLayer, survivalLayer, videosLayer,
} from './scans.layer.ts';
import type { OverlayName } from './actors/engine.actor.ts';
import { filmsMachine, type FilmsEmitted } from './films.machine.ts';
import { sceneMachine, type SceneEmitted } from './scene.machine.ts';
import { shareMachine } from './share.machine.ts';
import { recentsMachine, type RecentsEmitted } from './recents.machine.ts';
import { sitesMachine, type SitesEmitted } from './sites.machine.ts';
import { streetSearchMachine, type StreetSearchEmitted } from './streetSearch.machine.ts';
import { streetsMachine, type StreetsEmitted } from './streets.machine.ts';
import { telemetryMachine } from './telemetry.machine.ts';
import { timelineMachine, type TimelineEmitted } from './timeline.machine.ts';
import { trajectoryMachine, type TrajectoryEmitted } from './trajectory.machine.ts';
import { walkMachine, type WalkEmitted } from './walk.machine.ts';
import { coordinatesMachine } from './coordinates.machine.ts';
import { locationMachine, type LocationEmitted } from './location.machine.ts';
import { motorwaysMachine, type MotorwaysEmitted } from './motorways.machine.ts';
import type { DroneFlight } from '../domain/droneFlights.ts';
import type { SportSequence } from '../domain/sports.ts';
import { satelliteMachine, type SatelliteEmitted } from './satellite.machine.ts';
import { tourMachine, type TourEmitted } from './tour.machine.ts';
import { settingsMachine, type SettingsEmitted } from './settings.machine.ts';
import { satelliteIn, scanIn, type Definition } from '../domain/definition.ts';
import { DEFAULT_DEFINITION, readDefinition } from '../services/definition.ts';
import { satelliteDestination, type SatelliteImage } from '../domain/satellite.ts';
import { cinemaMachine } from './cinema.machine.ts';
import { locationHeight, nearDevice, type DevicePosition, locationLabel } from '../domain/whereabouts.ts';
import { WALK_REACH, nearestPlace } from '../domain/walk.ts';
import { clipViewPose, type ScanClip } from '../domain/clips.ts';

/** Cadrage du film tourné qui remplit le mieux l'écran : debout sur un téléphone tenu droit. */
const filmFraming = (): FilmFraming =>
  (typeof window !== 'undefined' && window.innerHeight > window.innerWidth ? 'portrait' : 'paysage');
import { viewerMachine, type ViewerEmitted } from './viewer.machine.ts';

export type AppEvent =
  | { type: 'app.shareRequested' }
  | { type: 'app.homeRequested' }
  /** Touche Échap sur la carte : plus aucun marqueur n'est sélectionné. */
  | { type: 'app.selectionDismissed' }
  | { type: 'app.timelineRequested' }
  /** Copier les coordonnées du point que la vue vise. */
  | { type: 'app.coordinatesRequested' }
  /** Aller voir une séquence filmée, replacée dans son lieu. */
  | { type: 'app.clipRequested'; clip: ScanClip }
  | SceneEmitted
  | ViewerEmitted
  | PlacesEmitted
  | CamerasEmitted
  | SitesEmitted
  | StreetsEmitted
  | StreetSearchEmitted
  | RecentsEmitted
  | LayersEmitted<Scan> | LayersEmitted<SportSequence> | LayersEmitted<DroneFlight>
  | ObjectEmitted
  | AircraftEmitted
  | VesselsEmitted
  | FilmsEmitted
  | TimelineEmitted
  | TrajectoryEmitted
  | WalkEmitted
  | LocationEmitted
  | MotorwaysEmitted
  | SatelliteEmitted
  | SettingsEmitted
  | TourEmitted;

export interface AppInput {
  /** Vue lue dans l'URL au chargement. */
  view: View;
  /** Aucun point de vue dans l'URL : on ouvre sur la vue d'accueil, à pleine précision. */
  startsAtHome: boolean;
  buffer: TelemetryBuffer;
}

interface AppContext extends AppInput {
  support: SupportReport | null;
  /** Imagerie aérienne à dessiner dans la carte : celle qui est sélectionnée, et celles que le visiteur garde affichées. */
  imagery: { selected: Scan | null; kept: Scan[] };
  /** Tous les lieux filmés, que leur calque soit allumé ou non : la balade au sol y cherche où se poser. */
  places: Scan[];
  /** Lieu où le visiteur marche : dessiné lui aussi, quelle que soit la sélection. */
  walk: Scan | null;
  /** Lieu dont on refait le vol en visite guidée : dessiné lui aussi tant qu'elle dure. */
  tour: Scan | null;
  /** Lieu que la caméra du drone regarde, par son identifiant : il peut être demandé avant que la liste des lieux n'arrive. */
  tourScanId: string | null;
  /** Le lien d'arrivée demandait la vue cockpit : on y entre dès que son vol est connu, une seule fois. */
  cockpitPending: boolean;
  /** Vols de drone publiés : montrés en vol quand leur calque est allumé. */
  droneFlights: DroneFlight[];
  /** Position de l'appareil, si le visiteur l'a demandée : en mémoire seulement, pour ne jamais l'écrire dans l'adresse. */
  device: DevicePosition | null;
  /** Tracés dessinés par le calque « Autoroutes » : aucun quand il est éteint. */
  traces: Scan[];
  /**
   * Objet relevé de près posé dans la carte : dessiné depuis que son marqueur a été touché, jusqu'à ce que sa
   * sélection tombe. Le toucher de nouveau ouvre sa visionneuse.
   */
  shownObject: Scan | null;
  /** L'objet posé vient d'être sélectionné : son premier toucher l'approche, le suivant ouvre la visionneuse. */
  shownObjectFresh: boolean;
  /** Orthophotos de drone et nuages de points dessinés dans la carte, par calque. */
  drawn: Record<string, { selected: Scan | null; kept: Scan[] }>;
  /** Séquence sportive sélectionnée : son écran est dressé dans la carte. */
  sport: SportSequence | null;
  /** Définition dans laquelle les relevés se dessinent : le réglage de l'application. */
  definition: Definition;
  /** Images de la vue « Satellite », tant qu'elle est enclenchée. */
  satellite: SatelliteImage[];
}

/** Hauteur de survol d'un site touristique, et d'une caméra routière. */
const SITE_HEIGHT = 200;
/** Hauteur de survol d'une rue : assez bas pour lire son tracé et les noms des rues voisines. */
const STREET_HEIGHT = 320;
const CAMERA_HEIGHT = 450;

/**
 * Panneau déplié à l'ouverture — un seul, le rail n'en montre qu'un à la fois :
 * un grand écran ouvre sur les calques, un petit écran laisse toute la place à la carte.
 */
/** La région d'époque du lieu sélectionné, ou de celui où l'on marche, dans la scène du visiteur. */
const periodOf = (context: AppContext) =>
  ({ type: 'viewer.periodChanged' as const, patch: periodPatch(context.walk ?? context.imagery.selected, context.view.scene) });

function initialPanels(context: AppContext): PanelId[] {
  return context.support?.compact ? [] : ['layers'];
}

export const appMachine = setup({
  types: {
    context: {} as AppContext,
    events: {} as AppEvent,
    input: {} as AppInput,
    children: {} as {
      telemetry: 'telemetry';
      chrome: 'chrome';
      viewer: 'viewer';
      scene: 'scene';
      places: 'places';
      cameras: 'cameras';
      sites: 'sites';
      streets: 'streets';
      streetSearch: 'streetSearch';
      recents: 'recents';
      layers: 'layers';
      object: 'object';
      aircraft: 'aircraft';
      vessels: 'vessels';
      films: 'films';
      timeline: 'timeline';
      trajectory: 'trajectory';
      walk: 'walk';
      coordinates: 'coordinates';
      location: 'location';
      motorways: 'motorways';
      satellite: 'satellite';
      settings: 'settings';
      tour: 'tour';
      cinema: 'cinema';
      acquisition: 'acquisition';
      activity: 'activity';
      share: 'share';
    },
  },
  actors: {
    compatibility: compatibilityMachine,
    telemetry: telemetryMachine,
    chrome: chromeMachine,
    viewer: viewerMachine,
    scene: sceneMachine,
    places: placesMachine,
    cameras: camerasMachine,
    sites: sitesMachine,
    streets: streetsMachine,
    streetSearch: streetSearchMachine,
    recents: recentsMachine,
    // les calques à sélection naissent tous du même état générique, sous un orchestrateur
    layers: createLayersMachine([aerialLayer, orthoLayer, cloudLayer, dronesLayer, videosLayer, sportsLayer, objectsLayer, backedLayer, artLayer, survivalLayer, funLayer]),
    object: objectMachine,
    aircraft: aircraftMachine,
    vessels: vesselsMachine,
    films: filmsMachine,
    timeline: timelineMachine,
    trajectory: trajectoryMachine,
    walk: walkMachine,
    coordinates: coordinatesMachine,
    location: locationMachine,
    motorways: motorwaysMachine,
    satellite: satelliteMachine,
    settings: settingsMachine,
    tour: tourMachine,
    cinema: cinemaMachine,
    acquisition: acquisitionMachine,
    activity: activityMachine,
    share: shareMachine,
    /**
     * Un lien partagé collé dans l'onglet déjà ouvert ne recharge pas la page (seul
     * le fragment change) : on la recharge, pour repartir exactement de cette vue.
     * Nos propres mises à jour de l'URL (`replaceState`) ne déclenchent pas `hashchange`.
     */
    linkWatcher: fromCallback(() => {
      const reload = () => location.reload();
      window.addEventListener('hashchange', reload);
      return () => window.removeEventListener('hashchange', reload);
    }),
  },
  guards: {
    isSupported: ({ event }) => (event as unknown as { output: SupportReport }).output.supported,
  },
  actions: {
    /**
     * L'URL suit la vue : recharger ou copier la barre d'adresse la restitue.
     * Tant que la vue d'accueil n'est pas posée, on n'écrit rien : sa pose réelle
     * (rapprochée pour la pleine précision) n'est connue que du moteur.
     */
    syncUrl: ({ context }) => {
      if (context.startsAtHome) return;
      // une vue prise tout près de l'appareil du visiteur dirait où il est : l'adresse garde la vue d'avant
      if (nearDevice(context.device, context.view.pose.x, context.view.pose.y)) return;
      history.replaceState(null, '', `#${encodeView(context.view)}`);
    },
    /** Retient le marqueur actif d'un calque, pour l'adresse : un lien partagé rouvre ce que l'on regardait. */
    rememberActive: assign({
      view: ({ context, event }) => {
        if (event.type !== 'layers.selectionChanged') return context.view;
        const { [event.layer]: _gone, ...others } = context.view.active ?? {};
        return { ...context.view, active: event.item ? { ...others, [event.layer]: event.item.id } : others };
      },
    }),
    /** Dessine dans la carte l'imagerie sélectionnée et celles que le visiteur garde affichées. */
    /**
     * Dessine dans la carte l'imagerie sélectionnée et celles que le visiteur garde affichées ; et, autour du
     * lieu sélectionné ou de celui où l'on marche, le relief et la photo de son époque s'il est ancien.
     */
    drawImagery: enqueueActions(({ context, enqueue }) => {
      enqueue.sendTo('viewer', {
        type: 'viewer.scansChanged',
        scans: [
          ...drawnScans(context.imagery.selected, context.walk ? [context.walk, ...context.imagery.kept.filter((scan) => scan !== context.walk)] : context.imagery.kept),
          // orthophotos de drone et nuages de points : dessinés comme l'imagerie, chacun depuis son calque
          ...Object.values(context.drawn).flatMap((layer) => drawnScans(layer.selected, layer.kept)),
          ...context.places.filter((place) => place.id === context.tourScanId),
          ...context.traces,
          // l'objet relevé de près dont le marqueur a été touché : posé à sa place, à l'échelle
          ...(context.shownObject ? [context.shownObject] : []),
        ].map((scan) => scanIn(scan, context.definition)),
      });
      enqueue.sendTo('viewer', periodOf(context));
    }),
    drawPeriod: sendTo('viewer', ({ context }) => periodOf(context)),
  },
}).createMachine({
  id: 'app',
  context: ({ input }) => ({ ...input, support: null, imagery: { selected: null, kept: [] }, places: [], walk: null, tour: null, tourScanId: null, cockpitPending: input.view.cockpit === true, droneFlights: [], device: null, traces: [], shownObject: null, shownObjectFresh: false, drawn: {}, sport: null, definition: DEFAULT_DEFINITION, satellite: [] }),
  initial: 'checking',
  states: {
    checking: {
      invoke: {
        id: 'compatibility',
        src: 'compatibility',
        onDone: [
          {
            guard: 'isSupported',
            target: 'running',
            actions: assign({ support: ({ event }) => event.output }),
          },
          { target: 'unsupported', actions: assign({ support: ({ event }) => event.output }) },
        ],
      },
    },

    /** Le navigateur ne convient pas : on explique quelle version installer. */
    unsupported: {},

    running: {
      invoke: [
        { id: 'telemetry', src: 'telemetry', input: ({ context }) => ({ buffer: context.buffer }) },
        {
          id: 'chrome',
          src: 'chrome',
          input: ({ context }) => ({
            // le rail est le sommaire à toutes les tailles d'écran : un panneau à la fois
            exclusive: true,
            expanded: initialPanels(context),
          }),
        },
        {
          id: 'viewer',
          src: 'viewer',
          input: ({ context }) => ({
            quality: QUALITY_PROFILES[context.support?.profile ?? 'desktop'](),
            source: resolveScene(context.view.scene),
            pose: context.view.pose,
            // la vue d'accueil est déjà cadrée de près : la rapprocher encore la sortirait de son cadre
            sharpStart: false,
            // la vue d'accueil s'ouvre par un tour de la citadelle, sauf si le visiteur évite les animations
            orbitStart: context.startsAtHome && !context.support?.reducedMotion,
          }),
        },
        { id: 'scene', src: 'scene', input: ({ context }) => context.view.scene },
        {
          id: 'places',
          src: 'places',
          input: ({ context }) => ({
            visible: context.view.overlays.places,
            distance: context.view.pose.distance,
          }),
        },
        {
          id: 'cameras',
          src: 'cameras',
          input: ({ context }) => ({
            visible: context.view.overlays.cameras,
            selectedId: context.view.cameraId,
            focus: context.view.pose,
          }),
        },
        { id: 'sites', src: 'sites' },
        {
          id: 'streets',
          src: 'streets',
          input: ({ context }) => ({ visible: context.view.overlays.streets, focus: context.view.pose }),
        },
        { id: 'streetSearch', src: 'streetSearch' },
        { id: 'recents', src: 'recents', input: () => ({ list: readRecentSearches() }) },
        {
          id: 'layers',
          src: 'layers',
          input: ({ context }) => ({
            visible: {
              [AERIAL_LAYER]: context.view.overlays.scans,
              [OBJECTS_LAYER]: context.view.overlays.objects,
              [SURVIVAL_LAYER]: context.view.overlays.survival,
              [FUN_LAYER]: context.view.overlays.fun,
              [ART_LAYER]: context.view.overlays.art,
              [BACKED_LAYER]: context.view.overlays.backed,
              [ORTHO_LAYER]: context.view.overlays.orthophoto,
              [CLOUD_LAYER]: context.view.overlays.clouds,
              [SPORTS_LAYER]: context.view.overlays.sports,
              [DRONES_LAYER]: context.view.overlays.drones,
              [VIDEOS_LAYER]: context.view.overlays.videos,
            },
            // à l'accueil, la citadelle est déjà là, reconstruite, sous la caméra qui en fait le tour
            selected: context.view.active,
            kept: { [AERIAL_LAYER]: context.startsAtHome ? HOME_IMAGERY : PINNED_IMAGERY } as Record<string, readonly string[]>,
            distance: context.view.pose.distance,
          }),
        },
        { id: 'object', src: 'object' },
        { id: 'aircraft', src: 'aircraft', input: ({ context }) => ({ visible: context.view.overlays.aircraft }) },
        { id: 'vessels', src: 'vessels', input: ({ context }) => ({ visible: context.view.overlays.vessels }) },
        { id: 'films', src: 'films' },
        { id: 'timeline', src: 'timeline' },
        { id: 'trajectory', src: 'trajectory' },
        { id: 'walk', src: 'walk' },
        { id: 'coordinates', src: 'coordinates' },
        { id: 'location', src: 'location' },
        { id: 'cinema', src: 'cinema' },
        { id: 'motorways', src: 'motorways', input: ({ context }) => ({ visible: context.view.overlays.motorways }) },
        { id: 'satellite', src: 'satellite' },
        { id: 'tour', src: 'tour' },
        { id: 'settings', src: 'settings', input: () => ({ definition: readDefinition() }) },
        {
          id: 'acquisition',
          src: 'acquisition',
          input: ({ context }) => ({ campaign: context.view.scene.campaign, focus: context.view.pose }),
        },
        { id: 'activity', src: 'activity' },
        { id: 'share', src: 'share' },
        { id: 'linkWatcher', src: 'linkWatcher' },
      ],

      on: {
        /* ---- la scène change : le viewer recharge, la datation suit ---- */
        'scene.changed': {
          actions: [
            assign({ view: ({ context, event }) => ({ ...context.view, scene: event.scene }) }),
            sendTo('viewer', ({ event }) => ({ type: 'viewer.sceneChanged', source: resolveScene(event.scene) })),
            'drawPeriod',
            sendTo('acquisition', ({ event }) =>
              ({ type: 'acquisition.campaignChanged', campaign: event.scene.campaign })),
            'syncUrl',
          ],
        },

        /* ---- la vue s'est posée : tout ce qui dépend du lieu est prévenu ---- */
        'viewer.viewSettled': {
          actions: [
            assign({
              view: ({ context, event }) => ({ ...context.view, pose: event.pose }),
              startsAtHome: false,
            }),
            sendTo('places', ({ event }) => ({ type: 'places.viewChanged', distance: event.pose.distance })),
            sendTo('cameras', ({ event }) => ({ type: 'cameras.viewChanged', x: event.pose.x, y: event.pose.y })),
            sendTo('layers', ({ event }) => ({ type: 'layers.viewChanged', distance: event.pose.distance })),
            sendTo('streets', ({ event }) => ({
              type: 'streets.viewChanged', x: event.pose.x, y: event.pose.y, distance: event.pose.distance,
            })),
            sendTo('acquisition', ({ event }) => ({
              type: 'acquisition.viewChanged', x: event.pose.x, y: event.pose.y, distance: event.pose.distance,
            })),
            'syncUrl',
          ],
        },

        /* ---- le relief se charge : la pastille l'annonce ---- */
        'viewer.activityChanged': {
          actions: [
            sendTo('activity', ({ event }) =>
              ({ type: 'activity.changed', loading: event.loading, points: event.points })),
            // le film du temps attend la fin de chaque chargement pour photographier
            sendTo('timeline', ({ event }) => ({ type: 'timeline.activityChanged', loading: event.loading })),
          ],
        },

        /* ---- film du temps : la vue, millésime par millésime, photographiée puis rendue à sa scène ---- */
        'app.timelineRequested': {
          actions: [
            sendTo('viewer', { type: 'viewer.orbitStopped' }),
            sendTo('timeline', ({ context }) =>
              ({ type: 'timeline.opened', steps: timelineSteps(context.view.scene.tint) })),
          ],
        },
        // le millésime n'est changé que dans le viewer : ni la scène choisie ni le lien ne bougent
        'timeline.vintageRequested': {
          actions: sendTo('viewer', ({ context, event }) => ({
            type: 'viewer.sceneChanged',
            source: {
              ...resolveScene({ ...context.view.scene, tint: timelineTint(context.view.scene.tint), vintage: event.vintage }),
              // le relais Cloudflare prépare les millésimes suivants pendant que celui-ci s'affiche
              warm: true,
            },
          })),
        },
        'timeline.captureRequested': { actions: sendTo('viewer', { type: 'viewer.captureRequested' }) },
        'viewer.captured': {
          actions: sendTo('timeline', ({ event }) => ({
            type: 'timeline.frameCaptured',
            url: event.blob ? URL.createObjectURL(event.blob) : null,
            blank: event.blank,
          })),
        },
        'timeline.restoreRequested': {
          actions: sendTo('viewer', ({ context }) =>
            ({ type: 'viewer.sceneChanged', source: resolveScene(context.view.scene) })),
        },

        /* ---- films signalés sur la carte : un marqueur par lieu ; le toucher cadre le lieu et lance son film ---- */
        'films.markersChanged': {
          actions: [
            sendTo('viewer', ({ event }) =>
              ({ type: 'viewer.overlayChanged', layer: 'films', features: event.features })),
            sendTo('viewer', ({ event }) =>
              ({ type: 'viewer.overlayActivated', layer: 'films', id: event.activeId })),
          ],
        },
        'films.playRequested': {
          actions: [
            sendTo('viewer', { type: 'viewer.orbitStopped' }),
            sendTo('viewer', ({ event }) => ({ type: 'viewer.poseApplied', pose: event.place.view })),
            sendTo('timeline', ({ context, event }) => ({
              type: 'timeline.opened',
              steps: timelineSteps(context.view.scene.tint),
              // le film de ce lieu est déjà tourné, en photo : il vient du CDN, cadré pour l'écran du visiteur
              ...(event.place.prepared && timelineTint(context.view.scene.tint) === 'ortho'
                ? { prepared: event.place.prepared, framing: filmFraming() } : {}),
            })),
          ],
        },

        /* ---- les calques publient leurs entités : le viewer les dessine ---- */
        'places.changed': {
          actions: [
            assign({
              view: ({ context, event }) =>
                ({ ...context.view, overlays: { ...context.view.overlays, places: event.visible } }),
            }),
            sendTo('viewer', ({ event }) =>
              ({ type: 'viewer.overlayChanged', layer: 'places', features: event.features })),
            'syncUrl',
          ],
        },
        'cameras.changed': {
          actions: [
            assign({
              view: ({ context, event }) =>
                ({ ...context.view, overlays: { ...context.view.overlays, cameras: event.visible } }),
            }),
            sendTo('viewer', ({ event }) =>
              ({ type: 'viewer.overlayChanged', layer: 'cameras', features: event.features })),
            'syncUrl',
          ],
        },

        /* ---- caméras routières ---- */
        'viewer.overlayPicked': [
          {
            guard: ({ event }) => event.layer === 'cameras',
            actions: sendTo('cameras', ({ event }) => ({ type: 'cameras.picked', id: event.id })),
          },
          {
            guard: ({ event }) => event.layer === 'aircraft',
            actions: sendTo('aircraft', ({ event }) => ({ type: 'aircraft.picked', id: event.id })),
          },
          {
            guard: ({ event }) => event.layer === 'vessels',
            actions: sendTo('vessels', ({ event }) => ({ type: 'vessels.picked', id: event.id })),
          },
          {
            // imagerie aérienne ou objets scannés : le calque reçoit ce que le marqueur touché rassemble
            guard: ({ event }) => [...DRAWN_LAYERS, SPORTS_LAYER, DRONES_LAYER, VIDEOS_LAYER, OBJECTS_LAYER, SURVIVAL_LAYER, FUN_LAYER, ART_LAYER, BACKED_LAYER].includes(event.layer),
            actions: sendTo('layers', ({ event }) =>
              ({ type: 'layers.picked', layer: event.layer, id: event.id, members: event.members })),
          },
          {
            guard: ({ event }) => event.layer === 'films',
            actions: sendTo('films', ({ event }) => ({ type: 'films.picked', id: event.id })),
          },
        ],
        'cameras.selectionChanged': {
          actions: [
            assign({ view: ({ context, event }) => ({ ...context.view, cameraId: event.camera?.id ?? null }) }),
            sendTo('viewer', ({ event }) =>
              ({ type: 'viewer.overlayActivated', layer: 'cameras', id: event.camera?.id ?? null })),
            sendTo('chrome', ({ event }) => (event.camera
              ? { type: 'chrome.revealed', panel: 'camera' }
              : { type: 'chrome.dismissed', panel: 'camera' })),
            'syncUrl',
          ],
        },
        'cameras.viewRequested': {
          actions: sendTo('viewer', ({ event }) => ({ type: 'viewer.poseApplied', pose: cameraViewPose(event.pose) })),
        },
        'cameras.projectionChanged': {
          actions: sendTo('viewer', ({ event }) => ({ type: 'viewer.cameraProjected', projection: event.projection })),
        },
        'cameras.flyRequested': {
          actions: sendTo('viewer', ({ event }) => ({
            type: 'viewer.flyoverRequested',
            flyover: { x: event.x, y: event.y, height: CAMERA_HEIGHT, orbit: false },
          })),
        },

        /* ---- noms de rues : un calque d'étiquettes, lisible de près ---- */
        'streets.changed': {
          actions: [
            assign({
              view: ({ context, event }) =>
                ({ ...context.view, overlays: { ...context.view.overlays, streets: event.visible } }),
            }),
            sendTo('viewer', ({ event }) =>
              ({ type: 'viewer.overlayChanged', layer: 'streets', features: event.features })),
            'syncUrl',
          ],
        },

        /* ---- rues : survol à hauteur de quartier, sans orbite ---- */
        'streetSearch.chosen': {
          actions: [
            sendTo('viewer', ({ event }) => ({
              type: 'viewer.flyoverRequested',
              flyover: { x: event.street.x, y: event.street.y, height: STREET_HEIGHT, orbit: false },
            })),
            sendTo('recents', ({ event }) => ({
              type: 'recents.added',
              entry: { kind: 'street', id: event.street.id, name: event.street.name, meta: event.street.near, x: event.street.x, y: event.street.y },
            })),
          ],
        },

        /* ---- recherches récentes : même survol que la première fois ---- */
        'recents.chosen': {
          actions: sendTo('viewer', ({ event }) => ({
            type: 'viewer.flyoverRequested',
            flyover: event.entry.kind === 'site'
              ? { x: event.entry.x, y: event.entry.y, height: SITE_HEIGHT, orbit: true }
              : { x: event.entry.x, y: event.entry.y, height: STREET_HEIGHT, orbit: false },
          })),
        },

        /* ---- sites touristiques : survol à 200 m, en orbite ---- */
        'sites.chosen': {
          actions: [
            sendTo('viewer', ({ event }) => ({
              type: 'viewer.flyoverRequested',
              flyover: { x: event.site.x, y: event.site.y, height: SITE_HEIGHT, orbit: true },
            })),
            sendTo('recents', ({ event }) => ({
              type: 'recents.added',
              entry: { kind: 'site', id: event.site.id, name: event.site.name, meta: `${event.site.kind} · ${event.site.near}`, x: event.site.x, y: event.site.y },
            })),
          ],
        },

        /* ---- calques à sélection (imagerie 3D) : leurs marqueurs, puis l'élément que l'on sélectionne ---- */
        // la liste de l'imagerie aérienne est connue : les lieux sont préparés d'avance, pour s'afficher sans attente
        'layers.listed': [
          {
            // calque éteint, rien n'est préparé : ce serait télécharger ce que le visiteur a choisi de ne pas voir
            guard: ({ context, event }) => event.layer === AERIAL_LAYER && context.view.overlays.scans,
            actions: [
              assign({ places: ({ event }) => event.items }),
              // seulement les lieux proches de la vue, et dans la définition choisie : préparer l'autre serait la télécharger pour rien
              sendTo('viewer', ({ context, event }) => ({ type: 'viewer.scansPreloaded', scans: scansWorthPreloading(event.items as Scan[], context.view.pose).map((scan) => scanIn(scan, context.definition)) })),
            ],
          },
          { guard: ({ event }) => event.layer === AERIAL_LAYER, actions: [assign({ places: ({ event }) => event.items }), 'drawImagery'] },
          { guard: ({ event }) => event.layer === DRONES_LAYER, actions: assign({ droneFlights: ({ event }) => event.items as DroneFlight[] }) },
        ],
        'layers.changed': {
          actions: [
            assign({
              view: ({ context, event }) =>
                ({ ...context.view, overlays: { ...context.view.overlays, [event.layer]: event.visible } }),
            }),
            sendTo('viewer', ({ event }) =>
              ({ type: 'viewer.overlayChanged', layer: event.layer as OverlayName, features: event.features })),
            'syncUrl',
          ],
        },
        'layers.selectionChanged': [
          {
            // un vol de drone n'est en vol sur la carte que lorsque son marqueur est actif ; son panneau s'ouvre avec lui
            guard: ({ event }) => event.layer === DRONES_LAYER,
            actions: [
              sendTo('viewer', ({ event }) =>
                ({ type: 'viewer.overlayActivated', layer: event.layer as OverlayName, id: event.markerId })),
              sendTo('viewer', ({ event }) => ({ type: 'viewer.droneFlightsChanged', flights: event.item ? [event.item as DroneFlight] : [] })),
              // arrivé par un lien de vue cockpit : on entre dans la caméra de ce vol, une fois
              enqueueActions(({ context, event, enqueue }) => {
                if (!context.cockpitPending || !event.item) return;
                enqueue.assign({ cockpitPending: false });
                enqueue.sendTo('tour', { type: 'tour.requested', flight: event.item as DroneFlight });
              }),
              sendTo('chrome', ({ event }) => ({ type: event.item ? 'chrome.revealed' : 'chrome.dismissed', panel: 'drones' })),
              'rememberActive', 'syncUrl',
            ],
          },
          {
            // une vidéo signalée : son marqueur s'allume et sa fiche s'ouvre ; rien n'est chargé depuis son hébergeur
            guard: ({ event }) => event.layer === VIDEOS_LAYER,
            actions: [
              sendTo('viewer', ({ event }) =>
                ({ type: 'viewer.overlayActivated', layer: event.layer as OverlayName, id: event.markerId })),
              sendTo('chrome', ({ event }) => ({ type: event.item ? 'chrome.revealed' : 'chrome.dismissed', panel: 'videos' })),
              'rememberActive', 'syncUrl',
            ],
          },
          {
            // une séquence sportive sélectionnée : son écran se dresse là où elle a été tournée
            guard: ({ event }) => event.layer === SPORTS_LAYER,
            actions: [
              assign({ sport: ({ event }) => event.item as SportSequence | null }),
              sendTo('viewer', ({ event }) =>
                ({ type: 'viewer.overlayActivated', layer: event.layer as OverlayName, id: event.markerId })),
              'rememberActive', 'syncUrl',
              sendTo('viewer', ({ event }) =>
                ({ type: 'viewer.clipsChanged', clips: event.item ? [(event.item as SportSequence).clip] : [] })),
            ],
          },
          {
            // une imagerie aérienne sélectionnée est dessinée dans la carte, et son panneau s'ouvre
            guard: ({ event }) => event.layer === AERIAL_LAYER,
            actions: [
              assign({
                imagery: ({ context, event }) => ({ ...context.imagery, selected: event.item }),
              }),
              sendTo('viewer', ({ event }) =>
                ({ type: 'viewer.overlayActivated', layer: event.layer as OverlayName, id: event.markerId })),
              'rememberActive', 'syncUrl',
              'drawImagery',
              sendTo('chrome', ({ event }) => (event.item
                ? { type: 'chrome.revealed', panel: 'imagery' }
                : { type: 'chrome.dismissed', panel: 'imagery' })),
            ],
          },
          {
            // orthophoto de drone, nuage de points : dessinés de même, chacun avec sa fiche dans son panneau
            guard: ({ event }) => DRAWN_LAYERS.includes(event.layer),
            actions: [
              assign({
                drawn: ({ context, event }) =>
                  ({ ...context.drawn, [event.layer]: { kept: context.drawn[event.layer]?.kept ?? [], selected: event.item } }),
              }),
              sendTo('viewer', ({ event }) =>
                ({ type: 'viewer.overlayActivated', layer: event.layer as OverlayName, id: event.markerId })),
              'rememberActive', 'syncUrl',
              'drawImagery',
              sendTo('chrome', ({ event }) => ({
                type: event.item ? 'chrome.revealed' : 'chrome.dismissed',
                panel: event.layer === ORTHO_LAYER ? 'orthophoto' : 'clouds',
              })),
            ],
          },
          {
            // un objet relevé de près posé dans la carte s'y dessine dès qu'il est sélectionné — par un toucher ou par
            // un lien partagé ; sa sélection tombée ou passée à un autre, il s'efface
            guard: ({ event }) => OBJECT_LAYERS.includes(event.layer),
            actions: [
              assign({
                shownObject: ({ event }) => (event.item && isPlacedObject(event.item as Scan) ? (event.item as Scan) : null),
                shownObjectFresh: ({ context, event }) => event.item !== null && context.shownObject?.id !== (event.item as Scan).id,
              }),
              sendTo('viewer', ({ event }) =>
                ({ type: 'viewer.overlayActivated', layer: event.layer as OverlayName, id: event.markerId })),
              'rememberActive', 'syncUrl', 'drawImagery',
            ],
          },
          {
            actions: [
              sendTo('viewer', ({ event }) =>
                ({ type: 'viewer.overlayActivated', layer: event.layer as OverlayName, id: event.markerId })),
              'rememberActive', 'syncUrl',
            ],
          },
        ],
        // les imageries que le visiteur garde affichées restent dessinées, quelle que soit la sélection
        'layers.keptChanged': [
          {
            guard: ({ event }) => event.layer === AERIAL_LAYER,
            actions: [assign({ imagery: ({ context, event }) => ({ ...context.imagery, kept: event.items }) }), 'drawImagery'],
          },
          {
            guard: ({ event }) => DRAWN_LAYERS.includes(event.layer),
            actions: [
              assign({
                drawn: ({ context, event }) =>
                  ({ ...context.drawn, [event.layer]: { selected: context.drawn[event.layer]?.selected ?? null, kept: event.items } }),
              }),
              'drawImagery',
            ],
          },
        ],
        // le marqueur touché rassemble plusieurs lieux : la caméra s'en approche, et chacun retrouve le sien
        'layers.expandRequested': {
          actions: sendTo('viewer', ({ event }) => ({ type: 'viewer.flyoverRequested', flyover: fitFlyover(event.items) })),
        },
        // l'élément vient d'être désigné : un objet s'ouvre dans sa visionneuse, la caméra se rend sur un lieu
        'layers.activated': [
          {
            // un vol de drone désigné : la vue va se placer au-dessus de son trajet
            guard: ({ event }) => event.layer === DRONES_LAYER,
            actions: sendTo('viewer', ({ event }) => {
              const track = (event.item as DroneFlight).track, middle = track[Math.floor(track.length / 2)]!;
              return { type: 'viewer.flyoverRequested', flyover: { x: middle.x, y: middle.y, height: 260, orbit: false } };
            }),
          },
          {
            // la vue se place devant l'écran, dans l'axe de la caméra qui a filmé
            guard: ({ event }) => event.layer === SPORTS_LAYER,
            actions: [
              sendTo('viewer', { type: 'viewer.orbitStopped' }),
              sendTo('viewer', ({ event }) => ({ type: 'viewer.poseApplied', pose: clipViewPose((event.item as SportSequence).clip) })),
            ],
          },
          {
            // objets scannés, équipements de survie, objets de loisir, street art, projets soutenus : un objet posé dans la
            // carte s'y dessine d'abord, et la caméra s'en approche ; touché de nouveau — ou sans pose —, il s'examine
            // dans la visionneuse, la même pour tous
            guard: ({ event }) => OBJECT_LAYERS.includes(event.layer),
            actions: enqueueActions(({ context, event, enqueue }) => {
              const scan = event.item as Scan;
              if (isPlacedObject(scan) && context.shownObjectFresh) {
                enqueue.assign({ shownObjectFresh: false });
                enqueue.sendTo('viewer', { type: 'viewer.flyoverRequested', flyover: scanFlyover(scan) });
              } else {
                enqueue.sendTo('object', { type: 'object.opened', scan, group: event.siblings as Scan[] });
              }
            }),
          },
          {
            actions: sendTo('viewer', ({ event }) =>
              ({ type: 'viewer.flyoverRequested', flyover: scanFlyover(event.item) })),
          },
        ],
        // la visionneuse refermée, son objet n'est plus sélectionné — sauf s'il est posé dans la carte : on le retrouve
        // à sa place, son marqueur toujours prêt à rouvrir la visionneuse
        'object.left': {
          guard: ({ context }) => context.shownObject === null,
          actions: OBJECT_LAYERS.map((layer) => sendTo('layers', { type: 'layers.dismissed', layer })),
        },

        /* ---- balade au sol : un point désigné sur la carte, et l'on marche dans le lieu filmé qui s'y trouve ---- */
        'walk.aimChanged': {
          actions: sendTo('viewer', ({ event }) => ({ type: 'viewer.pickArmed', armed: event.armed })),
        },
        'viewer.groundPicked': [
          {
            guard: ({ context, event }) => (nearestPlace(context.places, event.x, event.y)?.distance ?? Infinity) <= WALK_REACH,
            actions: sendTo('walk', ({ context, event }) =>
              ({ type: 'walk.placed', scan: nearestPlace(context.places, event.x, event.y)!.scan, x: event.x, y: event.y })),
          },
          {
            actions: sendTo('walk', ({ context, event }) => {
              const nearest = nearestPlace(context.places, event.x, event.y);
              return { type: 'walk.missed', nearest: nearest && { name: nearest.scan.name, distance: nearest.distance } };
            }),
          },
        ],
        // le lieu est dessiné même si son calque est éteint ; la balade commence dès qu'il est arrivé
        'walk.started': {
          actions: [
            assign({ walk: ({ event }) => event.scan }),
            'drawImagery',
            sendTo('viewer', ({ event }) => ({ type: 'viewer.walkRequested', scanId: event.scan.id, x: event.x, y: event.y, azimuth: event.azimuth })),
          ],
        },
        'walk.ended': {
          actions: [assign({ walk: null }), sendTo('viewer', { type: 'viewer.walkStopped' }), 'drawImagery'],
        },
        /* ---- visite guidée : le vol du drone refait à sa vitesse ; en sortir rend la vue d'avant ---- */
        'tour.started': {
          actions: [
            // le lieu reconstruit à partir de ce vol est dessiné : c'est lui que la caméra regarde
            assign({
              tourScanId: ({ event }) => event.flight.scanId ?? null,
              tour: ({ context, event }) => context.places.find((place) => place.id === event.flight.scanId) ?? null,
              view: ({ context }) => ({ ...context.view, cockpit: true }),
            }),
            'syncUrl',
            'drawImagery',
            sendTo('viewer', ({ event }) => ({ type: 'viewer.tourRequested', flight: { id: event.flight.id, fov: event.flight.fov, track: event.flight.track } })),
          ],
        },
        'tour.playChanged': { actions: sendTo('viewer', ({ event }) => ({ type: 'viewer.tourPlayChanged', playing: event.playing })) },
        'tour.sightChanged': { actions: sendTo('viewer', ({ event }) => ({ type: 'viewer.droneSightChanged', visible: event.visible })) },
        'tour.ended': {
          actions: [
            assign({ tour: null, tourScanId: null, view: ({ context }) => { const { cockpit: _left, ...view } = context.view; return view; } }),
            sendTo('viewer', { type: 'viewer.tourStopped' }), 'drawImagery', 'syncUrl',
          ],
        },
        'tour.restarted': { actions: sendTo('viewer', { type: 'viewer.tourRestarted' }) },
        'viewer.tourEnded': { actions: sendTo('tour', { type: 'tour.finished' }) },
        'viewer.tourHeld': { actions: sendTo('tour', { type: 'tour.held' }) },
        'viewer.tourProgressed': { actions: sendTo('tour', ({ event }) => ({ type: 'tour.progressed', t: event.t })) },
        'viewer.walkEntered': { actions: sendTo('walk', { type: 'walk.entered' }) },
        'viewer.walkFailed': { actions: sendTo('walk', { type: 'walk.failed' }) },

        /* ---- séquence filmée touchée dans la carte : elle s'ouvre en grand, la carte ne bouge pas ---- */
        'viewer.clipPicked': {
          actions: sendTo('cinema', ({ context, event }) => {
            // la séquence appartient à l'un des lieux dessinés : c'est lui qui en porte le crédit
            const scans = drawnScans(context.imagery.selected, context.imagery.kept);
            const scan = scans.find((candidate) => candidate.clips?.some((clip) => clip.id === event.clipId));
            const clip = scan?.clips?.find((candidate) => candidate.id === event.clipId);
            // ou bien c'est la séquence sportive sélectionnée
            if (!clip && context.sport?.clip.id === event.clipId) return { type: 'cinema.opened', clip: context.sport.clip, credit: context.sport.credit };
            // sans séquence retrouvée, un événement que la machine ignore
            return scan && clip ? { type: 'cinema.opened', clip, credit: scan.credit } : { type: 'cinema.closed', by: 'button' };
          }),
        },

        /* ---- séquence filmée : la vue se place derrière la caméra qui l'a tournée ---- */
        'app.clipRequested': {
          actions: [
            sendTo('viewer', { type: 'viewer.orbitStopped' }),
            sendTo('viewer', ({ event }) => ({ type: 'viewer.poseApplied', pose: clipViewPose(event.clip) })),
          ],
        },

        /* ---- autoroutes : un tracé à l'échelle du territoire, dessiné tout entier quand son calque est allumé ---- */
        'motorways.changed': {
          actions: [
            assign({
              traces: ({ event }) => event.traces,
              view: ({ context, event }) =>
                ({ ...context.view, overlays: { ...context.view.overlays, motorways: event.visible } }),
            }),
            'drawImagery',
            // les numéros des routes, posés le long du tracé
            sendTo('viewer', ({ event }) => ({
              type: 'viewer.overlayChanged',
              layer: 'motorways',
              features: event.traces.flatMap((trace) => (trace.labels ?? []).map((label, at) =>
                ({ id: `${trace.id}-${at}`, x: label.x, y: label.y, label: label.text, rank: label.rank }))),
            })),
            'syncUrl',
          ],
        },
        /* ---- réglages : la définition choisie vaut pour tout ce qui est dessiné, et se change à chaud ---- */
        'settings.changed': {
          actions: [
            assign({ definition: ({ event }) => event.definition }),
            'drawImagery',
            sendTo('viewer', ({ context }) => ({
              type: 'viewer.satelliteChanged',
              images: context.satellite.length > 0 ? context.satellite.map((image) => satelliteIn(image, context.definition)) : null,
            })),
          ],
        },

        /* ---- vue satellite : la carte vue du dessus, les prises de vue redressées tendues au-dessus du relief ---- */
        'satellite.changed': [
          {
            // aucune image à portée de la vue : on est emmené au-dessus de la plus proche
            guard: ({ context, event }) => event.active && satelliteDestination(event.images, context.view.pose) !== null,
            actions: [
              assign({ satellite: ({ event }) => event.images }),
              sendTo('viewer', ({ context, event }) =>
                ({ type: 'viewer.satelliteChanged', images: event.images.map((image) => satelliteIn(image, context.definition)) })),
              sendTo('viewer', ({ context, event }) =>
                ({ type: 'viewer.poseApplied', pose: satelliteDestination(event.images, context.view.pose)! })),
            ],
          },
          {
            // sinon la vue reste où elle est, et se redresse seulement
            actions: [
              assign({ satellite: ({ event }) => event.images }),
              sendTo('viewer', ({ context, event }) => ({
                type: 'viewer.satelliteChanged',
                images: event.active ? event.images.map((image) => satelliteIn(image, context.definition)) : null,
              })),
            ],
          },
        ],
        'motorways.flyRequested': {
          actions: sendTo('viewer', ({ event }) =>
            ({ type: 'viewer.flyoverRequested', flyover: { ...scanFlyover(event.trace), orbit: false } })),
        },

        /* ---- coordonnées du point visé, et position de l'appareil du visiteur ---- */
        // à pied, la vue de carte est tenue à l'aplomb du promeneur et dans son cap : ce sont les siens que l'on copie
        'app.coordinatesRequested': {
          actions: sendTo('coordinates', ({ context }) => ({
            type: 'coordinates.copyRequested',
            x: context.view.pose.x,
            y: context.view.pose.y,
            ...(context.walk ? { azimuth: context.view.pose.azimuth } : {}),
            // la vue elle-même : le lien qui la rouvre telle que le visiteur la voit
            view: viewUrl(context.view, location.href),
          })),
        },
        'location.changed': {
          actions: [assign({ device: ({ context, event }) => event.position ?? context.device }), sendTo('viewer', ({ event }) => ({
            type: 'viewer.overlayChanged',
            layer: 'location',
            features: event.position
              ? [{ id: 'visiteur', x: event.position.x, y: event.position.y, label: locationLabel(event.position), rank: 0 }] : [],
          }))],
        },
        'location.flyRequested': {
          actions: sendTo('viewer', ({ event }) => ({
            type: 'viewer.flyoverRequested',
            flyover: { x: event.position.x, y: event.position.y, height: locationHeight(event.position), orbit: false },
          })),
        },

        /* ---- trafic fluvial : coques, sélection, fiche du bateau ---- */
        'vessels.changed': {
          actions: [
            assign({
              view: ({ context, event }) =>
                ({ ...context.view, overlays: { ...context.view.overlays, vessels: event.visible } }),
            }),
            sendTo('viewer', ({ event }) =>
              ({ type: 'viewer.overlayChanged', layer: 'vessels', features: event.features })),
            'syncUrl',
          ],
        },
        'vessels.selectionChanged': {
          actions: [
            sendTo('viewer', ({ event }) =>
              ({ type: 'viewer.overlayActivated', layer: 'vessels', id: event.vessel?.id ?? null })),
            sendTo('chrome', ({ event }) => (event.vessel
              ? { type: 'chrome.revealed', panel: 'vessels' }
              : { type: 'chrome.dismissed', panel: 'vessels' })),
          ],
        },
        'vessels.flyRequested': {
          actions: sendTo('viewer', ({ event }) => ({
            type: 'viewer.flyoverRequested',
            flyover: { x: event.x, y: event.y, height: event.height, orbit: false },
          })),
        },

        /* ---- avions en direct : marqueurs, sélection, poste de pilotage ---- */
        'aircraft.changed': {
          actions: [
            assign({
              view: ({ context, event }) =>
                ({ ...context.view, overlays: { ...context.view.overlays, aircraft: event.visible } }),
            }),
            sendTo('viewer', ({ event }) =>
              ({ type: 'viewer.overlayChanged', layer: 'aircraft', features: event.features })),
            'syncUrl',
          ],
        },
        'aircraft.selectionChanged': {
          actions: [
            sendTo('viewer', ({ event }) =>
              ({ type: 'viewer.overlayActivated', layer: 'aircraft', id: event.aircraft?.id ?? null })),
            sendTo('chrome', ({ event }) => (event.aircraft
              ? { type: 'chrome.revealed', panel: 'aircraft' }
              : { type: 'chrome.dismissed', panel: 'aircraft' })),
          ],
        },
        // la quatrième dimension : la trajectoire de l'appareil sélectionné, passée et estimée
        'aircraft.tracked': { actions: sendTo('trajectory', ({ event }) => ({ type: 'trajectory.aircraftChanged', aircraft: event.aircraft, track: event.track })) },
        'trajectory.changed': {
          actions: sendTo('viewer', ({ event }) =>
            ({ type: 'viewer.trajectoryChanged', past: event.past, future: event.future, cursor: event.cursor })),
        },
        'aircraft.followChanged': {
          actions: sendTo('viewer', ({ event }) => ({ type: 'viewer.followChanged', target: event.target })),
        },
        // le visiteur a repris la main sur la carte : il n'est plus au poste de pilotage
        'viewer.followEnded': { actions: sendTo('aircraft', { type: 'aircraft.cockpitLeft' }) },
        'aircraft.flyRequested': {
          actions: sendTo('viewer', ({ event }) => ({
            type: 'viewer.flyoverRequested',
            flyover: {
              x: event.x, y: event.y, height: event.height, orbit: false,
              // l'avion est en l'air : c'est lui, et non le sol sous lui, qui doit être au centre de la vue
              ...(event.altitude === null ? {} : { aimAltitude: event.altitude }),
            },
          })),
        },

        /* ---- partage : on capture d'abord la pose exacte, orbite comprise ---- */
        'app.shareRequested': {
          actions: sendTo('viewer', { type: 'viewer.poseCaptureRequested' }),
        },
        'viewer.poseCaptured': {
          actions: [
            assign({ view: ({ context, event }) => ({ ...context.view, pose: event.pose }) }),
            'syncUrl',
            sendTo('share', ({ context }) => ({
              type: 'share.started',
              request: {
                url: viewUrl(context.view, location.href),
                title: PROJECT.name,
                text: `${PROJECT.name} — ${PROJECT.tagline}`,
              },
            })),
          ],
        },

        'app.homeRequested': {
          // retour à la maison : la vue d'accueil, et ce qu'elle montre — l'imagerie aérienne allumée, la citadelle et les lettres dessinées
          actions: enqueueActions(({ context, enqueue }) => {
            enqueue.sendTo('viewer', { type: 'viewer.poseApplied', pose: homePose(innerWidth / innerHeight) });
            if (!context.view.overlays.scans) enqueue.sendTo('layers', { type: 'layers.toggled', layer: AERIAL_LAYER });
            enqueue.sendTo('layers', { type: 'layers.keepEnsured', layer: AERIAL_LAYER, ids: HOME_IMAGERY });
            // la vue d'accueil ne joue aucune séquence filmée : celle qui était active est relâchée
            enqueue.sendTo('layers', { type: 'layers.dismissed', layer: SPORTS_LAYER });
          }),
        },

        // chaque calque lâche sa sélection ; celui qui n'en a pas n'en fait rien
        'app.selectionDismissed': {
          actions: [
            sendTo('aircraft', { type: 'aircraft.dismissed' }),
            sendTo('vessels', { type: 'vessels.dismissed' }),
            sendTo('cameras', { type: 'cameras.dismissed' }),
            sendTo('layers', { type: 'layers.dismissed', layer: AERIAL_LAYER }),
            sendTo('layers', { type: 'layers.dismissed', layer: ORTHO_LAYER }),
            sendTo('layers', { type: 'layers.dismissed', layer: CLOUD_LAYER }),
            sendTo('layers', { type: 'layers.dismissed', layer: SPORTS_LAYER }),
            sendTo('layers', { type: 'layers.dismissed', layer: DRONES_LAYER }),
            sendTo('layers', { type: 'layers.dismissed', layer: OBJECTS_LAYER }),
            sendTo('layers', { type: 'layers.dismissed', layer: SURVIVAL_LAYER }),
            sendTo('layers', { type: 'layers.dismissed', layer: FUN_LAYER }),
            sendTo('layers', { type: 'layers.dismissed', layer: ART_LAYER }),
            sendTo('layers', { type: 'layers.dismissed', layer: BACKED_LAYER }),
          ],
        },
      },
    },
  },
});

export type AppActor = ActorRefFrom<typeof appMachine>;
export type AppSnapshot = SnapshotFrom<typeof appMachine>;
