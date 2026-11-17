/**
 * Machine de la vue « Satellite » : la carte vue du dessus, avec les prises de
 * vue redressées tendues au-dessus du relief. Ce n'est pas un calque : c'est une
 * façon de regarder, qu'on enclenche et qu'on quitte par le globe de la barre.
 *
 *   probing ──▶ absent                      (le site ne publie aucune image)
 *          └──▶ off ⇄ on
 */

import { assign, fromPromise, sendParent, setup, type SnapshotFrom } from 'xstate';
import type { SatelliteImage } from '../domain/satellite.ts';
import { loadSatelliteImages } from '../services/satellite.ts';

export type SatelliteEvent = { type: 'satellite.toggled' };

export type SatelliteEmitted =
  /** `byVisitor` : le visiteur vient d'enclencher la vue ; elle peut l'emmener au-dessus d'une image. */
  { type: 'satellite.changed'; active: boolean; images: SatelliteImage[]; byVisitor: boolean };

export const satelliteMachine = setup({
  types: {
    context: {} as { images: SatelliteImage[] },
    events: {} as SatelliteEvent,
  },
  actors: {
    load: fromPromise<SatelliteImage[]>(({ signal }) => loadSatelliteImages(signal)),
  },
  actions: {
    engage: sendParent(({ context }): SatelliteEmitted => ({ type: 'satellite.changed', active: true, images: context.images, byVisitor: true })),
    release: sendParent((): SatelliteEmitted => ({ type: 'satellite.changed', active: false, images: [], byVisitor: true })),
  },
}).createMachine({
  id: 'satellite',
  context: { images: [] },
  initial: 'probing',
  states: {
    probing: {
      invoke: {
        id: 'satellite.list',
        src: 'load',
        onDone: [
          { guard: ({ event }) => event.output.length === 0, target: 'absent' },
          { target: 'off', actions: assign({ images: ({ event }) => event.output }) },
        ],
        onError: 'absent',
      },
    },
    /** Rien à montrer : le globe n'est même pas proposé. */
    absent: {},
    off: {
      on: { 'satellite.toggled': 'on' },
    },
    on: {
      entry: 'engage',
      exit: 'release',
      on: { 'satellite.toggled': 'off' },
    },
  },
});

/* ------------------------------------------------------------- lecture --- */

type SatelliteSnapshot = SnapshotFrom<typeof satelliteMachine>;

export const satelliteAvailable = (snapshot: SatelliteSnapshot): boolean => snapshot.matches('off') || snapshot.matches('on');
export const satelliteActive = (snapshot: SatelliteSnapshot): boolean => snapshot.matches('on');
