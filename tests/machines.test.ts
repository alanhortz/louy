import { describe, expect, it, vi } from 'vitest';
import { createActor, createMachine, fromPromise, sendTo, waitFor, type AnyActorLogic, type AnyEventObject } from 'xstate';
import { createTelemetryInspector } from '../src/app/inspector.ts';
import type { Place, PlaceTier } from '../src/domain/places.ts';
import type { Scan } from '../src/domain/scans.ts';
import { DEFAULT_SCENE } from '../src/domain/scene.ts';
import { activityMachine } from '../src/machines/activity.machine.ts';
import { camerasMachine, frameState } from '../src/machines/cameras.machine.ts';
import { chromeMachine } from '../src/machines/chrome.machine.ts';
import { placesMachine, placesStatus } from '../src/machines/places.machine.ts';
import { hasScans, scansFeed, scansMachine } from '../src/machines/scans.machine.ts';
import { sceneMachine } from '../src/machines/scene.machine.ts';
import { shareMachine } from '../src/machines/share.machine.ts';
import { sitesMachine } from '../src/machines/sites.machine.ts';
import type { RoadCamera } from '../src/services/cameras.ts';
import type { PlaceBatch } from '../src/services/places.ts';
import { fold, type SiteIndexEntry, type TouristSite } from '../src/services/sites.ts';
import { TelemetryBuffer } from '../src/services/telemetry.ts';

/**
 * Fait tourner une machine fille sous un parent factice qui consigne ce qu'elle
 * lui annonce — exactement la relation qu'elle a avec la machine applicative.
 */
function underParent<T extends AnyActorLogic>(child: T, input?: unknown) {
  const announced: AnyEventObject[] = [];
  const parent = createActor(createMachine({
    invoke: { id: 'child', src: child, input },
    on: {
      'to.child': { actions: sendTo('child', ({ event }) => (event as AnyEventObject).event) },
      '*': { actions: ({ event }) => { announced.push(event); } },
    },
  })).start();
  const actor = parent.getSnapshot().children.child!;
  return {
    actor,
    announced,
    send: (event: AnyEventObject) => parent.send({ type: 'to.child', event }),
    snapshot: () => actor.getSnapshot(),
  };
}

describe('machine de scène', () => {
  it('annonce chaque changement effectif, et seulement ceux-là', () => {
    const { send, announced, snapshot } = underParent(sceneMachine, DEFAULT_SCENE);
    send({ type: 'scene.tintSelected', tint: 'slope' });
    send({ type: 'scene.tintSelected', tint: 'slope' });
    send({ type: 'scene.campaignSelected', campaign: '2013-2014' });
    send({ type: 'scene.vintageSelected', vintage: 'inconnu' });

    expect(announced.map((event) => event.type)).toEqual(['scene.changed', 'scene.changed']);
    expect(snapshot().context.scene).toEqual({ ...DEFAULT_SCENE, tint: 'slope', campaign: '2013-2014' });
  });
});

describe('machine de l’habillage', () => {
  const expanded = (actor: ReturnType<typeof createActor<typeof chromeMachine>>) =>
    Object.entries(actor.getSnapshot().value).filter(([, state]) => state === 'expanded').map(([panel]) => panel);

  it('laisse plusieurs panneaux ouverts sur grand écran', () => {
    const actor = createActor(chromeMachine, { input: { exclusive: false, expanded: ['layers'] } }).start();
    actor.send({ type: 'chrome.toggled', panel: 'render' });
    expect(expanded(actor)).toEqual(['layers', 'render']);
  });

  it('n’en garde qu’un sur petit écran', () => {
    const actor = createActor(chromeMachine, { input: { exclusive: true, expanded: [] } }).start();
    actor.send({ type: 'chrome.toggled', panel: 'layers' });
    actor.send({ type: 'chrome.toggled', panel: 'render' });
    expect(expanded(actor)).toEqual(['render']);
    actor.send({ type: 'chrome.revealed', panel: 'camera' });
    expect(expanded(actor)).toEqual(['camera']);
    actor.send({ type: 'chrome.dismissed', panel: 'camera' });
    expect(expanded(actor)).toEqual([]);
  });
});

