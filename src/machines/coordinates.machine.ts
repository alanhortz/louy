/**
 * Machine des coordonnées : copie dans le presse-papiers celles du point que la
 * vue vise — ou, à pied, celles du promeneur et le cap de son regard — suivies
 * du lien qui rouvre la vue telle que le visiteur la voit, et le confirme un instant.
 */

import { assign, fromPromise, setup } from 'xstate';
import { formatCoordinates } from '../domain/whereabouts.ts';
import { copyText } from '../services/whereabouts.ts';

/**
 * `azimuth` : cap à joindre aux coordonnées, en degrés depuis le nord.
 * `view` : lien qui rouvre la vue telle qu'elle est — cadrage, inclinaison, rendu et calques.
 */
export type CoordinatesEvent = { type: 'coordinates.copyRequested'; x: number; y: number; azimuth?: number; view?: string };

/** Durée d'affichage de la confirmation. */
const CONFIRMATION_MS = 2600;

export const coordinatesMachine = setup({
  types: {
    // `text` : ce que la confirmation affiche ; `copied` : ce qui part dans le presse-papiers
    context: {} as { text: string | null; copied: string | null },
    events: {} as CoordinatesEvent,
  },
  actors: {
    copy: fromPromise<void, string>(({ input }) => copyText(input)),
  },
}).createMachine({
  id: 'coordinates',
  context: { text: null, copied: null },
  initial: 'idle',
  on: {
    'coordinates.copyRequested': {
      target: '.copying',
      actions: assign(({ event }) => {
        const text = formatCoordinates(event.x, event.y, event.azimuth);
        return { text, copied: event.view ? `${text}\n${event.view}` : text };
      }),
    },
  },
  states: {
    idle: {},
    copying: {
      invoke: {
        id: 'coordinates.copy',
        src: 'copy',
        input: ({ context }) => context.copied!,
        onDone: 'copied',
        onError: 'shown',
      },
    },
    copied: { after: { [CONFIRMATION_MS]: 'idle' } },
    /** Le presse-papiers s'est refusé : les coordonnées restent affichées plus longtemps, à recopier. */
    shown: { after: { [CONFIRMATION_MS * 3]: 'idle' } },
  },
});
