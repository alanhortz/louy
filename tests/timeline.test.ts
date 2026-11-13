import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor, createMachine, sendTo, type AnyEventObject } from 'xstate';
import { createTelemetryInspector } from '../src/app/inspector.ts';
import { VINTAGES } from '../src/domain/catalog.ts';
import { FILM_PLACES, timelinePosition, timelineSteps, timelineTint, TIMELINE_STEP_MS, type TimelineStep } from '../src/domain/timeline.ts';
import { filmsFeed, filmsMachine } from '../src/machines/films.machine.ts';
import { timelineMachine, timelinePhase, timelineProgress } from '../src/machines/timeline.machine.ts';
import { TelemetryBuffer } from '../src/services/telemetry.ts';

const STEPS: TimelineStep[] = [
  { vintage: '1994', label: '1994–2000', year: 1994 },
  { vintage: '2015', label: '2015', year: 2015 },
  { vintage: '2023', label: '2023', year: 2023 },
];

/** Le film sous un parent factice, qui consigne ses demandes comme le fait la machine applicative. */
function film(inspect?: Parameters<typeof createActor>[1]) {
  const announced: AnyEventObject[] = [];
  const parent = createActor(createMachine({
    invoke: { id: 'timeline', src: timelineMachine },
    on: {
      'to.child': { actions: sendTo('timeline', ({ event }) => (event as AnyEventObject).event) },
      '*': { actions: ({ event }) => { announced.push(event); } },
    },
  }), inspect).start();
  const actor = parent.getSnapshot().children.timeline!;
  const send = (event: AnyEventObject) => parent.send({ type: 'to.child', event });
  const snapshot = () => actor.getSnapshot() as ReturnType<ReturnType<typeof createActor<typeof timelineMachine>>['getSnapshot']>;
  /** Joue la préparation d'un millésime : chargement annoncé, terminé, puis photo reçue. */
  const capture = (url: string | null, blank = false) => {
    send({ type: 'timeline.activityChanged', loading: true });
    send({ type: 'timeline.activityChanged', loading: false });
    vi.advanceTimersByTime(1000);
    send({ type: 'timeline.frameCaptured', url, blank });
  };
  return { announced, send, snapshot, capture, requests: () => announced.map((event) => event.type) };
}

describe('étapes du film du temps', () => {
  it('suit les millésimes du plus ancien au plus récent', () => {
    const steps = timelineSteps('ortho');
    expect(steps.length).toBeGreaterThan(3);
    expect(steps.map((step) => step.year)).toEqual([...steps.map((step) => step.year)].sort((a, b) => a - b));
    expect(steps.every((step) => VINTAGES.some((vintage) => vintage.id === step.vintage))).toBe(true);
  });

  it('se joue en photo, sauf pour qui regardait l’infrarouge', () => {
    expect(timelineTint('slope')).toBe('ortho');
    expect(timelineTint('infrared')).toBe('infrared');
    expect(timelineSteps('infrared').length).toBeLessThanOrEqual(timelineSteps('ortho').length);
  });

  it('place les années sur la frise à proportion du temps écoulé', () => {
    expect(timelinePosition(1994, STEPS)).toBe(0);
    expect(timelinePosition(2023, STEPS)).toBe(1);
    expect(timelinePosition(2015, STEPS)).toBeCloseTo(21 / 29);
    expect(timelinePosition(2020, [{ year: 2020 }])).toBe(0);
  });
});