describe('machine des noms de lieux', () => {
  const place = (label: string): Place => ({ id: label, x: 0, y: 0, label, kind: 'city', rank: 1, maxDistance: Infinity });
  const batch = (origin: PlaceBatch['origin'], label: string): PlaceBatch =>
    ({ tier: 'major', places: [place(label)], origin, storedAt: origin === 'snapshot' ? null : 1 });

  it('affiche l’instantané puis le remplace par la réponse en direct', async () => {
    const machine = placesMachine.provide({
      actors: {
        loadTier: fromPromise(async () => batch('snapshot', 'Namur (instantané)')),
        refreshTier: fromPromise(async () => batch('network', 'Namur (direct)')),
      },
    });
    const { actor, announced } = underParent(machine, { visible: true, distance: 200_000 });
    await waitFor(actor, (snapshot) => snapshot.matches({ visible: { major: 'ready' } }));

    const labels = announced.filter((event) => event.type === 'places.changed')
      .map((event) => event.features.map((feature: Place) => feature.label));
    expect(labels).toEqual([[], ['Namur (instantané)'], ['Namur (direct)']]);
    expect(placesStatus(actor.getSnapshot())).toMatchObject({ feed: 'nominal', origin: 'network' });
  });

  it('garde l’instantané quand OpenStreetMap ne répond pas', async () => {
    const machine = placesMachine.provide({
      actors: {
        loadTier: fromPromise(async () => batch('snapshot', 'Namur')),
        refreshTier: fromPromise<PlaceBatch, PlaceTier>(async () => { throw new Error('Overpass saturé'); }),
      },
    });
    const { actor } = underParent(machine, { visible: true, distance: 200_000 });
    await waitFor(actor, (snapshot) => snapshot.matches({ visible: { major: 'ready' } }));
    expect(placesStatus(actor.getSnapshot())).toMatchObject({ feed: 'nominal', origin: 'snapshot', count: 1 });
  });

  it('ne charge les villages qu’en s’approchant, et retire tout quand on masque', async () => {
    const loadTier = vi.fn(async ({ input }: { input: PlaceTier }): Promise<PlaceBatch> => ({ ...batch('cache', input), tier: input }));
    const machine = placesMachine.provide({ actors: { loadTier: fromPromise<PlaceBatch, PlaceTier>(loadTier) } });
    const { actor, send, announced } = underParent(machine, { visible: true, distance: 200_000 });
    await waitFor(actor, (snapshot) => snapshot.matches({ visible: { major: 'ready' } }));
    expect(loadTier).toHaveBeenCalledTimes(1);

    send({ type: 'places.viewChanged', distance: 3_000 });
    await waitFor(actor, (snapshot) => snapshot.matches({ visible: { villages: 'ready' } }));
    expect(loadTier).toHaveBeenCalledTimes(2);

    send({ type: 'places.toggled' });
    expect(announced.at(-1)).toEqual({ type: 'places.changed', visible: false, features: [] });
  });
});

