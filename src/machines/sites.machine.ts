/**
 * Machine des sites touristiques : une liste cherchable qui emmène le visiteur
 * au-dessus du lieu choisi. L'index n'est téléchargé qu'à la première ouverture.
 */

import { assign, fromPromise, sendParent, setup } from 'xstate';
import { loadSites, searchSites, type SiteIndexEntry, type TouristSite } from '../services/sites.ts';

export type SitesEvent =
  | { type: 'sites.opened' }
  | { type: 'sites.closed' }
  | { type: 'sites.queryChanged'; query: string }
  | { type: 'sites.picked'; id: string };

export type SitesEmitted = { type: 'sites.chosen'; site: TouristSite };

interface SitesContext {
  index: SiteIndexEntry[];
  query: string;
  results: TouristSite[];
}

export const sitesMachine = setup({
  types: {
    context: {} as SitesContext,
    events: {} as SitesEvent,
  },
  actors: {
    loadIndex: fromPromise<SiteIndexEntry[]>(({ signal }) => loadSites(signal)),
  },
  guards: {
    hasIndex: ({ context }) => context.index.length > 0,
    picksKnownSite: ({ context, event }) =>
      event.type === 'sites.picked' && context.results.some((site) => site.id === event.id),
  },
  actions: {
    search: assign(({ context, event }) => {
      const query = event.type === 'sites.queryChanged' ? event.query : context.query;
      return { query, results: searchSites(context.index, query) };
    }),
    announceChoice: sendParent(({ context, event }): SitesEmitted => ({
      type: 'sites.chosen',
      site: context.results.find((site) => event.type === 'sites.picked' && site.id === event.id)!,
    })),
  },
}).createMachine({
  id: 'sites',
  context: { index: [], query: '', results: [] },
  initial: 'closed',
  states: {
    closed: {
      on: {
        'sites.opened': [{ guard: 'hasIndex', target: 'open' }, { target: 'loading' }],
      },
    },
    loading: {
      invoke: {
        id: 'sites.index',
        src: 'loadIndex',
        onDone: { target: 'open', actions: [assign({ index: ({ event }) => event.output }), 'search'] },
        onError: 'failed',
      },
      on: {
        'sites.closed': 'closed',
        // la saisie n'attend pas l'index : elle sera appliquée à son arrivée
        'sites.queryChanged': { actions: assign({ query: ({ event }) => event.query }) },
      },
    },
    open: {
      on: {
        'sites.queryChanged': { actions: 'search' },
        'sites.picked': { guard: 'picksKnownSite', target: 'closed', actions: 'announceChoice' },
        'sites.closed': 'closed',
      },
    },
    failed: {
      on: {
        'sites.opened': 'loading',
        'sites.closed': 'closed',
      },
    },
  },
});
