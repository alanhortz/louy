/**
 * Machine des films du temps signalés sur la carte : un calque de marqueurs,
 * un par lieu choisi. Toucher un marqueur demande le film de ce lieu — la
 * machine applicative y emmène la caméra et ouvre la présentation.
 */

import { assign, sendParent, setup, type SnapshotFrom } from 'xstate';
import { FILM_PLACES, type FilmPlace } from '../domain/timeline.ts';
import type { FilmFeature } from '../engine/overlays/filmMarkers.ts';
import type { LayerFeed } from './places.machine.ts';

export type FilmsEvent =
  | { type: 'films.toggled' }
  | { type: 'films.picked'; id: string };

export type FilmsEmitted =
  | { type: 'films.markersChanged'; features: FilmFeature[]; activeId: string | null }
  | { type: 'films.playRequested'; place: FilmPlace };

interface FilmsContext {
  places: readonly FilmPlace[];
  /** Lieu dont le film a été demandé en dernier. */
  focus: string | null;
}

const toFeature = (place: FilmPlace): FilmFeature => ({ id: place.id, x: place.x, y: place.y, label: place.name, rank: 1 });

export const filmsMachine = setup({
  types: {
    context: {} as FilmsContext,
    events: {} as FilmsEvent,
  },
  guards: {
    picksKnownPlace: ({ context, event }) =>
      event.type === 'films.picked' && context.places.some((place) => place.id === event.id),
  },
  actions: {
    focusPicked: assign({ focus: ({ context, event }) => (event.type === 'films.picked' ? event.id : context.focus) }),
    mark: sendParent(({ context }): FilmsEmitted => ({
      type: 'films.markersChanged', features: context.places.map(toFeature), activeId: context.focus,
    })),
    unmark: sendParent((): FilmsEmitted => ({ type: 'films.markersChanged', features: [], activeId: null })),
    play: sendParent(({ context }): FilmsEmitted => ({
      type: 'films.playRequested', place: context.places.find((place) => place.id === context.focus)!,
    })),
  },
}).createMachine({
  id: 'films',
  context: { places: FILM_PLACES, focus: null },
  // montré d'emblée : sans marqueur, rien ne dit qu'un lieu a son film
  initial: 'shown',
  states: {
    shown: {
      entry: 'mark',
      exit: 'unmark',
      on: {
        'films.toggled': 'hidden',
        'films.picked': { guard: 'picksKnownPlace', actions: ['focusPicked', 'mark', 'play'] },
      },
    },
    hidden: {
      on: { 'films.toggled': 'shown' },
    },
  },
});

/* ------------------------------------------------------------- lecture --- */

type FilmsSnapshot = SnapshotFrom<typeof filmsMachine>;

export const filmsFeed = (snapshot: FilmsSnapshot): LayerFeed => (snapshot.matches('shown') ? 'nominal' : 'off');
