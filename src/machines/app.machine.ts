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
 *   scans ──▶ viewer
 */

import { assign, fromCallback, sendTo, setup, type ActorRefFrom, type SnapshotFrom } from 'xstate';
import { PROJECT } from '../config/project.ts';
import { QUALITY_PROFILES } from '../domain/quality.ts';
import { scanFlyover } from '../domain/scans.ts';
import { resolveScene } from '../domain/scene.ts';
import { DEFAULT_VIEW, encodeView, viewUrl, type View } from '../domain/view.ts';
import type { SupportReport } from '../services/capabilities.ts';
import { isAcknowledged } from '../services/preferences.ts';
import type { TelemetryBuffer } from '../services/telemetry.ts';
import { acquisitionMachine } from './acquisition.machine.ts';
import { activityMachine } from './activity.machine.ts';
import { camerasMachine, type CamerasEmitted } from './cameras.machine.ts';
import { chromeMachine, type PanelId } from './chrome.machine.ts';
import { compatibilityMachine } from './compatibility.machine.ts';
import { placesMachine, type PlacesEmitted } from './places.machine.ts';
import { scansMachine, type ScansEmitted } from './scans.machine.ts';
import { sceneMachine, type SceneEmitted } from './scene.machine.ts';
import { shareMachine } from './share.machine.ts';
import { sitesMachine, type SitesEmitted } from './sites.machine.ts';
import { telemetryMachine } from './telemetry.machine.ts';
import { viewerMachine, type ViewerEmitted } from './viewer.machine.ts';

export type AppEvent =
  | { type: 'app.shareRequested' }
  | { type: 'app.homeRequested' }
  | SceneEmitted
  | ViewerEmitted
  | PlacesEmitted
  | CamerasEmitted
  | SitesEmitted
  | ScansEmitted;

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
      scans: 'scans';
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
    scans: scansMachine,
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
        { id: 'scans', src: 'scans' },
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
            sendTo('acquisition', ({ event }) => ({
              type: 'acquisition.viewChanged', x: event.pose.x, y: event.pose.y, distance: event.pose.distance,
            })),
            'syncUrl',
          ],
        },

        /* ---- le relief se charge : la pastille l'annonce ---- */
        'viewer.activityChanged': {
          actions: sendTo('activity', ({ event }) =>
            ({ type: 'activity.changed', loading: event.loading, points: event.points })),
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
            guard: ({ event }) => event.layer === 'scans',
            actions: sendTo('scans', ({ event }) => ({ type: 'scans.picked', id: event.id })),
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

        /* ---- scans 3D : un marqueur par lieu, le viewer dessine les scans, la caméra vient tourner autour ---- */
        'scans.markersChanged': {
          actions: [
            sendTo('viewer', ({ event }) =>
              ({ type: 'viewer.overlayChanged', layer: 'scans', features: event.features })),
            sendTo('viewer', ({ event }) =>
              ({ type: 'viewer.overlayActivated', layer: 'scans', id: event.activeId })),
          ],
        },
        'scans.changed': {
          actions: sendTo('viewer', ({ event }) => ({ type: 'viewer.scansChanged', scans: event.scans })),
        },
        'scans.flyRequested': {
          actions: sendTo('viewer', ({ event }) =>
            ({ type: 'viewer.flyoverRequested', flyover: scanFlyover(event.scan) })),
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
