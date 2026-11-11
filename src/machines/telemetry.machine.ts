/**
 * Machine de télémétrie : orchestre l'écriture de l'historique local.
 *
 * Deux régions indépendantes :
 *  - `writer` vide périodiquement le tampon mémoire dans IndexedDB (et aussitôt
 *    que la page passe en arrière-plan, dernier moment sûr avant fermeture) ;
 *  - `ledger` répond aux demandes du visiteur : résumé, export, effacement.
 *
 * La machine ne s'enregistre pas elle-même : ses propres événements sont
 * écartés par l'inspecteur, sans quoi chaque écriture en provoquerait une autre.
 */

import { assign, fromCallback, fromPromise, setup } from 'xstate';
import {
  clear, exportArchive, persist, prune, summarize,
  type TelemetryBuffer, type TelemetrySummary,
} from '../services/telemetry.ts';

export type TelemetryEvent =
  | { type: 'telemetry.pageHidden' }
  | { type: 'telemetry.summaryRequested' }
  | { type: 'telemetry.exportRequested' }
  | { type: 'telemetry.clearRequested' };

const FLUSH_INTERVAL_MS = 20_000;

/** Écrit le tampon ; en cas d'échec les événements y retournent, rien n'est perdu. */
async function flush(buffer: TelemetryBuffer): Promise<void> {
  const records = buffer.drain();
  try {
    await persist(records);
  } catch (error) {
    buffer.restore(records);
    throw error;
  }
}

function download(blob: Blob, filename: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

type BufferInput = { buffer: TelemetryBuffer };

export const telemetryMachine = setup({
  types: {
    context: {} as { buffer: TelemetryBuffer; summary: TelemetrySummary | null },
    events: {} as TelemetryEvent,
    input: {} as BufferInput,
  },
  actors: {
    prune: fromPromise(() => prune()),
    flush: fromPromise<void, BufferInput>(({ input }) => flush(input.buffer)),
    summarize: fromPromise<TelemetrySummary, BufferInput>(async ({ input }) => {
      await flush(input.buffer);
      return summarize();
    }),
    export: fromPromise<void, BufferInput>(async ({ input }) => {
      await flush(input.buffer);
      download(await exportArchive(), `louy-telemetrie-${new Date().toISOString().slice(0, 10)}.ndjson.gz`);
    }),
    clear: fromPromise(() => clear()),
    /** Signale le passage de la page en arrière-plan. */
    pageLifecycle: fromCallback<TelemetryEvent>(({ sendBack }) => {
      const onHidden = () => {
        if (document.visibilityState === 'hidden') sendBack({ type: 'telemetry.pageHidden' });
      };
      document.addEventListener('visibilitychange', onHidden);
      window.addEventListener('pagehide', onHidden);
      return () => {
        document.removeEventListener('visibilitychange', onHidden);
        window.removeEventListener('pagehide', onHidden);
      };
    }),
  },
}).createMachine({
  id: 'telemetry',
  context: ({ input }) => ({ buffer: input.buffer, summary: null }),
  initial: 'pruning',
  states: {
    /** Au démarrage : les lots de plus de trente jours sortent de la fenêtre. */
    pruning: {
      invoke: { id: 'telemetry.prune', src: 'prune', onDone: 'recording', onError: 'recording' },
    },
    recording: {
      type: 'parallel',
      invoke: { id: 'telemetry.lifecycle', src: 'pageLifecycle' },
      states: {
        writer: {
          initial: 'collecting',
          states: {
            collecting: {
              after: { [FLUSH_INTERVAL_MS]: 'flushing' },
              on: { 'telemetry.pageHidden': 'flushing' },
            },
            flushing: {
              invoke: {
                id: 'telemetry.flush',
                src: 'flush',
                input: ({ context }) => ({ buffer: context.buffer }),
                onDone: 'collecting',
                onError: 'collecting',
              },
            },
          },
        },
        ledger: {
          initial: 'idle',
          states: {
            idle: {
              on: {
                'telemetry.summaryRequested': 'summarizing',
                'telemetry.exportRequested': 'exporting',
                'telemetry.clearRequested': 'clearing',
              },
            },
            summarizing: {
              invoke: {
                id: 'telemetry.summarize',
                src: 'summarize',
                input: ({ context }) => ({ buffer: context.buffer }),
                onDone: { target: 'idle', actions: assign({ summary: ({ event }) => event.output }) },
                onError: 'idle',
              },
            },
            exporting: {
              invoke: {
                id: 'telemetry.export',
                src: 'export',
                input: ({ context }) => ({ buffer: context.buffer }),
                onDone: 'idle',
                onError: 'idle',
              },
            },
            clearing: {
              entry: ({ context }) => { context.buffer.drain(); },
              invoke: { id: 'telemetry.clear', src: 'clear', onDone: 'summarizing', onError: 'idle' },
            },
          },
        },
      },
    },
  },
});
