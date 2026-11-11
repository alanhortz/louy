/**
 * Machine des noms de lieux (OpenStreetMap).
 *
 * Deux paliers chargés indépendamment : les villes dès que le calque est
 * visible, les villages seulement quand la caméra s'approche assez pour qu'ils
 * soient lisibles.
 *
 * Chaque palier s'affiche aussitôt — depuis le cache du navigateur, ou à défaut
 * depuis l'instantané servi avec le site — puis, s'il venait de l'instantané,
 * est rafraîchi en arrière-plan auprès de l'API publique d'OpenStreetMap, dont
 * la réponse est mise en cache pour les visites suivantes.
 */

import { assign, fromPromise, sendParent, setup, type SnapshotFrom } from 'xstate';
import type { Place, PlaceTier } from '../domain/places.ts';
import { loadPlaces, refreshPlaces, type PlaceBatch } from '../services/places.ts';

export type PlacesEvent =
  | { type: 'places.toggled' }
  | { type: 'places.viewChanged'; distance: number }
  | { type: 'places.retried' };

export type PlacesEmitted = { type: 'places.changed'; visible: boolean; features: Place[] };

/** Distance caméra sous laquelle les villages deviennent utiles. */
const VILLAGE_DISTANCE = 14_000;
const RETRY_MS = 30_000;

interface PlacesContext {
  startsVisible: boolean;
  batches: Partial<Record<PlaceTier, PlaceBatch>>;
  distance: number;
}

const features = (context: PlacesContext): Place[] =>
  Object.values(context.batches).flatMap((batch) => batch.places);

const places = setup({
  types: {
    context: {} as PlacesContext,
    events: {} as PlacesEvent,
    input: {} as { visible: boolean; distance: number },
  },
  actors: {
    loadTier: fromPromise<PlaceBatch, PlaceTier>(({ input, signal }) => loadPlaces(input, signal)),
    refreshTier: fromPromise<PlaceBatch, PlaceTier>(({ input, signal }) => refreshPlaces(input, signal)),
  },
  guards: {
    startsVisible: ({ context }) => context.startsVisible,
    isLoaded: ({ context }, tier: PlaceTier) => tier in context.batches,
    isClose: ({ context }) => context.distance < VILLAGE_DISTANCE,
    isSnapshot: ({ context }, tier: PlaceTier) => context.batches[tier]?.origin === 'snapshot',
  },
  actions: {
    trackDistance: assign({
      distance: ({ context, event }) => (event.type === 'places.viewChanged' ? event.distance : context.distance),
    }),
    store: assign({
      batches: ({ context, event }, tier: PlaceTier) =>
        ({ ...context.batches, [tier]: (event as unknown as { output: PlaceBatch }).output }),
    }),
    publish: sendParent(({ context }): PlacesEmitted =>
      ({ type: 'places.changed', visible: true, features: features(context) })),
    withdraw: sendParent((): PlacesEmitted => ({ type: 'places.changed', visible: false, features: [] })),
  },
});

/** Région de chargement d'un palier. `gate` retient le chargement tant qu'il est inutile. */
const tierRegion = (tier: PlaceTier, gate: 'isClose' | null) => places.createStateConfig({
  initial: 'pending',
  states: {
    pending: {
      always: [
        { guard: { type: 'isLoaded', params: tier }, target: 'ready' },
        ...(gate ? [{ guard: gate, target: 'loading' } as const] : [{ target: 'loading' } as const]),
      ],
    },
    loading: {
      invoke: {
        id: `places.${tier}`,
        src: 'loadTier',
        input: tier,
        onDone: { target: 'settling', actions: [{ type: 'store', params: tier }, 'publish'] },
        onError: 'failed',
      },
    },
    settling: {
      always: [
        { guard: { type: 'isSnapshot', params: tier }, target: 'refreshing' },
        { target: 'ready' },
      ],
    },
    /** L'instantané est affiché ; on demande la version du jour à OpenStreetMap. */
    refreshing: {
      invoke: {
        id: `places.${tier}.refresh`,
        src: 'refreshTier',
        input: tier,
        onDone: { target: 'ready', actions: [{ type: 'store', params: tier }, 'publish'] },
        // service saturé : l'instantané reste affiché, on réessaiera à la prochaine visite
        onError: 'ready',
      },
    },
    ready: {},
    failed: {
      after: { [RETRY_MS]: 'pending' },
      on: { 'places.retried': 'pending' },
    },
  },
});

export const placesMachine = places.createMachine({
  id: 'places',
  context: ({ input }) => ({ startsVisible: input.visible, batches: {}, distance: input.distance }),
  initial: 'resolving',
  on: {
    'places.viewChanged': { actions: 'trackDistance' },
  },
  states: {
    resolving: {
      always: [{ guard: 'startsVisible', target: 'visible' }, { target: 'hidden' }],
    },
    hidden: {
      on: { 'places.toggled': 'visible' },
    },
    visible: {
      type: 'parallel',
      entry: 'publish',
      exit: 'withdraw',
      on: { 'places.toggled': 'hidden' },
      states: {
        major: tierRegion('major', null),
        villages: tierRegion('villages', 'isClose'),
      },
    },
  },
});

/* ------------------------------------------------------------- lecture --- */

export type LayerFeed = 'off' | 'loading' | 'nominal' | 'degraded' | 'unavailable';

export interface LayerStatus {
  feed: LayerFeed;
  count: number;
  /** Provenance et fraîcheur de la donnée, pour la ligne d'état du calque. */
  origin: PlaceBatch['origin'] | null;
  storedAt: number | null;
  refreshing: boolean;
}

export function placesStatus(snapshot: SnapshotFrom<typeof placesMachine>): LayerStatus {
  const major = snapshot.context.batches.major;
  const base = {
    count: features(snapshot.context).length,
    origin: major?.origin ?? null,
    storedAt: major?.storedAt ?? null,
    refreshing: snapshot.matches({ visible: { major: 'refreshing' } }),
  };
  if (!snapshot.matches('visible')) return { ...base, feed: 'off' };
  if (snapshot.matches({ visible: { major: 'failed' } })) return { ...base, feed: 'unavailable' };
  if (snapshot.matches({ visible: { major: 'loading' } })) return { ...base, feed: 'loading' };
  if (snapshot.matches({ visible: { villages: 'failed' } })) return { ...base, feed: 'degraded' };
  if (snapshot.matches({ visible: { villages: 'loading' } })) return { ...base, feed: 'loading' };
  return { ...base, feed: 'nominal' };
}
