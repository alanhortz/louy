/**
 * Machine de compatibilité : établit, une fois au chargement, si le navigateur
 * sait faire tourner le viewer. Son rapport décide de la suite de l'application.
 */

import { assign, fromPromise, setup } from 'xstate';
import { probeCapabilities, type SupportReport } from '../services/capabilities.ts';

/** Si le diagnostic lui-même échoue, on tente le viewer plutôt que de bloquer. */
const OPTIMISTIC_REPORT: SupportReport = {
  supported: true,
  missing: [],
  browser: { id: 'unknown', name: 'Navigateur non reconnu', version: null },
  minimum: null,
  profile: 'desktop',
  compact: false,
  touch: false,
  reducedMotion: false,
};

export const compatibilityMachine = setup({
  types: {
    context: {} as { report: SupportReport },
    output: {} as SupportReport,
  },
  actors: {
    probe: fromPromise(() => probeCapabilities()),
  },
}).createMachine({
  id: 'compatibility',
  context: { report: OPTIMISTIC_REPORT },
  initial: 'probing',
  states: {
    probing: {
      invoke: {
        id: 'compatibility.probe',
        src: 'probe',
        onDone: { target: 'assessed', actions: assign({ report: ({ event }) => event.output }) },
        onError: 'assessed',
      },
    },
    assessed: { type: 'final' },
  },
  output: ({ context }) => context.report,
});
