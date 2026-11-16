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

import { assign, fromCallback, sendTo, setup, type ActorRefFrom, type SnapshotFrom } from 'xstate';
import { PROJECT } from '../config/project.ts';
import { QUALITY_PROFILES } from '../domain/quality.ts';
import { fitFlyover, scanFlyover, type Scan } from '../domain/scans.ts';
import { resolveScene } from '../domain/scene.ts';
import { timelineSteps, timelineTint, type FilmFraming } from '../domain/timeline.ts';
import { DEFAULT_VIEW, HOME_IMAGERY, encodeView, viewUrl, type View } from '../domain/view.ts';
import type { SupportReport } from '../services/capabilities.ts';
import { isAcknowledged } from '../services/preferences.ts';
import { readRecentSearches } from '../services/recentSearches.ts';
import type { TelemetryBuffer } from '../services/telemetry.ts';
import { acquisitionMachine } from './acquisition.machine.ts';
import { activityMachine } from './activity.machine.ts';
import { aircraftMachine, type AircraftEmitted } from './aircraft.machine.ts';
import { vesselsMachine, type VesselsEmitted } from './vessels.machine.ts';
import { camerasMachine, type CamerasEmitted } from './cameras.machine.ts';
import { chromeMachine, type PanelId } from './chrome.machine.ts';
import { compatibilityMachine } from './compatibility.machine.ts';
import { objectMachine, type ObjectEmitted } from './object.machine.ts';
import { placesMachine, type PlacesEmitted } from './places.machine.ts';
import { createLayersMachine, type LayersEmitted } from './layers.machine.ts';
import {
  AERIAL_LAYER, ART_LAYER, FUN_LAYER, OBJECTS_LAYER, SURVIVAL_LAYER,
  aerialLayer, artLayer, drawnScans, funLayer, objectsLayer, survivalLayer,
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
import { cinemaMachine } from './cinema.machine.ts';
import { locationHeight, nearDevice, type DevicePosition } from '../domain/whereabouts.ts';
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
  | LayersEmitted<Scan>
  | ObjectEmitted
  | AircraftEmitted
  | VesselsEmitted
  | FilmsEmitted
  | TimelineEmitted
  | TrajectoryEmitted
  | WalkEmitted
  | LocationEmitted
  | MotorwaysEmitted;

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
  /** Position de l'appareil, si le visiteur l'a demandée : en mémoire seulement, pour ne jamais l'écrire dans l'adresse. */
  device: DevicePosition | null;
  /** Tracés dessinés par le calque « Autoroutes » : aucun quand il est éteint. */
  traces: Scan[];
}

/** Hauteur de survol d'un site touristique, et d'une caméra routière. */
const SITE_HEIGHT = 200;
/** Hauteur de survol d'une rue : assez bas pour lire son tracé et les noms des rues voisines. */
const STREET_HEIGHT = 320;
const CAMERA_HEIGHT = 450;

/**
 * Panneau déplié à l'ouverture — un seul, le rail n'en montre qu'un à la fois.
 * L'aide à la navigation s'ouvre tant que le visiteur ne l'a pas refermée
 * lui-même ; ensuite, un grand écran ouvre sur les calques et un petit écran
 * laisse toute la place à la carte.
 */
