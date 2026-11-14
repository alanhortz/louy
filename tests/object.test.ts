import { describe, expect, it } from 'vitest';
import { createActor, fromCallback } from 'xstate';
import { createTelemetryInspector } from '../src/app/inspector.ts';
import { DEFAULT_OBJECT_POSE, clampObjectPose, progressStep } from '../src/domain/objectView.ts';
import { isObjectScan, parseScans, placeScans, type Scan } from '../src/domain/scans.ts';
import type {
  ObjectEngineCommand, ObjectEngineInput, ObjectEngineReport,
} from '../src/machines/actors/objectEngine.actor.ts';
import { objectMachine, objectPhase } from '../src/machines/object.machine.ts';
import { TelemetryBuffer } from '../src/services/telemetry.ts';

const credit = { author: 'Alan Hortz', title: 'Lettres NAMUR', url: 'https://louy.be', licence: 'CC BY' };
const letters: Scan = { id: 'lettres', name: 'Lettres « NAMUR »', x: 685480, y: 627960, mesh: '/scans/lettres.glb', credit };
const citadel: Scan = { id: 'namur', name: 'Citadelle de Namur', x: 685265, y: 627878, splats: '/scans/namur.spz', credit };
const canvas = {} as HTMLCanvasElement;

/** La machine, avec un moteur factice dont on tient les deux bouts : ce qu'il reçoit, ce qu'il rapporte. */
function harness(options: { inspect?: ReturnType<typeof createTelemetryInspector> } = {}) {
  const commands: ObjectEngineCommand[] = [];
  let report: (event: ObjectEngineReport) => void = () => {};
  let engines = 0;
  const actor = createActor(objectMachine.provide({
    actors: {
      engine: fromCallback<ObjectEngineCommand, ObjectEngineInput, ObjectEngineReport>(({ sendBack, receive }) => {
        engines++;
        report = sendBack;
        receive((command) => commands.push(command));
      }),
    },
  }), { id: 'object', inspect: options.inspect }).start();
  const open = (scan: Scan = letters) => {
    actor.send({ type: 'object.opened', scan });
    actor.send({ type: 'object.canvasAttached', canvas });
  };
  const ready = () => {
    open();
    report({ type: 'objectEngine.progressed', fraction: 0.5 });
    report({ type: 'objectEngine.loaded', stats: { triangles: 1200, radius: 3 } });
  };
  return { actor, commands, open, ready, report: (event: ObjectEngineReport) => report(event), engines: () => engines };
}

describe('scans : lieux et objets', () => {
  it('lit un scan comme un lieu ou comme un objet, jamais les deux', () => {
    expect(parseScans([letters, citadel])).toEqual([letters, citadel]);
    expect(parseScans([{ ...letters, splats: '/scans/x.spz' }])).toEqual([]);
    expect(parseScans([{ ...letters, mesh: undefined }])).toEqual([]);
    expect(placeScans([letters, citadel])).toEqual([citadel]);
    expect(isObjectScan(letters)).toBe(true);
    expect(isObjectScan(citadel)).toBe(false);
  });

});

describe('point de vue sur un objet', () => {
  it('reste dans ses bornes', () => {
    expect(clampObjectPose({ azimuth: -30, polar: 140, distance: 0.01 })).toEqual({ azimuth: 330, polar: 88, distance: 0.35 });
    expect(clampObjectPose(DEFAULT_OBJECT_POSE)).toEqual(DEFAULT_OBJECT_POSE);
  });

  it('résume un chargement par quarts', () => {
    expect([0, 0.2, 0.26, 0.74, 0.99, 1].map(progressStep)).toEqual([0, 0, 0.25, 0.5, 0.75, 1]);
  });
});

