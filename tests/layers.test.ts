import { describe, expect, it } from 'vitest';
import { createActor, createMachine, sendTo, waitFor, type AnyActorLogic, type AnyEventObject } from 'xstate';
import { createTelemetryInspector } from '../src/app/inspector.ts';
import { groupObjects, scanGroupRadius, type Scan } from '../src/domain/scans.ts';
import { createLayersMachine, layerRef } from '../src/machines/layers.machine.ts';
import { objectMachine, objectPage } from '../src/machines/object.machine.ts';
import { drawnScans, scansLayer } from '../src/machines/scans.layer.ts';
import {
  createSelectionLayer, layerAvailable, layerFeed, layerSelection, type SelectionLayerSpec,
} from '../src/machines/selectionLayer.machine.ts';
import { TelemetryBuffer } from '../src/services/telemetry.ts';

/** Fait tourner une machine sous un parent factice qui consigne ce qu'elle lui annonce. */
function underParent(logic: AnyActorLogic, input?: unknown, options?: Parameters<typeof createActor>[1]) {
  const announced: AnyEventObject[] = [];
  const parent = createActor(createMachine({
    invoke: { id: 'child', src: logic, input },
    on: {
      'to.child': { actions: sendTo('child', ({ event }) => (event as AnyEventObject).event) },
      '*': { actions: ({ event }) => { announced.push(event); } },
    },
  }), options).start();
  const actor = parent.getSnapshot().children.child!;
  return { actor, announced, send: (event: AnyEventObject) => parent.send({ type: 'to.child', event }) };
}

/* ---- un calque quelconque : trois bornes, dont deux partagent un marqueur ---- */
interface Post { id: string; x: number; y: number; pair?: string }
const posts: Post[] = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0, pair: 'bc' }, { id: 'c', x: 12, y: 0, pair: 'bc' }];
const postsLayer = (list: Post[] = posts): SelectionLayerSpec<Post> => ({
  name: 'posts',
  load: async () => list,
  // de loin, les bornes appariées partagent le marqueur de la première ; de près, chacune a le sien
  markers: (items, { distance }) => items
    .filter((item) => distance < 100 || !item.pair || item === items.find((other) => other.pair === item.pair))
    .map((item) => ({ id: item.id, x: item.x, y: item.y, label: item.id, rank: 1 })),
  members: (items, markerId, { distance }) => {
    const item = items.find((candidate) => candidate.id === markerId);
    if (!item) return [];
    return distance >= 100 && item.pair ? items.filter((other) => other.pair === item.pair) : [item];
  },
});