describe('machine du film du temps', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('URL', Object.assign(URL, { revokeObjectURL: vi.fn() }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('ne s’ouvre pas sans étape', () => {
    const { send, snapshot } = film();
    send({ type: 'timeline.opened', steps: [] });
    expect(timelinePhase(snapshot())).toBe('idle');
  });

  it('prépare chaque millésime en entier avant de montrer quoi que ce soit', () => {
    const { send, snapshot, capture, requests } = film();
    send({ type: 'timeline.opened', steps: STEPS });
    expect(timelinePhase(snapshot())).toBe('preparing');
    expect(requests()).toEqual(['timeline.vintageRequested']);

    // tant que la carte charge, aucune photo n'est demandée
    send({ type: 'timeline.activityChanged', loading: true });
    vi.advanceTimersByTime(5000);
    expect(requests()).not.toContain('timeline.captureRequested');
    // une tuile repart pendant le répit : on attend encore
    send({ type: 'timeline.activityChanged', loading: false });
    vi.advanceTimersByTime(300);
    send({ type: 'timeline.activityChanged', loading: true });
    vi.advanceTimersByTime(2000);
    expect(requests()).not.toContain('timeline.captureRequested');
    send({ type: 'timeline.activityChanged', loading: false });
    vi.advanceTimersByTime(1000);
    expect(requests().at(-1)).toBe('timeline.captureRequested');

    send({ type: 'timeline.frameCaptured', url: 'blob:1994', blank: false });
    expect(timelineProgress(snapshot())).toBeCloseTo(1 / 3);
    capture('blob:2015');
    expect(timelinePhase(snapshot())).toBe('preparing');
    capture('blob:2023');

    expect(timelinePhase(snapshot())).toBe('playing');
    expect(snapshot().context.frames.map((frame) => frame.url)).toEqual(['blob:1994', 'blob:2015', 'blob:2023']);
    expect(snapshot().context.index).toBe(0);
    // la carte retrouve sa scène une fois le film prêt
    expect(requests().at(-1)).toBe('timeline.restoreRequested');
    expect(requests().filter((type) => type === 'timeline.vintageRequested')).toHaveLength(3);
  });

  it('photographie sans attendre une carte dont les tuiles étaient déjà là', () => {
    const { send, requests } = film();
    send({ type: 'timeline.opened', steps: STEPS });
    vi.advanceTimersByTime(2600);
    expect(requests().at(-1)).toBe('timeline.captureRequested');
  });

  it('attend la fin d’un chargement déjà en cours quand le film est demandé', () => {
    const { send, requests } = film();
    // la carte chargeait avant l'ouverture : elle n'annoncera pas de nouveau chargement
    send({ type: 'timeline.activityChanged', loading: true });
    send({ type: 'timeline.opened', steps: STEPS });
    vi.advanceTimersByTime(8000);
    expect(requests()).not.toContain('timeline.captureRequested');
    send({ type: 'timeline.activityChanged', loading: false });
    vi.advanceTimersByTime(1000);
    expect(requests().at(-1)).toBe('timeline.captureRequested');
  });

  it('écarte les millésimes sans photo aérienne ici', () => {
    const { send, snapshot, capture } = film();
    send({ type: 'timeline.opened', steps: STEPS });
    capture('blob:1994');
    capture('blob:vide', true);
    capture(null);
    expect(timelinePhase(snapshot())).toBe('playing');
    expect(snapshot().context.frames.map((frame) => frame.vintage)).toEqual(['1994']);
    expect(snapshot().context.skipped.map((step) => step.vintage)).toEqual(['2015', '2023']);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:vide');
  });

  it('annonce un film indisponible quand aucune photo n’est exploitable', () => {
    const { send, snapshot, capture, requests } = film();
    send({ type: 'timeline.opened', steps: STEPS });
    capture(null); capture(null); capture('blob:vide', true);
    expect(timelinePhase(snapshot())).toBe('empty');
    expect(requests().at(-1)).toBe('timeline.restoreRequested');
    send({ type: 'timeline.closed', by: 'button' });
    expect(timelinePhase(snapshot())).toBe('idle');
  });

  /** Un film prêt, de trois images. */
  function ready() {
    const handle = film();
    handle.send({ type: 'timeline.opened', steps: STEPS });
    handle.capture('blob:1994'); handle.capture('blob:2015'); handle.capture('blob:2023');
    return handle;
  }

  it('enchaîne les images puis s’arrête sur la dernière', () => {
    const { snapshot } = ready();
    vi.advanceTimersByTime(TIMELINE_STEP_MS);
    expect(snapshot().context.index).toBe(1);
    vi.advanceTimersByTime(TIMELINE_STEP_MS);
    expect(snapshot().context.index).toBe(2);
    vi.advanceTimersByTime(TIMELINE_STEP_MS);
    expect(timelinePhase(snapshot())).toBe('paused');
    expect(snapshot().context.index).toBe(2);
  });

  it('repart du début quand on le relance en fin de film', () => {
    const { send, snapshot } = ready();
    vi.advanceTimersByTime(TIMELINE_STEP_MS * 3);
    send({ type: 'timeline.playToggled' });
    expect(timelinePhase(snapshot())).toBe('playing');
    expect(snapshot().context.index).toBe(0);
  });

  it('laisse la frise et le clavier piloter, en mettant le défilement en pause', () => {
    const { send, snapshot } = ready();
    send({ type: 'timeline.seeked', index: 2, by: 'frise' });
    expect(timelinePhase(snapshot())).toBe('paused');
    expect(snapshot().context.index).toBe(2);
    send({ type: 'timeline.stepped', delta: -1, by: 'keyboard' });
    expect(snapshot().context.index).toBe(1);
    // en pause, rien ne défile tout seul
    vi.advanceTimersByTime(TIMELINE_STEP_MS * 4);
    expect(snapshot().context.index).toBe(1);
    // les bornes tiennent
    send({ type: 'timeline.seeked', index: 99, by: 'keyboard' });
    expect(snapshot().context.index).toBe(2);
    send({ type: 'timeline.stepped', delta: 1, by: 'keyboard' });
    expect(snapshot().context.index).toBe(2);
    send({ type: 'timeline.seeked', index: -4, by: 'keyboard' });
    expect(snapshot().context.index).toBe(0);
    // la reprise continue d'où l'on est
    send({ type: 'timeline.playToggled' });
    vi.advanceTimersByTime(TIMELINE_STEP_MS);
    expect(snapshot().context.index).toBe(1);
  });

  it('libère ses photos en se fermant', () => {
    const { send, snapshot } = ready();
    send({ type: 'timeline.closed', by: 'escape' });
    expect(timelinePhase(snapshot())).toBe('idle');
    expect(snapshot().context.frames).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
  });

  it('rend sa scène à la carte quand la préparation est abandonnée', () => {
    const { send, snapshot, capture, requests } = film();
    send({ type: 'timeline.opened', steps: STEPS });
    capture('blob:1994');
    send({ type: 'timeline.closed', by: 'button' });
    expect(timelinePhase(snapshot())).toBe('idle');
    expect(requests().at(-1)).toBe('timeline.restoreRequested');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1994');
  });

  it('consigne au journal chaque geste du visiteur sur le film', () => {
    const buffer = new TelemetryBuffer();
    const { send, capture } = film({ inspect: createTelemetryInspector(buffer) });
    send({ type: 'timeline.opened', steps: STEPS });
    capture('blob:1994'); capture('blob:2015'); capture('blob:2023');
    send({ type: 'timeline.seeked', index: 1, by: 'frise' });
    send({ type: 'timeline.stepped', delta: 1, by: 'keyboard' });
    send({ type: 'timeline.playToggled' });
    send({ type: 'timeline.closed', by: 'escape' });
    const journal = JSON.stringify(buffer.drain());
    for (const type of ['timeline.opened', 'timeline.seeked', 'timeline.stepped', 'timeline.playToggled', 'timeline.closed']) {
      expect(journal).toContain(type);
    }
    expect(journal).toContain('"by":"frise"');
    expect(journal).toContain('"by":"keyboard"');
  });
});

describe('calque des films du temps', () => {
  function films() {
    const announced: AnyEventObject[] = [];
    const parent = createActor(createMachine({
      invoke: { id: 'films', src: filmsMachine },
      on: {
        'to.child': { actions: sendTo('films', ({ event }) => (event as AnyEventObject).event) },
        '*': { actions: ({ event }) => { announced.push(event); } },
      },
    })).start();
    const actor = parent.getSnapshot().children.films!;
    return { announced, actor, send: (event: AnyEventObject) => parent.send({ type: 'to.child', event }) };
  }

  it('signale d’emblée ses lieux, le Grognon en premier', () => {
    const { announced, actor } = films();
    expect(FILM_PLACES[0]).toMatchObject({ id: 'grognon' });
    expect(announced.at(-1)).toMatchObject({ type: 'films.markersChanged', activeId: null });
    expect(announced.at(-1)!.features[0]).toMatchObject({ id: 'grognon', x: 685487, y: 627968 });
    expect(filmsFeed(actor.getSnapshot() as never)).toBe('nominal');
  });

  it('demande le film du lieu dont on touche le marqueur', () => {
    const { announced, send } = films();
    send({ type: 'films.picked', id: 'inconnu' });
    expect(announced.some((event) => event.type === 'films.playRequested')).toBe(false);
    send({ type: 'films.picked', id: 'grognon' });
    expect(announced.at(-1)).toMatchObject({ type: 'films.playRequested', place: { id: 'grognon', view: { distance: 256 } } });
  });

  it('retire ses marqueurs quand le calque est éteint, et les remet', () => {
    const { announced, actor, send } = films();
    send({ type: 'films.toggled' });
    expect(announced.at(-1)).toMatchObject({ type: 'films.markersChanged', features: [] });
    expect(filmsFeed(actor.getSnapshot() as never)).toBe('off');
    send({ type: 'films.picked', id: 'grognon' });
    expect(announced.at(-1)!.type).toBe('films.markersChanged');
    send({ type: 'films.toggled' });
    expect(announced.at(-1)!.features).toHaveLength(1);
  });
});
