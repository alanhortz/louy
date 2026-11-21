/**
 * Machine de la localisation : demande sa position à l'appareil du visiteur et
 * la porte sur la carte par un repère. Un second appui retire le repère. Sur un
 * appareil tenu en main, le repère suit ensuite le visiteur, avec sa vitesse.
 *
 *   off ──▶ locating ──▶ shown ──▶ off
 *               └──▶ failed ──(un instant)──▶ off
 *
 * La position n'existe qu'en mémoire, le temps de la page : elle n'est ni envoyée,
 * ni écrite dans le journal local (l'inspecteur la masque), ni inscrite dans l'adresse.
 */

import { assign, fromCallback, fromPromise, sendParent, setup, type SnapshotFrom } from 'xstate';
import { LOCATION_FAILURES, type DevicePosition, type LocationFailure } from '../domain/whereabouts.ts';
import { locateDevice, watchDevice } from '../services/whereabouts.ts';

export type LocationEvent =
  | { type: 'location.toggled' }
  /** L'appareil a bougé : un nouveau relevé du suivi continu. */
  | { type: 'location.moved'; position: DevicePosition };

export type LocationEmitted =
  /** `null` : le repère est retiré. */
  | { type: 'location.changed'; position: DevicePosition | null }
  | { type: 'location.flyRequested'; position: DevicePosition };

/** Durée d'affichage de la raison d'un échec. */
const NOTICE_MS = 4000;

export const locationMachine = setup({
  types: {
    context: {} as { position: DevicePosition | null; failure: LocationFailure | null },
    events: {} as LocationEvent,
  },
  actors: {
    locate: fromPromise<DevicePosition>(() => locateDevice()),
    follow: fromCallback<LocationEvent>(({ sendBack }) => watchDevice((position) => sendBack({ type: 'location.moved', position }))),
  },
  actions: {
    announce: sendParent(({ context }): LocationEmitted => ({ type: 'location.changed', position: context.position })),
    fly: sendParent(({ context }): LocationEmitted => ({ type: 'location.flyRequested', position: context.position! })),
  },
}).createMachine({
  id: 'location',
  context: { position: null, failure: null },
  initial: 'off',
  states: {
    off: {
      on: { 'location.toggled': 'locating' },
    },
    /** Le navigateur interroge l'appareil — et d'abord le visiteur, la première fois. */
    locating: {
      invoke: {
        id: 'location.locate',
        src: 'locate',
        onDone: { target: 'shown', actions: assign({ position: ({ event }) => event.output, failure: null }) },
        onError: {
          target: 'failed',
          actions: assign({
            failure: ({ event }) => (typeof event.error === 'string' && event.error in LOCATION_FAILURES
              ? event.error as LocationFailure : 'unavailable'),
          }),
        },
      },
      on: { 'location.toggled': 'off' },
    },
    shown: {
      entry: ['announce', 'fly'],
      exit: [assign({ position: null }), 'announce'],
      // le suivi dure tant que le repère est affiché : le retirer l'arrête
      invoke: { id: 'location.follow', src: 'follow' },
      on: {
        'location.toggled': 'off',
        // le repère se déplace ; la vue, elle, reste où le visiteur l'a mise
        'location.moved': { actions: [assign({ position: ({ event }) => event.position }), 'announce'] },
      },
    },
    failed: {
      after: { [NOTICE_MS]: 'off' },
      on: { 'location.toggled': 'locating' },
    },
  },
});

/* ------------------------------------------------------------- lecture --- */

type LocationSnapshot = SnapshotFrom<typeof locationMachine>;

/** Clef de traduction de ce qu'il y a à dire au visiteur, s'il y a quelque chose à dire. */
export type LocationNoticeKey = 'location.locating' | (typeof LOCATION_FAILURES)[keyof typeof LOCATION_FAILURES];
export function locationNotice(snapshot: LocationSnapshot): LocationNoticeKey | null {
  if (snapshot.matches('locating')) return 'location.locating';
  if (snapshot.matches('failed')) return LOCATION_FAILURES[snapshot.context.failure ?? 'unavailable'];
  return null;
}
