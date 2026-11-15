/**
 * Machine des recherches récentes : elle retient ce que le visiteur choisit
 * dans la palette, le garde dans son navigateur, et le lui rend en tête de
 * liste. Choisir une recherche récente y ramène la vue, et la fait remonter.
 */

import { assign, sendParent, setup } from 'xstate';
import { recentKey, rememberSearch, type RecentSearch } from '../domain/recentSearches.ts';
import { writeRecentSearches } from '../services/recentSearches.ts';

export type RecentsEvent =
  | { type: 'recents.added'; entry: RecentSearch }
  | { type: 'recents.picked'; key: string }
  | { type: 'recents.cleared' };

export type RecentsEmitted = { type: 'recents.chosen'; entry: RecentSearch };

export const recentsMachine = setup({
  types: {
    context: {} as { list: RecentSearch[] },
    events: {} as RecentsEvent,
    input: {} as { list: RecentSearch[] },
  },
  guards: {
    picksKnownEntry: ({ context, event }) =>
      event.type === 'recents.picked' && context.list.some((entry) => recentKey(entry) === event.key),
  },
  actions: {
    remember: assign({
      list: ({ context, event }) => (event.type === 'recents.added' ? rememberSearch(context.list, event.entry) : context.list),
    }),
    /** La recherche choisie remonte en tête. */
    promote: assign({
      list: ({ context, event }) => {
        const entry = context.list.find((known) => event.type === 'recents.picked' && recentKey(known) === event.key);
        return entry ? rememberSearch(context.list, entry) : context.list;
      },
    }),
    forget: assign({ list: [] }),
    persist: ({ context }) => writeRecentSearches(context.list),
    announceChoice: sendParent(({ context }): RecentsEmitted => ({ type: 'recents.chosen', entry: context.list[0]! })),
  },
}).createMachine({
  id: 'recents',
  context: ({ input }) => ({ list: input.list }),
  on: {
    'recents.added': { actions: ['remember', 'persist'] },
    'recents.picked': { guard: 'picksKnownEntry', actions: ['promote', 'persist', 'announceChoice'] },
    'recents.cleared': { actions: ['forget', 'persist'] },
  },
});
