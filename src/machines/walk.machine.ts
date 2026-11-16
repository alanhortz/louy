/**
 * Machine de la balade au sol : le visiteur arme l'outil, désigne un point de la
 * carte, et se retrouve debout dans le lieu filmé qui s'y trouve.
 *
 *   idle ⇄ aiming ──(point dans un lieu)──▶ arriving ──▶ walking ──▶ idle
 *
 * Elle ne connaît ni la carte ni les lieux : la machine applicative lui dit si le
 * point désigné tombe dans un lieu filmé, et le moteur quand la balade commence.
 */

import { assign, sendParent, setup, type SnapshotFrom } from 'xstate';
import type { Scan } from '../domain/scans.ts';

export type WalkEvent =
  /** L'outil : armé, il attend qu'un point soit désigné ; touché de nouveau, il se désarme. */
  | { type: 'walk.toggled' }
  /** `azimuth` : cap du regard à l'arrivée ; à défaut, celui de la carte. */
  /** `byZoom` : demandée en zoomant jusqu'au bout — on n'entre que si le sol est bien là, et l'on se tait sinon. */
  | { type: 'walk.placed'; scan: Scan; x: number; y: number; azimuth?: number; byZoom?: boolean }
  /** Le point désigné n'est dans aucun lieu filmé ; `nearest` nomme le plus proche. */
  | { type: 'walk.missed'; nearest: { name: string; distance: number } | null }
  | { type: 'walk.entered' }
  | { type: 'walk.failed' }
  | { type: 'walk.left' };

export type WalkEmitted =
  | { type: 'walk.aimChanged'; armed: boolean }
  | { type: 'walk.started'; scan: Scan; x: number; y: number; azimuth?: number; strict: boolean }
  | { type: 'walk.ended' };

interface WalkContext {
  /** Lieu où l'on marche, ou vers lequel on descend. */
  scan: Scan | null;
  /** Pourquoi le dernier point désigné n'a mené nulle part. */
  notice: string | null;
  /** La balade en cours a été demandée par le zoom : si elle échoue, c'est sans bruit. */
  byZoom: boolean;
}

/** Durée d'affichage de l'explication, quand le zoom n'a mené dans aucun lieu. */
const DECLINED_MS = 4200;

const KILOMETRES = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 1 });
const farAway = (distance: number): string =>
  (distance < 1000 ? `${Math.round(distance / 10) * 10} m` : `${KILOMETRES.format(distance / 1000)} km`);

export const walkMachine = setup({
  types: {
    context: {} as WalkContext,
    events: {} as WalkEvent,
  },
  actions: {
    announceArmed: sendParent((): WalkEmitted => ({ type: 'walk.aimChanged', armed: true })),
    announceDisarmed: sendParent((): WalkEmitted => ({ type: 'walk.aimChanged', armed: false })),
    start: sendParent(({ event }): WalkEmitted => {
      if (event.type !== 'walk.placed') throw new Error('balade sans lieu');
      return { type: 'walk.started', scan: event.scan, x: event.x, y: event.y, azimuth: event.azimuth, strict: event.byZoom === true };
    }),
    end: sendParent((): WalkEmitted => ({ type: 'walk.ended' })),
    keepScan: assign({
      scan: ({ context, event }) => (event.type === 'walk.placed' ? event.scan : context.scan),
      notice: null,
      byZoom: ({ event }) => event.type === 'walk.placed' && event.byZoom === true,
    }),
    explainMiss: assign({
      notice: ({ event }) => {
        if (event.type !== 'walk.missed' || !event.nearest) return 'Aucun lieu filmé où se poser';
        return `Aucun lieu filmé ici — le plus proche : ${event.nearest.name}, à ${farAway(event.nearest.distance)}`;
      },
    }),
    explainFailure: assign({ notice: 'Ce lieu ne se visite pas à pied' }),
    explainNearby: assign({ notice: ({ context }) => `Rien de filmé à cet endroit — visez ${context.scan?.name ?? 'un lieu de l’imagerie aérienne'}` }),
    forget: assign({ scan: null, notice: null, byZoom: false }),
  },
}).createMachine({
  id: 'walk',
  context: { scan: null, notice: null, byZoom: false },
  initial: 'idle',
  states: {
    idle: {
      entry: 'forget',
      on: {
        'walk.toggled': 'aiming',
        'walk.placed': { target: 'placed', actions: ['keepScan', 'start'] },
      },
    },
    /** L'outil est armé : le prochain point touché sur la carte est celui où l'on se pose. */
    aiming: {
      entry: 'announceArmed',
      exit: 'announceDisarmed',
      on: {
        'walk.toggled': 'idle',
        'walk.left': 'idle',
        'walk.placed': { target: 'placed', actions: ['keepScan', 'start'] },
        'walk.missed': { actions: 'explainMiss' },
      },
    },
    /** Le zoom a mené à côté d'un lieu filmé : on le dit un instant, sans rien changer à la carte. */
    declined: {
      after: { [DECLINED_MS]: 'idle' },
      on: {
        'walk.toggled': 'aiming',
        'walk.left': 'idle',
        'walk.placed': { target: 'placed', actions: ['keepScan', 'start'] },
      },
    },
    placed: {
      initial: 'arriving',
      exit: 'end',
      on: {
        'walk.left': 'idle',
        'walk.toggled': 'idle',
      },
      states: {
        /** Le lieu se charge, puis la caméra descend se poser. */
        arriving: {
          on: {
            'walk.entered': 'walking',
            'walk.failed': [
              // zoomer au bout à côté d'un lieu n'est pas une erreur : la carte reste la carte, et dit où est le lieu
              { guard: ({ context }) => context.byZoom, target: '#walk.declined', actions: 'explainNearby' },
              { target: '#walk.aiming', actions: 'explainFailure' },
            ],
          },
        },
        walking: {},
      },
    },
  },
});

/* ------------------------------------------------------------- lecture --- */

type WalkSnapshot = SnapshotFrom<typeof walkMachine>;

/** `checking` : entrée demandée par le zoom, pas encore acquise — l'interface de la carte reste en place. */
export type WalkPhase = 'idle' | 'aiming' | 'checking' | 'arriving' | 'walking' | 'declined';

export const walkPhase = (snapshot: WalkSnapshot): WalkPhase =>
  (snapshot.matches('aiming') ? 'aiming'
    : snapshot.matches('declined') ? 'declined'
    : snapshot.matches({ placed: 'arriving' }) ? (snapshot.context.byZoom ? 'checking' : 'arriving')
      : snapshot.matches({ placed: 'walking' }) ? 'walking' : 'idle');
