/**
 * Machine des réglages de l'application : ce qui vaut partout, comme les
 * réglages d'un lecteur vidéo. Pour l'heure, la définition des relevés.
 */

import { assign, sendParent, setup, type SnapshotFrom } from 'xstate';
import type { Definition } from '../domain/definition.ts';
import { storeDefinition } from '../services/definition.ts';

export type SettingsEvent = { type: 'settings.definitionChosen'; definition: Definition };

export type SettingsEmitted = { type: 'settings.changed'; definition: Definition };

export const settingsMachine = setup({
  types: {
    context: {} as { definition: Definition },
    events: {} as SettingsEvent,
    input: {} as { definition: Definition },
  },
  actions: {
    remember: ({ context }) => storeDefinition(context.definition),
    announce: sendParent(({ context }): SettingsEmitted => ({ type: 'settings.changed', definition: context.definition })),
  },
}).createMachine({
  id: 'settings',
  context: ({ input }) => ({ definition: input.definition }),
  // le choix d'une visite précédente s'applique dès l'ouverture
  entry: 'announce',
  on: {
    'settings.definitionChosen': {
      guard: ({ context, event }) => event.definition !== context.definition,
      actions: [assign({ definition: ({ event }) => event.definition }), 'remember', 'announce'],
    },
  },
});

export const chosenDefinition = (snapshot: SnapshotFrom<typeof settingsMachine>): Definition => snapshot.context.definition;
