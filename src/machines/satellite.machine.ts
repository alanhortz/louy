/**
 * Machine du calque « Satellite » : des prises de vue faites à la verticale, redressées
 * en une image du sol et posées sur le relief. Un calque comme les autres — on l'allume,
 * on l'éteint — sans marqueur ni sélection : allumé, il est dessiné tout entier.
 *
 *   probing ──▶ absent                      (le site ne publie aucune image)
 *          └──▶ hidden ⇄ shown
 */

import { assign, fromPromise, sendParent, setup, type SnapshotFrom } from 'xstate';
import { satelliteScans, type Scan } from '../domain/scans.ts';
import { loadScans } from '../services/scans.ts';
import type { LayerFeed } from './places.machine.ts';

export type SatelliteEvent = { type: 'satellite.toggled' };

export type SatelliteEmitted =
  /** `mosaics` : les images à dessiner ; aucune quand le calque est éteint. */
  | { type: 'satellite.changed'; visible: boolean; mosaics: Scan[] }
  /** Le visiteur vient d'allumer le calque : la vue va se placer au-dessus de l'image. */
  | { type: 'satellite.flyRequested'; mosaic: Scan };

export const satelliteMachine = setup({
  types: {
    context: {} as { mosaics: Scan[]; startsVisible: boolean },
    events: {} as SatelliteEvent,
    input: {} as { visible: boolean } | undefined,
  },
  actors: {
    load: fromPromise<Scan[]>(async ({ signal }) => satelliteScans(await loadScans(signal))),
  },
  actions: {
    publish: sendParent(({ context }): SatelliteEmitted => ({ type: 'satellite.changed', visible: true, mosaics: context.mosaics })),
    withdraw: sendParent((): SatelliteEmitted => ({ type: 'satellite.changed', visible: false, mosaics: [] })),
    fly: sendParent(({ context }): SatelliteEmitted => ({ type: 'satellite.flyRequested', mosaic: context.mosaics[0]! })),
  },
}).createMachine({
  id: 'satellite',
  context: ({ input }) => ({ mosaics: [], startsVisible: input?.visible ?? false }),
  initial: 'probing',
  states: {
    probing: {
      invoke: {
        id: 'satellite.list',
        src: 'load',
        onDone: [
          { guard: ({ event }) => event.output.length === 0, target: 'absent' },
          { guard: ({ context }) => context.startsVisible, target: 'shown', actions: assign({ mosaics: ({ event }) => event.output }) },
          { target: 'hidden', actions: assign({ mosaics: ({ event }) => event.output }) },
        ],
        onError: 'absent',
      },
    },
    /** Rien à montrer : le calque n'est même pas proposé. */
    absent: {},
    hidden: {
      // la vue ne recule que si c'est le visiteur qui allume : un lien partagé garde la sienne
      on: { 'satellite.toggled': { target: 'shown', actions: 'fly' } },
    },
    shown: {
      entry: 'publish',
      exit: 'withdraw',
      on: { 'satellite.toggled': 'hidden' },
    },
  },
});

/* ------------------------------------------------------------- lecture --- */

type SatelliteSnapshot = SnapshotFrom<typeof satelliteMachine>;

export const satelliteAvailable = (snapshot: SatelliteSnapshot): boolean => snapshot.matches('hidden') || snapshot.matches('shown');
export const satelliteFeed = (snapshot: SatelliteSnapshot): LayerFeed => (snapshot.matches('shown') ? 'nominal' : 'off');