describe('état générique d’un calque à sélection', () => {
  const start = async (input?: { visible?: boolean; distance?: number }, list?: Post[]) => {
    const harness = underParent(createSelectionLayer(postsLayer(list)), input);
    await waitFor(harness.actor, (snapshot) => !snapshot.matches('probing'));
    return harness;
  };

  it('n’est pas proposé quand il n’a rien à montrer', async () => {
    const { actor, send, announced } = await start({}, []);
    expect(actor.getSnapshot().matches('absent')).toBe(true);
    expect(layerAvailable(actor.getSnapshot())).toBe(false);
    send({ type: 'layer.toggled' });
    expect(announced).toEqual([]);
  });

  it('allumé, pose ses marqueurs et rien d’autre ; éteint, les retire', async () => {
    const { actor, send, announced } = await start({ distance: 500 });
    expect(layerFeed(actor.getSnapshot())).toBe('nominal');
    expect(announced).toMatchObject([{ type: 'layer.changed', layer: 'posts', visible: true }]);
    expect(announced[0]!.features.map((feature: { id: string }) => feature.id)).toEqual(['a', 'b']);

    send({ type: 'layer.toggled' });
    expect(layerFeed(actor.getSnapshot())).toBe('off');
    expect(announced.slice(-2)).toMatchObject([
      { type: 'layer.changed', visible: false, features: [] },
      { type: 'layer.selectionChanged', item: null, markerId: null },
    ]);
  });

  it('peut naître éteint : aucun marqueur, et rien ne se laisse toucher', async () => {
    const { send, announced } = await start({ visible: false });
    send({ type: 'layer.picked', id: 'a' });
    expect(announced).toEqual([]);
  });

  it('sélectionne et active l’élément du marqueur touché', async () => {
    const { actor, send, announced } = await start({ distance: 500 });
    send({ type: 'layer.picked', id: 'a' });
    expect(layerSelection(actor.getSnapshot())).toMatchObject({ id: 'a' });
    expect(announced.slice(-2)).toMatchObject([
      { type: 'layer.selectionChanged', layer: 'posts', item: { id: 'a' }, markerId: 'a' },
      { type: 'layer.activated', layer: 'posts', item: { id: 'a' }, siblings: [{ id: 'a' }] },
    ]);
    // toucher de nouveau l'élément sélectionné le réactive
    send({ type: 'layer.picked', id: 'a' });
    expect(announced.at(-1)).toMatchObject({ type: 'layer.activated', item: { id: 'a' } });

    const before = announced.length;
    send({ type: 'layer.picked', id: 'inconnu' });
    expect(announced).toHaveLength(before);
  });

  it('feuillette les éléments d’un même marqueur et s’arrête aux deux bouts', async () => {
    const { actor, send, announced } = await start({ distance: 500 });
    send({ type: 'layer.picked', id: 'b' });
    expect(announced.at(-1)).toMatchObject({ type: 'layer.activated', item: { id: 'b' }, siblings: [{ id: 'b' }, { id: 'c' }] });
    send({ type: 'layer.stepped', delta: 1 });
    // le voisin est sélectionné, sous le même marqueur
    expect(announced.slice(-2)).toMatchObject([
      { type: 'layer.selectionChanged', item: { id: 'c' }, markerId: 'b' },
      { type: 'layer.activated', item: { id: 'c' } },
    ]);
    const before = announced.length;
    send({ type: 'layer.stepped', delta: 1 });
    expect(announced).toHaveLength(before);
    send({ type: 'layer.stepped', delta: -1 });
    expect(layerSelection(actor.getSnapshot())).toMatchObject({ id: 'b' });
  });

  it('désélectionne à la demande', async () => {
    const { actor, send, announced } = await start({ distance: 500 });
    send({ type: 'layer.dismissed' });
    expect(announced).toHaveLength(1);
    send({ type: 'layer.picked', id: 'a' });
    send({ type: 'layer.dismissed' });
    expect(layerSelection(actor.getSnapshot())).toBeNull();
    expect(announced.at(-1)).toMatchObject({ type: 'layer.selectionChanged', item: null, markerId: null });
  });

  it('ne repose ses marqueurs que si leur disposition change avec l’éloignement', async () => {
    const { send, announced } = await start({ distance: 500 });
    send({ type: 'layer.picked', id: 'b' });
    send({ type: 'layer.stepped', delta: 1 });
    const before = announced.length;
    send({ type: 'layer.viewChanged', distance: 300 });
    expect(announced).toHaveLength(before);
    // de près, chacun retrouve son marqueur : la sélection suit le sien
    send({ type: 'layer.viewChanged', distance: 50 });
    expect(announced.slice(-2)).toMatchObject([
      { type: 'layer.changed', visible: true },
      { type: 'layer.selectionChanged', item: { id: 'c' }, markerId: 'c' },
    ]);
    expect(announced.at(-2)!.features).toHaveLength(3);
  });
});

