/**
 * Machine de la localisation : demande sa position à l'appareil du visiteur et
 * la porte sur la carte par un repère. Un second appui retire le repère.
 *
 *   off ──▶ locating ──▶ shown ──▶ off
 *               └──▶ failed ──(un instant)──▶ off
 *
 * La position reste dans le navigateur : elle n'est ni envoyée, ni conservée,
 * ni inscrite dans le lien de partage.
 */

import { assign, fromPromise, sendParent, setup, type SnapshotFrom } from 'xstate';
import { LOCATION_FAILURES, type DevicePosition, type LocationFailure } from '../domain/whereabouts.ts';
import { locateDevice } from '../services/whereabouts.ts';

export type LocationEvent = { type: 'location.toggled' };

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
      on: { 'location.toggled': 'off' },
    },
    failed: {
      after: { [NOTICE_MS]: 'off' },
      on: { 'location.toggled': 'locating' },
    },
  },
});

/* ------------------------------------------------------------- lecture --- */

type LocationSnapshot = SnapshotFrom<typeof locationMachine>;

/** Ce qu'il y a à dire au visiteur, s'il y a quelque chose à dire. */
export function locationNotice(snapshot: LocationSnapshot): string | null {
  if (snapshot.matches('locating')) return 'Recherche de votre position…';
  if (snapshot.matches('failed')) return LOCATION_FAILURES[snapshot.context.failure ?? 'unavailable'];
  return null;
}
