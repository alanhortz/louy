/**
 * Machine d'activité : ce que la pastille de chargement annonce.
 *
 * Le relief se charge, puis — brièvement — est annoncé chargé, avant que la
 * pastille ne s'efface. Cet état intermédiaire n'existe que pour le visiteur :
 * il lui confirme que l'image est complète.
 */

import { assign, setup } from 'xstate';

export type ActivityEvent = { type: 'activity.changed'; loading: boolean; points: number };

/** Durée d'affichage de la confirmation de fin de chargement. */
const CONFIRMATION_MS = 1500;

export const activityMachine = setup({
  types: {
    context: {} as { points: number },
    events: {} as ActivityEvent,
  },
  guards: {
    isLoading: ({ event }) => event.loading,
    isDone: ({ event }) => !event.loading,
  },
  actions: {
    recordPoints: assign({ points: ({ event }) => event.points }),
  },
}).createMachine({
  id: 'activity',
  context: { points: 0 },
  initial: 'quiet',
  states: {
    quiet: {
      on: { 'activity.changed': { guard: 'isLoading', target: 'loading' } },
    },
    loading: {
      on: { 'activity.changed': { guard: 'isDone', target: 'complete', actions: 'recordPoints' } },
    },
    complete: {
      after: { [CONFIRMATION_MS]: 'quiet' },
      on: { 'activity.changed': { guard: 'isLoading', target: 'loading' } },
    },
  },
});
