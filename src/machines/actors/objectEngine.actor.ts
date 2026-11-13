/**
 * Acteur du moteur de la visionneuse d'objet : la passerelle entre la machine
 * `object` et la boucle d'images. Tout ce que le moteur observe — chargement,
 * première image, gestes du visiteur, perte du contexte graphique — remonte
 * sous forme d'événements : c'est ce qui les fait entrer dans le journal local.
 */

import { fromCallback } from 'xstate';
import { progressStep, type ObjectGesture, type ObjectPose } from '../../domain/objectView.ts';
import { ObjectEngine, type ObjectStats } from '../../engine/ObjectEngine.ts';

/** Commandes adressées au moteur. */
export type ObjectEngineCommand =
  | { type: 'objectEngine.resetView' }
  | { type: 'objectEngine.autoRotateSet'; on: boolean };

/** Ce que le moteur rapporte. */
export type ObjectEngineReport =
  | { type: 'objectEngine.progressed'; fraction: number }
  | { type: 'objectEngine.loaded'; stats: ObjectStats }
  | { type: 'objectEngine.failed'; reason: string }
  | { type: 'objectEngine.firstFrameShown' }
  | { type: 'objectEngine.gestureStarted'; gesture: ObjectGesture }
  | { type: 'objectEngine.gestureEnded'; gesture: ObjectGesture; pose: ObjectPose }
  | { type: 'objectEngine.viewReset'; pose: ObjectPose }
  | { type: 'objectEngine.contextLost' }
  | { type: 'objectEngine.contextRestored' };

export interface ObjectEngineInput {
  canvas: HTMLCanvasElement;
  url: string;
  autoRotate: boolean;
}

export const objectEngineActor = fromCallback<ObjectEngineCommand, ObjectEngineInput, ObjectEngineReport>(
  ({ input, sendBack, receive }) => {
    let engine: ObjectEngine;
    let reported = -1;
    try {
      engine = new ObjectEngine({
        ...input,
        listeners: {
          // par quarts : le journal garde la progression sans une ligne par paquet reçu
          onProgress: (fraction) => {
            const step = progressStep(fraction);
            if (step > reported) { reported = step; sendBack({ type: 'objectEngine.progressed', fraction: step }); }
          },
          onLoaded: (stats) => sendBack({ type: 'objectEngine.loaded', stats }),
          onFailed: (reason) => sendBack({ type: 'objectEngine.failed', reason }),
          onFirstFrame: () => sendBack({ type: 'objectEngine.firstFrameShown' }),
          onGestureStarted: (gesture) => sendBack({ type: 'objectEngine.gestureStarted', gesture }),
          onGestureEnded: (gesture, pose) => sendBack({ type: 'objectEngine.gestureEnded', gesture, pose }),
          onContextLost: () => sendBack({ type: 'objectEngine.contextLost' }),
          onContextRestored: () => sendBack({ type: 'objectEngine.contextRestored' }),
        },
      });
    } catch (error) {
      sendBack({ type: 'objectEngine.failed', reason: error instanceof Error ? error.message : String(error) });
      return;
    }

    receive((command) => {
      switch (command.type) {
        case 'objectEngine.resetView':
          engine.resetView();
          return sendBack({ type: 'objectEngine.viewReset', pose: engine.getPose() });
        case 'objectEngine.autoRotateSet':
          return engine.setAutoRotate(command.on);
      }
    });

    return () => engine.dispose();
  },
);
