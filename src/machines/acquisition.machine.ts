/**
 * Machine de datation : de quand datent les mesures LiDAR sous le point visé ?
 *
 * De loin, seule la campagne a un sens. De près, et quand le SPW publie les
 * mailles de vol (2021-2022), on lit les dates réelles de passage de l'avion.
 */

import { assign, fromPromise, setup, type SnapshotFrom } from 'xstate';
import type { FlightDates } from '../domain/acquisition.ts';
import { campaignById, type CampaignId } from '../domain/catalog.ts';
import { loadFlightDates } from '../services/acquisition.ts';

export type AcquisitionEvent =
  | { type: 'acquisition.viewChanged'; x: number; y: number; distance: number }
  | { type: 'acquisition.campaignChanged'; campaign: CampaignId };

interface Focus { x: number; y: number; distance: number }

interface AcquisitionContext {
  campaign: CampaignId;
  focus: Focus;
  dates: FlightDates | null;
}

/** Au-delà, la vue couvre trop de mailles pour qu'une date ait un sens. */
const LOCAL_DISTANCE = 12_000;

export const acquisitionMachine = setup({
  types: {
    context: {} as AcquisitionContext,
    events: {} as AcquisitionEvent,
    input: {} as { campaign: CampaignId; focus: Focus },
  },
  actors: {
    loadDates: fromPromise<FlightDates | null, Focus>(({ input, signal }) =>
      loadFlightDates(input.x, input.y, signal)),
  },
  guards: {
    lacksFlightDates: ({ context }) => !campaignById(context.campaign)?.hasFlightDates,
    isOverview: ({ context }) => context.focus.distance > LOCAL_DISTANCE,
  },
}).createMachine({
  id: 'acquisition',
  context: ({ input }) => ({ ...input, dates: null }),
  initial: 'routing',
  on: {
    'acquisition.viewChanged': {
      target: '.routing',
      actions: assign({ focus: ({ event }) => ({ x: event.x, y: event.y, distance: event.distance }) }),
    },
    'acquisition.campaignChanged': {
      target: '.routing',
      actions: assign({ campaign: ({ event }) => event.campaign, dates: null }),
    },
  },
  states: {
    routing: {
      always: [
        { guard: 'lacksFlightDates', target: 'campaignOnly' },
        { guard: 'isOverview', target: 'campaignOnly' },
        { target: 'resolving' },
      ],
    },
    /** Seule la campagne est connue ou pertinente. */
    campaignOnly: {
      entry: assign({ dates: null }),
    },
    resolving: {
      invoke: {
        id: 'acquisition.dates',
        src: 'loadDates',
        input: ({ context }) => context.focus,
        onDone: { target: 'dated', actions: assign({ dates: ({ event }) => event.output }) },
        onError: 'campaignOnly',
      },
    },
    dated: {},
  },
});

/* ------------------------------------------------------------- lecture --- */

const month = new Intl.DateTimeFormat('fr-BE', { month: '2-digit', year: 'numeric' });

/** Libellé discret affiché dans l'interface. */
export function acquisitionLabel(snapshot: SnapshotFrom<typeof acquisitionMachine>): string {
  const { campaign, dates } = snapshot.context;
  if (!dates) return `LiDAR · campagne ${campaignById(campaign)?.label ?? campaign}`;
  const first = month.format(dates.first);
  const last = month.format(dates.last);
  return first === last ? `LiDAR · vol de ${first}` : `LiDAR · vols de ${first} à ${last}`;
}