describe('machine des caméras', () => {
  const cameras: RoadCamera[] = [
    { id: '1', label: 'A4 Champion', route: 'A4', place: 'Champion', x: 0, y: 0, km: 53.435, approximate: false },
    { id: '2', label: 'A15 Daussoulx', route: 'A15', place: 'Daussoulx', x: 5000, y: 0, approximate: true },
  ];
  const machine = (frame: () => Promise<string>) => camerasMachine.provide({
    actors: { loadList: fromPromise(async () => cameras), loadFrame: fromPromise(frame) },
  });

  it('restaure la caméra d’un lien partagé et affiche son image', async () => {
    const { actor, announced } = underParent(machine(async () => 'blob:image'),
      { visible: true, selectedId: '2', focus: { x: 0, y: 0 } });
    await waitFor(actor, (snapshot) => frameState(snapshot) === 'ready');
    expect(actor.getSnapshot().context.frame?.url).toBe('blob:image');
    expect(announced.find((event) => event.type === 'cameras.selectionChanged')?.camera.id).toBe('2');
  });

  it('navigue, vole vers la caméra, puis relâche', async () => {
    const { actor, send, announced } = underParent(machine(async () => 'blob:image'),
      { visible: true, selectedId: null, focus: { x: 4900, y: 0 } });
    await waitFor(actor, (snapshot) => snapshot.matches({ visible: { listed: 'standby' } }));

    send({ type: 'cameras.nearestRequested' });
    expect(actor.getSnapshot().context.selectedId).toBe('2');
    send({ type: 'cameras.stepped', delta: 1 });
    expect(actor.getSnapshot().context.selectedId).toBe('1');
    expect(announced.filter((event) => event.type === 'cameras.flyRequested')).toHaveLength(2);

    send({ type: 'cameras.dismissed' });
    expect(announced.at(-1)).toEqual({ type: 'cameras.selectionChanged', camera: null });
  });

  it('signale une image indisponible sans quitter la caméra', async () => {
    const { actor, send } = underParent(machine(async () => { throw new Error('404'); }),
      { visible: true, selectedId: null, focus: { x: 0, y: 0 } });
    await waitFor(actor, (snapshot) => snapshot.matches({ visible: { listed: 'standby' } }));
    send({ type: 'cameras.picked', id: '1' });
    await waitFor(actor, (snapshot) => frameState(snapshot) === 'error');
    expect(actor.getSnapshot().context.selectedId).toBe('1');
  });
});

describe('machine des sites touristiques', () => {
  const index: SiteIndexEntry[] = ['Citadelle de Dinant', 'Château de Vêves'].map((name) => ({
    site: { id: name, name, kind: 'Château', near: 'Dinant', x: 1, y: 2, notable: true },
    name: fold(name),
    haystack: fold(name),
  }));

  it('charge l’index une seule fois, cherche, puis annonce le site choisi', async () => {
    const loadIndex = vi.fn(async () => index);
    const { actor, send, announced } = underParent(sitesMachine.provide({ actors: { loadIndex: fromPromise(loadIndex) } }));

    send({ type: 'sites.opened' });
    send({ type: 'sites.queryChanged', query: 'veves' }); // saisi avant l'arrivée de l'index
    await waitFor(actor, (snapshot) => snapshot.matches('open'));
    expect(actor.getSnapshot().context.results.map((site: TouristSite) => site.name)).toEqual(['Château de Vêves']);

    send({ type: 'sites.picked', id: 'Château de Vêves' });
    expect(actor.getSnapshot().matches('closed')).toBe(true);
    expect(announced.at(-1)).toMatchObject({ type: 'sites.chosen', site: { x: 1, y: 2 } });
    // la saisie est effacée : la recherche suivante repart d'un champ vide
    expect(actor.getSnapshot().context).toMatchObject({ query: '' });
    expect(actor.getSnapshot().context.results).toHaveLength(2);

    send({ type: 'sites.opened' });
    expect(actor.getSnapshot().matches('open')).toBe(true);
    expect(loadIndex).toHaveBeenCalledTimes(1);
  });
});

describe('machine des scans 3D', () => {
  const veves: Scan = { id: 'veves', name: 'Château de Vêves', x: 693807, y: 601258, splats: '/local/scans/veves.ply', credit: 'essai' };
  const withScans = (scans: Scan[]) =>
    underParent(scansMachine.provide({ actors: { loadScans: fromPromise(async () => scans) } }));

  it('ne propose rien quand ce poste n’a aucun scan', async () => {
    const { actor, send, announced } = withScans([]);
    await waitFor(actor, (snapshot) => snapshot.matches('absent'));
    send({ type: 'scans.toggled' });
    expect(hasScans(actor.getSnapshot())).toBe(false);
    expect(announced.filter((event) => event.type.startsWith('scans.'))).toEqual([]);
  });

  it('affiche les scans et emmène la caméra au premier, puis les retire', async () => {
    const { actor, send, announced } = withScans([veves]);
    await waitFor(actor, (snapshot) => snapshot.matches('hidden'));
    expect(scansFeed(actor.getSnapshot())).toBe('off');

    send({ type: 'scans.toggled' });
    expect(scansFeed(actor.getSnapshot())).toBe('nominal');
    expect(announced.slice(-2)).toMatchObject([
      { type: 'scans.changed', scans: [veves] },
      { type: 'scans.flyRequested', scan: { x: 693807, y: 601258 } },
    ]);

    send({ type: 'scans.toggled' });
    expect(announced.at(-1)).toEqual({ type: 'scans.changed', scans: [] });
  });
});

