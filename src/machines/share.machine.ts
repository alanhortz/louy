/**
 * Machine de partage : remet au visiteur un lien vers la vue exacte qu'il
 * regarde. Feuille de partage du système sur mobile, presse-papiers ailleurs ;
 * si les deux échouent, le lien est affiché pour une copie manuelle.
 */

import { assign, fromPromise, setup } from 'xstate';
import { isDismissal, shareLink, type ShareOutcome, type ShareRequest } from '../services/share.ts';

export type ShareEvent =
  | { type: 'share.started'; request: ShareRequest }
  | { type: 'share.acknowledged' };

/** Durée d'affichage de la confirmation. */
const CONFIRMATION_MS = 2600;

export const shareMachine = setup({
  types: {
    context: {} as { request: ShareRequest | null; outcome: ShareOutcome | null },
    events: {} as ShareEvent,
  },
  actors: {
    deliver: fromPromise<ShareOutcome, ShareRequest>(({ input }) => shareLink(input)),
  },
  guards: {
    wasDismissed: ({ event }) => isDismissal((event as unknown as { error: unknown }).error),
  },
}).createMachine({
  id: 'share',
  context: { request: null, outcome: null },
  initial: 'idle',
  on: {
    'share.started': {
      target: '.delivering',
      actions: assign({ request: ({ event }) => event.request, outcome: null }),
    },
  },
  states: {
    idle: {},
    delivering: {
      invoke: {
        id: 'share.deliver',
        src: 'deliver',
        input: ({ context }) => context.request!,
        onDone: { target: 'confirmed', actions: assign({ outcome: ({ event }) => event.output }) },
        onError: [
          { guard: 'wasDismissed', target: 'idle' },
          { target: 'manual' },
        ],
      },
    },
    confirmed: {
      after: { [CONFIRMATION_MS]: 'idle' },
    },
    /** Ni partage ni presse-papiers : le lien est montré, à copier à la main. */
    manual: {
      on: { 'share.acknowledged': 'idle' },
    },
  },
});
