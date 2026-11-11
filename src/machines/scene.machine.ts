/**
 * Machine de scène : ce que le visiteur a choisi de regarder — campagne LiDAR,
 * modèle de surface, habillage, millésime. Elle garantit qu'une scène est
 * toujours valide et prévient son parent de chaque changement effectif.
 */

import { assign, sendParent, setup } from 'xstate';
import type { CampaignId, SurfaceId, TintId } from '../domain/catalog.ts';
import { normalizeScene, type Scene } from '../domain/scene.ts';

export type SceneEvent =
  | { type: 'scene.campaignSelected'; campaign: CampaignId }
  | { type: 'scene.surfaceSelected'; surface: SurfaceId }
  | { type: 'scene.tintSelected'; tint: TintId }
  | { type: 'scene.vintageSelected'; vintage: string };

export type SceneEmitted = { type: 'scene.changed'; scene: Scene };

/** Ce qu'un événement de sélection modifie dans la scène. */
const patchOf = ({ type: _, ...patch }: SceneEvent): Partial<Scene> => patch;

const sameScene = (a: Scene, b: Scene) =>
  a.campaign === b.campaign && a.surface === b.surface && a.tint === b.tint && a.vintage === b.vintage;

export const sceneMachine = setup({
  types: {
    context: {} as { scene: Scene },
    events: {} as SceneEvent,
    input: {} as Scene,
  },
  guards: {
    changesScene: ({ context, event }) =>
      !sameScene(context.scene, normalizeScene({ ...context.scene, ...patchOf(event) })),
  },
  actions: {
    applySelection: assign({
      scene: ({ context, event }) => normalizeScene({ ...context.scene, ...patchOf(event) }),
    }),
    announce: sendParent(({ context }): SceneEmitted => ({ type: 'scene.changed', scene: context.scene })),
  },
}).createMachine({
  id: 'scene',
  context: ({ input }) => ({ scene: normalizeScene(input) }),
  on: {
    '*': { guard: 'changesScene', actions: ['applySelection', 'announce'] },
  },
});