describe('machine de partage', () => {
  const request = { url: 'https://louy.be/#c=1,2,3', title: 't', text: 't' };
  const start = (deliver: () => Promise<'copied' | 'shared'>) => {
    const actor = createActor(shareMachine.provide({ actors: { deliver: fromPromise(deliver) } })).start();
    actor.send({ type: 'share.started', request });
    return actor;
  };

  it('confirme la copie du lien', async () => {
    const actor = start(async () => 'copied');
    await waitFor(actor, (snapshot) => snapshot.matches('confirmed'));
    expect(actor.getSnapshot().context.outcome).toBe('copied');
  });

  it('revient au repos si le visiteur referme la feuille de partage', async () => {
    const actor = start(async () => { throw new DOMException('annulé', 'AbortError'); });
    await waitFor(actor, (snapshot) => snapshot.matches('idle'));
  });

  it('montre le lien à copier à la main en dernier recours', async () => {
    const actor = start(async () => { throw new Error('presse-papiers refusé'); });
    await waitFor(actor, (snapshot) => snapshot.matches('manual'));
    expect(actor.getSnapshot().context.request?.url).toBe(request.url);
  });
});

describe('inspecteur de télémétrie', () => {
  it('consigne événements et changements d’état, sans doublon', () => {
    const buffer = new TelemetryBuffer();
    const actor = createActor(chromeMachine, {
      id: 'chrome',
      input: { exclusive: false, expanded: [] },
      inspect: createTelemetryInspector(buffer),
    }).start();
    actor.send({ type: 'chrome.toggled', panel: 'about' });
    actor.send({ type: 'chrome.dismissed', panel: 'layers' }); // sans effet : pas de nouvel état

    const records = buffer.drain();
    const events = records.filter((record) => record.k === 'event').map((record) => [record.n, record.d]);
    expect(events).toContainEqual(['chrome.toggled', { panel: 'about' }]);
    expect(events).toContainEqual(['chrome.dismissed', { panel: 'layers' }]);
    const states = records.filter((record) => record.k === 'state');
    expect(states.at(-1)).toMatchObject({ a: 'chrome', n: { about: 'expanded' } });
    expect(new Set(states.map((record) => JSON.stringify(record.n))).size).toBe(states.length);
  });

  it('ne consigne jamais la télémétrie elle-même', () => {
    const buffer = new TelemetryBuffer();
    const actor = createActor(chromeMachine, {
      id: 'telemetry',
      input: { exclusive: false, expanded: [] },
      inspect: createTelemetryInspector(buffer),
    }).start();
    actor.send({ type: 'chrome.toggled', panel: 'about' });
    expect(buffer.size).toBe(0);
  });
});

describe('machine d’activité', () => {
  it('annonce le chargement, confirme sa fin, puis se tait', () => {
    vi.useFakeTimers();
    const actor = createActor(activityMachine).start();
    actor.send({ type: 'activity.changed', loading: true, points: 0 });
    expect(actor.getSnapshot().value).toBe('loading');
    actor.send({ type: 'activity.changed', loading: false, points: 4_200_000 });
    expect(actor.getSnapshot()).toMatchObject({ value: 'complete', context: { points: 4_200_000 } });
    vi.advanceTimersByTime(1500);
    expect(actor.getSnapshot().value).toBe('quiet');
    vi.useRealTimers();
  });

  it('reprend sans attendre si le relief se recharge pendant la confirmation', () => {
    const actor = createActor(activityMachine).start();
    actor.send({ type: 'activity.changed', loading: true, points: 0 });
    actor.send({ type: 'activity.changed', loading: false, points: 10 });
    actor.send({ type: 'activity.changed', loading: true, points: 10 });
    expect(actor.getSnapshot().value).toBe('loading');
  });
});