function initialPanels(context: AppContext): PanelId[] {
  if (!isAcknowledged('controls')) return ['controls'];
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
    layers: createLayersMachine([aerialLayer, objectsLayer, artLayer, survivalLayer, funLayer]),
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
    /** Dessine dans la carte l'imagerie sélectionnée et celles que le visiteur garde affichées. */
    drawImagery: sendTo('viewer', ({ context }) =>
      ({
        type: 'viewer.scansChanged',
        scans: [
          ...drawnScans(context.imagery.selected, context.walk ? [context.walk, ...context.imagery.kept.filter((scan) => scan !== context.walk)] : context.imagery.kept),
          ...context.traces,
        ],
      })),
  },
}).createMachine({
  id: 'app',
  context: ({ input }) => ({ ...input, support: null, imagery: { selected: null, kept: [] }, places: [], walk: null, device: null, traces: [] }),
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
            sharpStart: context.startsAtHome,
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
            },
            // à l'accueil, la citadelle est déjà là, reconstruite, sous la caméra qui en fait le tour
            kept: (context.startsAtHome ? { [AERIAL_LAYER]: HOME_IMAGERY } : {}) as Record<string, readonly string[]>,
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
            guard: ({ event }) => [AERIAL_LAYER, OBJECTS_LAYER, SURVIVAL_LAYER, FUN_LAYER, ART_LAYER].includes(event.layer),
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
              sendTo('viewer', ({ event }) => ({ type: 'viewer.scansPreloaded', scans: event.items })),
            ],
          },
          { guard: ({ event }) => event.layer === AERIAL_LAYER, actions: assign({ places: ({ event }) => event.items }) },
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
            // une imagerie aérienne sélectionnée est dessinée dans la carte, et son panneau s'ouvre
            guard: ({ event }) => event.layer === AERIAL_LAYER,
            actions: [
              assign({ imagery: ({ context, event }) => ({ ...context.imagery, selected: event.item }) }),
              sendTo('viewer', ({ event }) =>
                ({ type: 'viewer.overlayActivated', layer: event.layer as OverlayName, id: event.markerId })),
              'drawImagery',
              sendTo('chrome', ({ event }) => (event.item
                ? { type: 'chrome.revealed', panel: 'imagery' }
                : { type: 'chrome.dismissed', panel: 'imagery' })),
            ],
          },
          {
            actions: sendTo('viewer', ({ event }) =>
              ({ type: 'viewer.overlayActivated', layer: event.layer as OverlayName, id: event.markerId })),
          },
        ],
        // les imageries que le visiteur garde affichées restent dessinées, quelle que soit la sélection
        'layers.keptChanged': {
          guard: ({ event }) => event.layer === AERIAL_LAYER,
          actions: [assign({ imagery: ({ context, event }) => ({ ...context.imagery, kept: event.items }) }), 'drawImagery'],
        },
        // le marqueur touché rassemble plusieurs lieux : la caméra s'en approche, et chacun retrouve le sien
        'layers.expandRequested': {
          actions: sendTo('viewer', ({ event }) => ({ type: 'viewer.flyoverRequested', flyover: fitFlyover(event.items) })),
        },
        // l'élément vient d'être désigné : un objet s'ouvre dans sa visionneuse, la caméra se rend sur un lieu
        'layers.activated': [
          {
            // objets scannés, équipements de survie et objets de loisir s'examinent dans la même visionneuse
            guard: ({ event }) => [OBJECTS_LAYER, SURVIVAL_LAYER, FUN_LAYER, ART_LAYER].includes(event.layer),
            actions: sendTo('object', ({ event }) => ({ type: 'object.opened', scan: event.item, group: event.siblings })),
          },
          {
            actions: sendTo('viewer', ({ event }) =>
              ({ type: 'viewer.flyoverRequested', flyover: scanFlyover(event.item) })),
          },
        ],
        // la visionneuse refermée, son objet n'est plus sélectionné
        'object.left': {
          actions: [
            sendTo('layers', { type: 'layers.dismissed', layer: OBJECTS_LAYER }),
            sendTo('layers', { type: 'layers.dismissed', layer: SURVIVAL_LAYER }),
            sendTo('layers', { type: 'layers.dismissed', layer: FUN_LAYER }),
            sendTo('layers', { type: 'layers.dismissed', layer: ART_LAYER }),
          ],
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
        // comme dans une carte grand public : zoomer encore, au plus près d'un lieu filmé, y fait entrer à pied
        'viewer.zoomedThrough': {
          guard: ({ context, event }) => context.view.overlays.scans && context.walk === null
            && (nearestPlace(context.places, event.x, event.y)?.distance ?? Infinity) <= WALK_REACH,
          actions: sendTo('walk', ({ context, event }) =>
            ({ type: 'walk.placed', scan: nearestPlace(context.places, event.x, event.y)!.scan, x: event.x, y: event.y, byZoom: true })),
        },
        // le lieu est dessiné même si son calque est éteint ; la balade commence dès qu'il est arrivé
        'walk.started': {
          actions: [
            assign({ walk: ({ event }) => event.scan }),
            'drawImagery',
            sendTo('viewer', ({ event }) => ({ type: 'viewer.walkRequested', scanId: event.scan.id, x: event.x, y: event.y, azimuth: event.azimuth, strict: event.strict })),
          ],
        },
        'walk.ended': {
          actions: [assign({ walk: null }), sendTo('viewer', { type: 'viewer.walkStopped' }), 'drawImagery'],
        },
        'viewer.walkEntered': { actions: sendTo('walk', { type: 'walk.entered' }) },
        'viewer.walkFailed': { actions: sendTo('walk', { type: 'walk.failed' }) },

        /* ---- séquence filmée touchée dans la carte : elle s'ouvre en grand, la carte ne bouge pas ---- */
        'viewer.clipPicked': {
          actions: sendTo('cinema', ({ context, event }) => {
            // la séquence appartient à l'un des lieux dessinés : c'est lui qui en porte le crédit
            const scans = drawnScans(context.imagery.selected, context.imagery.kept);
            const scan = scans.find((candidate) => candidate.clips?.some((clip) => clip.id === event.clipId));
            const clip = scan?.clips?.find((candidate) => candidate.id === event.clipId);
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
          })),
        },
        'location.changed': {
          actions: [assign({ device: ({ context, event }) => event.position ?? context.device }), sendTo('viewer', ({ event }) => ({
            type: 'viewer.overlayChanged',
            layer: 'location',
            features: event.position
              ? [{ id: 'visiteur', x: event.position.x, y: event.position.y, label: 'Vous êtes ici', rank: 0 }] : [],
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
          actions: sendTo('viewer', { type: 'viewer.poseApplied', pose: DEFAULT_VIEW.pose, sharpen: true }),
        },

        // chaque calque lâche sa sélection ; celui qui n'en a pas n'en fait rien
        'app.selectionDismissed': {
          actions: [
            sendTo('aircraft', { type: 'aircraft.dismissed' }),
            sendTo('vessels', { type: 'vessels.dismissed' }),
            sendTo('cameras', { type: 'cameras.dismissed' }),
            sendTo('layers', { type: 'layers.dismissed', layer: AERIAL_LAYER }),
            sendTo('layers', { type: 'layers.dismissed', layer: OBJECTS_LAYER }),
            sendTo('layers', { type: 'layers.dismissed', layer: SURVIVAL_LAYER }),
            sendTo('layers', { type: 'layers.dismissed', layer: FUN_LAYER }),
            sendTo('layers', { type: 'layers.dismissed', layer: ART_LAYER }),
          ],
        },
      },
    },
  },
});

export type AppActor = ActorRefFrom<typeof appMachine>;
export type AppSnapshot = SnapshotFrom<typeof appMachine>;