describe('orchestrateur des calques', () => {
  const second: SelectionLayerSpec<Post> = { ...postsLayer([{ id: 'z', x: 5, y: 5 }]), name: 'bornes' };
  const start = async (input?: { visible?: Record<string, boolean>; distance?: number }, options?: Parameters<typeof createActor>[1]) => {
    const harness = underParent(createLayersMachine([postsLayer(), second]), input, options);
    const layers = () => harness.actor.getSnapshot() as { context: { layers: Record<string, never> } };
    await waitFor(layerRef(layers(), 'posts'), (snapshot) => !snapshot.matches('probing'));
    await waitFor(layerRef(layers(), 'bornes'), (snapshot) => !snapshot.matches('probing'));
    return { ...harness, layer: (name: string) => layerRef<Post>(layers(), name) };
  };

  it('fait naître une machine par calque, chacune avec son réglage d’ouverture', async () => {
    const { layer, announced } = await start({ visible: { bornes: false }, distance: 500 });
    expect(layerFeed(layer('posts').getSnapshot())).toBe('nominal');
    expect(layerFeed(layer('bornes').getSnapshot())).toBe('off');
    // seul le calque allumé a posé ses marqueurs, relayés sous le nom de l'orchestrateur
    expect(announced).toMatchObject([{ type: 'layers.changed', layer: 'posts', visible: true }]);
  });

  it('remet chaque geste au calque nommé, et relaie ce que les calques annoncent', async () => {
    const { send, layer, announced } = await start({ distance: 500 });
    send({ type: 'layers.picked', layer: 'bornes', id: 'z' });
    expect(layerSelection(layer('bornes').getSnapshot())).toMatchObject({ id: 'z' });
    expect(layerSelection(layer('posts').getSnapshot())).toBeNull();
    expect(announced.slice(-2)).toMatchObject([
      { type: 'layers.selectionChanged', layer: 'bornes', item: { id: 'z' } },
      { type: 'layers.activated', layer: 'bornes', item: { id: 'z' } },
    ]);

    send({ type: 'layers.toggled', layer: 'posts' });
    expect(layerFeed(layer('posts').getSnapshot())).toBe('off');
    expect(layerFeed(layer('bornes').getSnapshot())).toBe('nominal');

    const before = announced.length;
    send({ type: 'layers.picked', layer: 'inconnu', id: 'z' });
    expect(announced).toHaveLength(before);
  });

  it('diffuse la vue à tous les calques', async () => {
    const { send, layer } = await start({ distance: 500 });
    send({ type: 'layers.viewChanged', distance: 42 });
    expect(layer('posts').getSnapshot().context.distance).toBe(42);
    expect(layer('bornes').getSnapshot().context.distance).toBe(42);
  });

  it('laisse au journal la trace de chaque geste, calque par calque', async () => {
    const buffer = new TelemetryBuffer();
    const { send } = await start({ distance: 500 }, { inspect: createTelemetryInspector(buffer) });
    send({ type: 'layers.picked', layer: 'posts', id: 'a' });
    send({ type: 'layers.dismissed', layer: 'posts' });
    const journal = JSON.stringify(buffer.drain());
    for (const type of ['layers.picked', 'layer.picked', 'layer.dismissed']) expect(journal).toContain(type);
  });
});

/* ---- le calque de l'imagerie 3D, décrit pour l'état générique ---- */
const credit = { author: 'A', title: 'T', url: 'https://exemple.be', licence: '©' };
const object = (id: string, x: number, y: number): Scan => ({ id, name: `Objet ${id}`, x, y, mesh: `/scans/${id}.glb`, credit });
const citadelle: Scan = { id: 'citadelle', name: 'Citadelle de Namur', x: 685265, y: 627878, splats: '/scans/namur.spz', credit };
const facade = object('facade', 685186, 628504);
const mur = object('mur', 685188, 628493);
const lettres = object('lettres', 685567, 627965);
const all = [citadelle, lettres, facade, mur];

describe('groupes d’objets voisins', () => {
  it('réunit les objets à portée l’un de l’autre, et laisse les autres seuls', () => {
    expect(groupObjects(all, 60).map((group) => group.map((scan) => scan.id))).toEqual([['lettres'], ['facade', 'mur']]);
  });

  it('réunit deux groupes qu’un objet vient relier', () => {
    const chain = [object('a', 0, 0), object('c', 100, 0), object('b', 50, 0)];
    expect(groupObjects(chain, 60)).toHaveLength(1);
    expect(groupObjects(chain.slice(0, 2), 60)).toHaveLength(2);
  });

  it('sépare les objets voisins dès que la caméra est assez près', () => {
    // façade et mur peint sont à 11 m l'un de l'autre
    expect(groupObjects([facade, mur], scanGroupRadius(900))).toHaveLength(1);
    expect(groupObjects([facade, mur], scanGroupRadius(120))).toHaveLength(2);
  });
});

