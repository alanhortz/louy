/**
 * Machine de recherche de rues : même palette que les sites touristiques, mais
 * la liste vient du géocodeur du SPW. Chaque saisie attend un court instant
 * que le visiteur ait fini de taper, puis une seule requête part ; une saisie
 * qui change entre-temps annule la précédente.
 *
 *   closed ──▶ idle ──(saisie)──▶ debouncing ──▶ searching ──▶ idle
 */

import { assign, fromPromise, sendParent, setup } from 'xstate';
import { streetQuery, type Street } from '../domain/streets.ts';
import { searchStreets } from '../services/streets.ts';

export type StreetSearchEvent =
  | { type: 'streetSearch.opened' }
  | { type: 'streetSearch.closed' }
  | { type: 'streetSearch.queryChanged'; query: string }
  | { type: 'streetSearch.picked'; id: string };

export type StreetSearchEmitted = { type: 'streetSearch.chosen'; street: Street };

interface StreetSearchContext {
  query: string;
  results: Street[];
  /** La dernière recherche n'a pas abouti. */
  failed: boolean;
}

/** Pause après la dernière frappe avant d'interroger le géocodeur. */
const DEBOUNCE_MS = 280;

export const streetSearchMachine = setup({
  types: {
    context: {} as StreetSearchContext,
    events: {} as StreetSearchEvent,
  },
  delays: { DEBOUNCE: DEBOUNCE_MS },
  actors: {
    search: fromPromise<Street[], string>(({ input, signal }) => searchStreets(input, signal)),
  },
  guards: {
    /** La saisie est assez précise pour valoir une requête. */
    isSearchable: ({ event }) => event.type === 'streetSearch.queryChanged' && streetQuery(event.query) !== null,
    picksKnownStreet: ({ context, event }) =>
      event.type === 'streetSearch.picked' && context.results.some((street) => street.id === event.id),
  },
  actions: {
    keepQuery: assign({
      query: ({ context, event }) => (event.type === 'streetSearch.queryChanged' ? event.query : context.query),
    }),
    /** Une saisie trop courte ne désigne plus rien : la liste se vide. */
    forgetResults: assign({ results: [], failed: false }),
    clear: assign({ query: '', results: [], failed: false }),
    announceChoice: sendParent(({ context, event }): StreetSearchEmitted => ({
      type: 'streetSearch.chosen',
      street: context.results.find((street) => event.type === 'streetSearch.picked' && street.id === event.id)!,
    })),
  },
}).createMachine({
  id: 'streetSearch',
  context: { query: '', results: [], failed: false },
  initial: 'closed',
  states: {
    closed: {
      on: { 'streetSearch.opened': 'open' },
    },
    open: {
      initial: 'idle',
      on: {
        'streetSearch.closed': { target: 'closed', actions: 'clear' },
        'streetSearch.queryChanged': [
          { guard: 'isSearchable', target: '.debouncing', reenter: true, actions: 'keepQuery' },
          { target: '.idle', actions: ['keepQuery', 'forgetResults'] },
        ],
        'streetSearch.picked': { guard: 'picksKnownStreet', target: 'closed', actions: ['announceChoice', 'clear'] },
      },
      states: {
        idle: {},
        debouncing: { after: { DEBOUNCE: 'searching' } },
        searching: {
          invoke: {
            id: 'streetSearch.request',
            src: 'search',
            input: ({ context }) => context.query,
            onDone: { target: 'idle', actions: assign({ results: ({ event }) => event.output, failed: false }) },
            onError: { target: 'idle', actions: assign({ results: [], failed: true }) },
          },
        },
      },
    },
  },
});

/* ------------------------------------------------------------- lecture --- */

/** Où en est la recherche : fermée, au repos, en cours, ou en échec. */
export function streetSearchStage(snapshot: { matches(value: unknown): boolean; context: StreetSearchContext }): 'closed' | 'idle' | 'loading' | 'failed' {
  if (snapshot.matches('closed')) return 'closed';
  if (snapshot.matches({ open: 'debouncing' }) || snapshot.matches({ open: 'searching' })) return 'loading';
  return snapshot.context.failed ? 'failed' : 'idle';
}
