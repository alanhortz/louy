/**
 * Machine de la vue « cinéma » : une séquence filmée, regardée en grand. On y
 * entre en touchant l'écran de la séquence dans la carte ; on en sort là où
 * l'on était — la carte n'a pas bougé pendant la séance.
 */

import { assign, setup, type SnapshotFrom } from 'xstate';
import type { ScanClip } from '../domain/clips.ts';
import type { ScanCredit } from '../domain/scans.ts';

export type CinemaEvent =
  | { type: 'cinema.opened'; clip: ScanClip; credit: ScanCredit }
  | { type: 'cinema.closed'; by: 'button' | 'escape' | 'backdrop' };

export const cinemaMachine = setup({
  types: {
    context: {} as { clip: ScanClip | null; credit: ScanCredit | null },
    events: {} as CinemaEvent,
  },
}).createMachine({
  id: 'cinema',
  context: { clip: null, credit: null },
  initial: 'closed',
  states: {
    closed: {
      on: {
        'cinema.opened': { target: 'open', actions: assign({ clip: ({ event }) => event.clip, credit: ({ event }) => event.credit }) },
      },
    },
    open: {
      on: {
        'cinema.closed': { target: 'closed', actions: assign({ clip: null, credit: null }) },
        // une autre séquence touchée pendant la séance la remplace
        'cinema.opened': { actions: assign({ clip: ({ event }) => event.clip, credit: ({ event }) => event.credit }) },
      },
    },
  },
});

export const cinemaOpen = (snapshot: SnapshotFrom<typeof cinemaMachine>): boolean => snapshot.matches('open');