describe('machine de la visionneuse d’objet', () => {
  it('n’ouvre que des objets', () => {
    const { actor } = harness();
    actor.send({ type: 'object.opened', scan: citadel });
    expect(objectPhase(actor.getSnapshot())).toBe('closed');
  });

  it('attend son canvas, charge, puis montre l’objet', () => {
    const { actor, report, engines } = harness();
    actor.send({ type: 'object.opened', scan: letters });
    expect(actor.getSnapshot().matches({ open: 'mounting' })).toBe(true);
    expect(engines()).toBe(0);

    actor.send({ type: 'object.canvasAttached', canvas });
    expect(objectPhase(actor.getSnapshot())).toBe('loading');
    expect(engines()).toBe(1);

    report({ type: 'objectEngine.progressed', fraction: 0.5 });
    expect(actor.getSnapshot().context.progress).toBe(0.5);
    report({ type: 'objectEngine.loaded', stats: { triangles: 1200, radius: 3 } });
    expect(objectPhase(actor.getSnapshot())).toBe('ready');
    expect(actor.getSnapshot().context).toMatchObject({ progress: 1, stats: { triangles: 1200 }, autoRotate: true });
  });

  it('cède la main au visiteur dès son premier geste, et retient où il s’arrête', () => {
    const { actor, report, ready, commands } = harness();
    ready();
    report({ type: 'objectEngine.gestureStarted', gesture: 'rotate' });
    expect(actor.getSnapshot().matches({ open: { viewing: { ready: 'handled' } } })).toBe(true);
    expect(actor.getSnapshot().context).toMatchObject({ gesture: 'rotate', autoRotate: false });
    expect(commands.at(-1)).toEqual({ type: 'objectEngine.autoRotateSet', on: false });

    const pose = { azimuth: 120, polar: 50, distance: 0.8 };
    report({ type: 'objectEngine.gestureEnded', gesture: 'rotate', pose });
    expect(actor.getSnapshot().matches({ open: { viewing: { ready: 'still' } } })).toBe(true);
    expect(actor.getSnapshot().context).toMatchObject({ pose, gesture: null });
  });

  it('transmet au moteur le recadrage et la rotation automatique', () => {
    const { actor, ready, commands, report } = harness();
    ready();
    actor.send({ type: 'object.resetRequested' });
    expect(commands.at(-1)).toEqual({ type: 'objectEngine.resetView' });
    report({ type: 'objectEngine.viewReset', pose: DEFAULT_OBJECT_POSE });
    expect(actor.getSnapshot().context.pose).toEqual(DEFAULT_OBJECT_POSE);

    actor.send({ type: 'object.autoRotateToggled' });
    expect(commands.at(-1)).toEqual({ type: 'objectEngine.autoRotateSet', on: false });
    actor.send({ type: 'object.autoRotateToggled' });
    expect(commands.at(-1)).toEqual({ type: 'objectEngine.autoRotateSet', on: true });
  });

  it('se met en veille quand le système reprend le contexte graphique, puis revient', () => {
    const { actor, ready, report } = harness();
    ready();
    report({ type: 'objectEngine.contextLost' });
    expect(objectPhase(actor.getSnapshot())).toBe('suspended');
    report({ type: 'objectEngine.contextRestored' });
    expect(objectPhase(actor.getSnapshot())).toBe('ready');
  });

  it('dit l’échec, et repart d’un moteur neuf sur « Réessayer »', () => {
    const { actor, open, report, engines } = harness();
    open();
    report({ type: 'objectEngine.failed', reason: 'fichier illisible' });
    expect(objectPhase(actor.getSnapshot())).toBe('failed');
    expect(actor.getSnapshot().context.failure).toBe('fichier illisible');

    actor.send({ type: 'object.retryRequested' });
    actor.send({ type: 'object.canvasAttached', canvas });
    expect(objectPhase(actor.getSnapshot())).toBe('loading');
    expect(engines()).toBe(2);
  });

  it('oublie tout à la fermeture', () => {
    const { actor, ready } = harness();
    ready();
    actor.send({ type: 'object.closed', by: 'escape' });
    expect(objectPhase(actor.getSnapshot())).toBe('closed');
    expect(actor.getSnapshot().context).toMatchObject({ scan: null, stats: null, progress: 0 });
  });
});

describe('journal de la visionneuse d’objet', () => {
  it('consigne l’affichage et chaque interaction du visiteur', () => {
    const buffer = new TelemetryBuffer();
    const { actor, ready, report } = harness({ inspect: createTelemetryInspector(buffer) });
    ready();
    report({ type: 'objectEngine.firstFrameShown' });
    report({ type: 'objectEngine.gestureStarted', gesture: 'zoom' });
    report({ type: 'objectEngine.gestureEnded', gesture: 'zoom', pose: { azimuth: 35, polar: 62, distance: 0.6 } });
    actor.send({ type: 'object.resetRequested' });
    actor.send({ type: 'object.autoRotateToggled' });
    actor.send({ type: 'object.closed', by: 'button' });

    const records = buffer.drain();
    const events = records.filter((record) => record.k === 'event' && record.a === 'object').map((record) => record.n);
    // l'affichage : ouverture, progression, fin de chargement, première image
    expect(events).toEqual(expect.arrayContaining([
      'object.opened', 'object.canvasAttached', 'objectEngine.progressed', 'objectEngine.loaded', 'objectEngine.firstFrameShown',
    ]));
    // les interactions : gestes, boutons, fermeture
    expect(events).toEqual(expect.arrayContaining([
      'objectEngine.gestureStarted', 'objectEngine.gestureEnded', 'object.resetRequested', 'object.autoRotateToggled', 'object.closed',
    ]));

    const data = (name: string) => records.find((record) => record.k === 'event' && record.n === name)?.d;
    expect(data('objectEngine.gestureEnded')).toMatchObject({ gesture: 'zoom', pose: { distance: 0.6 } });
    expect(data('object.closed')).toEqual({ by: 'button' });
    expect(data('objectEngine.loaded')).toMatchObject({ stats: { triangles: 1200 } });

    const states = records.filter((record) => record.k === 'state' && record.a === 'object').map((record) => JSON.stringify(record.n));
    expect(states).toEqual(expect.arrayContaining([
      JSON.stringify({ open: 'mounting' }),
      JSON.stringify({ open: { viewing: 'loading' } }),
      JSON.stringify({ open: { viewing: { ready: 'handled' } } }),
      JSON.stringify('closed'),
    ]));
  });
});
