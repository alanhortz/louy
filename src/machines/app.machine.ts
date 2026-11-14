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
 *   layers (imagerie 3D) ──▶ viewer, object    aircraft ⇄ viewer
 *   films ──▶ viewer, timeline             timeline ⇄ viewer
 */

import { assign, fromCallback, sendTo, setup, type ActorRefFrom, type SnapshotFrom } from 'xstate';
import { PROJECT } from '../config/project.ts';
import { QUALITY_PROFILES } from '../domain/quality.ts';
import { isObjectScan, placeScans, scanFlyover, type Scan } from '../domain/scans.ts';
import { resolveScene } from '../domain/scene.ts';
import { timelineSteps, timelineTint, type FilmFraming } from '../domain/timeline.ts';
import { DEFAULT_VIEW, encodeView, viewUrl, type View } from '../domain/view.ts';
import type { SupportReport } from '../services/capabilities.ts';
import { isAcknowledged } from '../services/preferences.ts';
import type { TelemetryBuffer } from '../services/telemetry.ts';
import { acquisitionMachine } from './acquisition.machine.ts';
import { activityMachine } from './activity.machine.ts';
import { aircraftMachine, type AircraftEmitted } from './aircraft.machine.ts';
import { camerasMachine, type CamerasEmitted } from './cameras.machine.ts';
import { chromeMachine, type PanelId } from './chrome.machine.ts';
import { compatibilityMachine } from './compatibility.machine.ts';
import { objectMachine, type ObjectEmitted } from './object.machine.ts';
import { placesMachine, type PlacesEmitted } from './places.machine.ts';
import { createLayersMachine, type LayersEmitted } from './layers.machine.ts';
import { SCANS_LAYER, drawnScans, scansLayer } from './scans.layer.ts';
import type { OverlayName } from './actors/engine.actor.ts';
import { filmsMachine, type FilmsEmitted } from './films.machine.ts';
import { sceneMachine, type SceneEmitted } from './scene.machine.ts';
import { shareMachine } from './share.machine.ts';
import { sitesMachine, type SitesEmitted } from './sites.machine.ts';
import { telemetryMachine } from './telemetry.machine.ts';
import { timelineMachine, type TimelineEmitted } from './timeline.machine.ts';

/** Cadrage du film tourné qui remplit le mieux l'écran : debout sur un téléphone tenu droit. */
const filmFraming = (): FilmFraming =>
  (typeof window !== 'undefined' && window.innerHeight > window.innerWidth ? 'portrait' : 'paysage');
import { viewerMachine, type ViewerEmitted } from './viewer.machine.ts';

export type AppEvent =
  | { type: 'app.shareRequested' }
  | { type: 'app.homeRequested' }
  | { type: 'app.timelineRequested' }
  | SceneEmitted
  | ViewerEmitted
  | PlacesEmitted
  | CamerasEmitted
  | SitesEmitted
  | LayersEmitted<Scan>
  | ObjectEmitted
  | AircraftEmitted
  | FilmsEmitted
  | TimelineEmitted;

export interface AppInput {
  /** Vue lue dans l'URL au chargement. */
  view: View;
  /** Aucun point de vue dans l'URL : on ouvre sur la vue d'accueil, à pleine précision. */
  startsAtHome: boolean;
  buffer: TelemetryBuffer;
}

interface AppContext extends AppInput {
  support: SupportReport | null;
}

/** Hauteur de survol d'un site touristique, et d'une caméra routière. */
const SITE_HEIGHT = 200;
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
      layers: 'layers';
      object: 'object';
      aircraft: 'aircraft';
      films: 'films';
      timeline: 'timeline';
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
    // les calques à sélection naissent tous du même état générique, sous un orchestrateur
    layers: createLayersMachine([scansLayer]),
    object: objectMachine,
    aircraft: aircraftMachine,
    films: filmsMachine,
    timeline: timelineMachine,
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
      history.replaceState(null, '', `#${encodeView(context.view)}`);
    },
  },
}).createMachine({
  id: 'app',
  context: ({ input }) => ({ ...input, support: null }),
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
          id: 'layers',
          src: 'layers',
          input: ({ context }) => ({ visible: { [SCANS_LAYER]: context.view.overlays.scans }, distance: context.view.pose.distance }),
        },
        { id: 'object', src: 'object' },
        { id: 'aircraft', src: 'aircraft', input: ({ context }) => ({ visible: context.view.overlays.aircraft }) },
        { id: 'films', src: 'films' },
        { id: 'timeline', src: 'timeline' },
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
            guard: ({ event }) => event.layer === 'scans',
            actions: sendTo('layers', ({ event }) => ({ type: 'layers.picked', layer: SCANS_LAYER, id: event.id })),
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

        /* ---- sites touristiques : survol à 200 m, en orbite ---- */
        'sites.chosen': {
          actions: sendTo('viewer', ({ event }) => ({
            type: 'viewer.flyoverRequested',
            flyover: { x: event.site.x, y: event.site.y, height: SITE_HEIGHT, orbit: true },
          })),
        },

        /* ---- calques à sélection (imagerie 3D) : leurs marqueurs, puis l'élément que l'on sélectionne ---- */
        // la liste des scans est connue : les lieux sont préparés d'avance, pour s'afficher sans attente
        'layers.listed': {
          // calque éteint, rien n'est préparé : ce serait télécharger ce que le visiteur a choisi de ne pas voir
          guard: ({ context, event }) => event.layer === SCANS_LAYER && context.view.overlays.scans,
          actions: sendTo('viewer', ({ event }) => ({ type: 'viewer.scansPreloaded', scans: placeScans(event.items) })),
        },
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
        'layers.selectionChanged': {
          actions: [
            sendTo('viewer', ({ event }) =>
              ({ type: 'viewer.overlayActivated', layer: event.layer as OverlayName, id: event.markerId })),
            // le lieu sélectionné est dessiné dans la carte ; il s'en retire avec la sélection
            sendTo('viewer', ({ event }) => ({ type: 'viewer.scansChanged', scans: drawnScans(event.item) })),
          ],
        },
        // l'élément vient d'être désigné : un objet s'ouvre dans sa visionneuse, la caméra se rend sur un lieu
        'layers.activated': [
          {
            guard: ({ event }) => isObjectScan(event.item),
            actions: sendTo('object', ({ event }) => ({ type: 'object.opened', scan: event.item, group: event.siblings })),
          },
          {
            actions: sendTo('viewer', ({ event }) =>
              ({ type: 'viewer.flyoverRequested', flyover: scanFlyover(event.item) })),
          },
        ],
        // la visionneuse refermée, son objet n'est plus sélectionné
        'object.left': { actions: sendTo('layers', { type: 'layers.dismissed', layer: SCANS_LAYER }) },

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
        'aircraft.followChanged': {
          actions: sendTo('viewer', ({ event }) => ({ type: 'viewer.followChanged', target: event.target })),
        },
        // le visiteur a repris la main sur la carte : il n'est plus au poste de pilotage
        'viewer.followEnded': { actions: sendTo('aircraft', { type: 'aircraft.cockpitLeft' }) },
        'aircraft.flyRequested': {
          actions: sendTo('viewer', ({ event }) => ({
            type: 'viewer.flyoverRequested',
            flyover: { x: event.x, y: event.y, height: event.height, orbit: false },
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
      },
    },
  },
});

export type AppActor = ActorRefFrom<typeof appMachine>;
export type AppSnapshot = SnapshotFrom<typeof appMachine>;