describe('calque de l’imagerie 3D', () => {
  const far = { selectedId: null, distance: 900 };

  it('pose un marqueur par lieu et un par groupe d’objets, qui porte leur nombre', () => {
    const markers = scansLayer.markers(all, far);
    expect(markers.map((marker) => marker.id)).toEqual(['citadelle', 'lettres', 'facade']);
    expect(markers[2]).toMatchObject({ count: 2, label: '2 objets en 3D', x: 685187 });
    expect((markers[1] as { count?: number }).count).toBeUndefined();
    // de très près, chaque objet est à sa place
    expect(scansLayer.markers(all, { selectedId: null, distance: 90 }).map((marker) => marker.id))
      .toEqual(['citadelle', 'lettres', 'facade', 'mur']);
  });

  it('dit quels scans un marqueur représente', () => {
    expect(scansLayer.members(all, 'facade', far).map((scan) => scan.id)).toEqual(['facade', 'mur']);
    expect(scansLayer.members(all, 'citadelle', far)).toEqual([citadelle]);
    // de loin, le mur peint n'a pas de marqueur à lui
    expect(scansLayer.members(all, 'mur', far)).toEqual([]);
    expect(scansLayer.members(all, 'mur', { selectedId: null, distance: 90 })).toEqual([mur]);
  });

  it('efface de près le marqueur du lieu sélectionné, et seulement le sien', () => {
    const [place, other] = scansLayer.markers(all, { selectedId: 'citadelle', distance: 900 });
    expect(place!.minDistance).toBeGreaterThan(0);
    expect(other!.minDistance).toBeUndefined();
  });

  it('ne dessine dans la carte que le lieu sélectionné', () => {
    expect(drawnScans(citadelle)).toEqual([citadelle]);
    expect(drawnScans(facade)).toEqual([]);
    expect(drawnScans(null)).toEqual([]);
  });

  it('branché sur l’état générique : le groupe touché s’ouvre avec tous ses objets', async () => {
    const { actor, send, announced } = underParent(
      createSelectionLayer({ ...scansLayer, load: async () => all }), { distance: 900 });
    await waitFor(actor, (snapshot) => snapshot.matches('visible'));
    send({ type: 'layer.picked', id: 'facade' });
    const activated = announced.at(-1)!;
    expect(activated).toMatchObject({ type: 'layer.activated', layer: 'scans', item: { id: 'facade' } });
    expect(activated.siblings.map((scan: Scan) => scan.id)).toEqual(['facade', 'mur']);
  });
});

describe('pagination de la visionneuse', () => {
  it('feuillette les objets du groupe et s’arrête aux deux bouts', () => {
    const actor = createActor(objectMachine).start();
    actor.send({ type: 'object.opened', scan: facade, group: [facade, mur] });
    expect(objectPage(actor.getSnapshot())).toEqual({ index: 1, total: 2 });
    actor.send({ type: 'object.paged', delta: -1, by: 'keyboard' });
    expect(actor.getSnapshot().context.scan?.id).toBe('facade');
    actor.send({ type: 'object.paged', delta: 1, by: 'button' });
    expect(objectPage(actor.getSnapshot())).toEqual({ index: 2, total: 2 });
    // l'objet suivant repart de zéro : il attend de nouveau son canvas
    expect(actor.getSnapshot().matches({ open: 'mounting' })).toBe(true);
    actor.send({ type: 'object.paged', delta: 1, by: 'button' });
    expect(actor.getSnapshot().context.scan?.id).toBe('mur');
  });

  it('n’a qu’une page pour un objet isolé', () => {
    const actor = createActor(objectMachine).start();
    actor.send({ type: 'object.opened', scan: lettres });
    expect(objectPage(actor.getSnapshot())).toEqual({ index: 1, total: 1 });
    actor.send({ type: 'object.closed', by: 'escape' });
    expect(objectPage(actor.getSnapshot())).toEqual({ index: 0, total: 0 });
  });
});
