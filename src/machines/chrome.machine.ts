/**
 * Machine de l'habillage : quels panneaux sont dépliés. Chaque panneau est une
 * région indépendante ; sur petit écran les panneaux sont exclusifs — en
 * déplier un replie les autres, pour que la carte reste visible.
 */

import { setup } from 'xstate';
import { acknowledge } from '../services/preferences.ts';

export const PANELS = ['layers', 'controls', 'render', 'camera', 'about'] as const;
export type PanelId = (typeof PANELS)[number];

export type ChromeEvent =
  | { type: 'chrome.toggled'; panel: PanelId }
  | { type: 'chrome.revealed'; panel: PanelId }
  | { type: 'chrome.dismissed'; panel: PanelId };

interface ChromeInput {
  exclusive: boolean;
  expanded: readonly PanelId[];
}

const chrome = setup({
  types: {
    context: {} as ChromeInput,
    events: {} as ChromeEvent,
    input: {} as ChromeInput,
  },
  actions: {
    /** Le visiteur a refermé le panneau lui-même : inutile de le lui remontrer. */
    acknowledge: (_, panel: PanelId) => acknowledge(panel),
  },
  guards: {
    concerns: ({ event }, panel: PanelId) => event.panel === panel,
    /** Un autre panneau s'ouvre alors que les panneaux sont exclusifs. */
    yieldsTo: ({ context, event }, panel: PanelId) => context.exclusive && event.panel !== panel,
    startsExpanded: ({ context }, panel: PanelId) => context.expanded.includes(panel),
  },
});

/** Région d'un panneau : repliée ou dépliée. */
const panelRegion = (panel: PanelId) => chrome.createStateConfig({
  initial: 'resolving',
  states: {
    resolving: {
      always: [
        { guard: { type: 'startsExpanded', params: panel }, target: 'expanded' },
        { target: 'collapsed' },
      ],
    },
    collapsed: {
      on: {
        'chrome.toggled': { guard: { type: 'concerns', params: panel }, target: 'expanded' },
        'chrome.revealed': { guard: { type: 'concerns', params: panel }, target: 'expanded' },
      },
    },
    expanded: {
      on: {
        'chrome.toggled': [
          {
            guard: { type: 'concerns', params: panel },
            target: 'collapsed',
            actions: { type: 'acknowledge', params: panel },
          },
          { guard: { type: 'yieldsTo', params: panel }, target: 'collapsed' },
        ],
        'chrome.revealed': { guard: { type: 'yieldsTo', params: panel }, target: 'collapsed' },
        'chrome.dismissed': { guard: { type: 'concerns', params: panel }, target: 'collapsed' },
      },
    },
  },
});

export const chromeMachine = chrome.createMachine({
  id: 'chrome',
  context: ({ input }) => input,
  type: 'parallel',
  states: {
    layers: panelRegion('layers'),
    controls: panelRegion('controls'),
    render: panelRegion('render'),
    camera: panelRegion('camera'),
    about: panelRegion('about'),
  },
});
