import { describe, expect, it } from 'vitest';
import { createMachine, createActor, sendTo, waitFor, type AnyActorLogic, type AnyEventObject } from 'xstate';
import { createTelemetryInspector } from '../src/app/inspector.ts';
import { fitFlyover, scansSpread, type Scan } from '../src/domain/scans.ts';
import { createLayersMachine, layerRef } from '../src/machines/layers.machine.ts';
import { objectMachine, objectPage } from '../src/machines/object.machine.ts';
import { aerialLayer, drawnScans, objectsLayer } from '../src/machines/scans.layer.ts';
import {
  createSelectionLayer, layerAvailable, layerFeed, layerKept, layerSelection, type SelectionLayerSpec,
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

/* ---- un calque quelconque : trois bornes ---- */
interface Post { id: string; x: number; y: number; fragile?: boolean }
const posts: Post[] = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }, { id: 'c', x: 12, y: 0 }];
const postsLayer = (list: Post[] = posts): SelectionLayerSpec<Post> => ({
  name: 'posts',
  load: async () => list,
  markers: (items, { selectedId, keptIds }) => items.map((item) => ({
    id: item.id, x: item.x, y: item.y, rank: 1,
    label: `${item.id}${item.id === selectedId ? '*' : ''}${keptIds.includes(item.id) ? '+' : ''}`,
  })),
  // un marqueur qui rassemble une borne fragile ne s'ouvre pas : on s'en approche
  opensTogether: (members) => !members.some((member) => member.fragile),
});

describe('état générique d’un calque à sélection', () => {
  const start = async (input?: { visible?: boolean; distance?: number }, list?: Post[]) => {
    const harness = underParent(createSelectionLayer(postsLayer(list)), input);
    await waitFor(harness.actor, (snapshot) => !snapshot.matches('probing'));
    return harness;
  };
  const types = (announced: AnyEventObject[]) => announced.map((event) => event.type);

  it('n’est pas proposé quand il n’a rien à montrer', async () => {
    const { actor, send, announced } = await start({}, []);
    expect(actor.getSnapshot().matches('absent')).toBe(true);
    expect(layerAvailable(actor.getSnapshot())).toBe(false);
    send({ type: 'layer.toggled' });
    expect(announced).toEqual([]);
  });

  it('allumé, annonce sa liste puis pose un marqueur par élément ; éteint, les retire', async () => {
    const { actor, send, announced } = await start();
    expect(layerFeed(actor.getSnapshot())).toBe('nominal');
    expect(types(announced)).toEqual(['layer.listed', 'layer.changed', 'layer.keptChanged']);
    expect(announced[1]).toMatchObject({ layer: 'posts', visible: true });
    expect(announced[1]!.features.map((feature: { id: string }) => feature.id)).toEqual(['a', 'b', 'c']);

    send({ type: 'layer.toggled' });
    expect(layerFeed(actor.getSnapshot())).toBe('off');
    expect(announced.slice(-3)).toMatchObject([
      { type: 'layer.changed', visible: false, features: [] },
      { type: 'layer.selectionChanged', item: null, markerId: null },
      { type: 'layer.keptChanged', items: [] },
    ]);
  });

  it('peut naître éteint : sa liste est connue, mais rien ne se laisse toucher', async () => {
    const { send, announced } = await start({ visible: false });
    send({ type: 'layer.picked', id: 'a' });
    expect(types(announced)).toEqual(['layer.listed']);
  });

  it('sélectionne et active l’élément touché', async () => {
    const { actor, send, announced } = await start();
    send({ type: 'layer.picked', id: 'a' });
    expect(layerSelection(actor.getSnapshot())).toMatchObject({ id: 'a' });
    expect(announced.slice(-2)).toMatchObject([
      { type: 'layer.selectionChanged', layer: 'posts', item: { id: 'a' }, markerId: 'a' },
      { type: 'layer.activated', layer: 'posts', item: { id: 'a' }, siblings: [{ id: 'a' }] },
    ]);
    // ses marqueurs sont reposés : celui de l'élément sélectionné peut changer d'aspect
    expect(announced.at(-3)!.features[0].label).toBe('a*');
    // toucher de nouveau l'élément sélectionné le réactive
    send({ type: 'layer.picked', id: 'a' });
    expect(announced.at(-1)).toMatchObject({ type: 'layer.activated', item: { id: 'a' } });

    const before = announced.length;
    send({ type: 'layer.picked', id: 'inconnu' });
    expect(announced).toHaveLength(before);
  });

  it('ouvre ensemble les éléments qu’un marqueur rassemble à l’écran, et les feuillette', async () => {
    const { actor, send, announced } = await start();
    // la carte dit ce que le marqueur touché rassemble
    send({ type: 'layer.picked', id: 'b', members: ['b', 'c', 'inconnu'] });
    expect(announced.at(-1)).toMatchObject({ type: 'layer.activated', item: { id: 'b' }, siblings: [{ id: 'b' }, { id: 'c' }] });
    send({ type: 'layer.stepped', delta: 1 });
    expect(announced.slice(-2)).toMatchObject([
      { type: 'layer.selectionChanged', item: { id: 'c' }, markerId: 'c', siblings: [{ id: 'b' }, { id: 'c' }] },
      { type: 'layer.activated', item: { id: 'c' } },
    ]);
    // le feuilletage s'arrête aux deux bouts
    const before = announced.length;
    send({ type: 'layer.stepped', delta: 1 });
    expect(announced).toHaveLength(before);
    send({ type: 'layer.stepped', delta: -1 });
    expect(layerSelection(actor.getSnapshot())).toMatchObject({ id: 'b' });
  });

  it('demande à s’approcher quand le marqueur rassemble ce qui ne s’ouvre pas ensemble', async () => {
    const { actor, send, announced } = await start({}, [...posts, { id: 'd', x: 11, y: 0, fragile: true }]);
    send({ type: 'layer.picked', id: 'b', members: ['b', 'd'] });
    expect(announced.at(-1)).toMatchObject({ type: 'layer.expandRequested', layer: 'posts', items: [{ id: 'b' }, { id: 'd' }] });
    expect(layerSelection(actor.getSnapshot())).toBeNull();
    // seule, la borne fragile se sélectionne comme les autres
    send({ type: 'layer.picked', id: 'd', members: ['d'] });
    expect(layerSelection(actor.getSnapshot())).toMatchObject({ id: 'd' });
  });

  it('désélectionne à la demande', async () => {
    const { actor, send, announced } = await start();
    const before = announced.length;
    send({ type: 'layer.dismissed' });
    expect(announced).toHaveLength(before);
    send({ type: 'layer.picked', id: 'a' });
    send({ type: 'layer.dismissed' });
    expect(layerSelection(actor.getSnapshot())).toBeNull();
    expect(announced.at(-1)).toMatchObject({ type: 'layer.selectionChanged', item: null, markerId: null });
  });

  it('garde un élément à l’écran à la demande, et s’en souvient quand le calque se rallume', async () => {
    const { actor, send, announced } = await start();
    send({ type: 'layer.keepToggled', id: 'b' });
    expect(layerKept(actor.getSnapshot())).toEqual(['b']);
    expect(announced.slice(-2)).toMatchObject([
      { type: 'layer.changed', visible: true },
      { type: 'layer.keptChanged', layer: 'posts', items: [{ id: 'b' }] },
    ]);
    expect(announced.at(-2)!.features[1].label).toBe('b+');
    // sélectionner autre chose, puis le désélectionner, n'y change rien
    send({ type: 'layer.picked', id: 'a' });
    send({ type: 'layer.dismissed' });
    expect(layerKept(actor.getSnapshot())).toEqual(['b']);

    send({ type: 'layer.toggled' });
    expect(announced.at(-1)).toMatchObject({ type: 'layer.keptChanged', items: [] });
    send({ type: 'layer.toggled' });
    expect(announced.at(-1)).toMatchObject({ type: 'layer.keptChanged', items: [{ id: 'b' }] });

    send({ type: 'layer.keepToggled', id: 'b' });
    expect(layerKept(actor.getSnapshot())).toEqual([]);
    const before = announced.length;
    send({ type: 'layer.keepToggled', id: 'inconnu' });
    expect(announced).toHaveLength(before);
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
    const { layer, announced } = await start({ visible: { bornes: false } });
    expect(layerFeed(layer('posts').getSnapshot())).toBe('nominal');
    expect(layerFeed(layer('bornes').getSnapshot())).toBe('off');
    // seul le calque allumé a posé ses marqueurs, relayés sous le nom de l'orchestrateur
    expect(announced.filter((event) => event.type === 'layers.changed')).toMatchObject([{ layer: 'posts', visible: true }]);
    expect(announced.filter((event) => event.type === 'layers.listed').map((event) => event.layer).sort()).toEqual(['bornes', 'posts']);
  });

  it('remet chaque geste au calque nommé, et relaie ce que les calques annoncent', async () => {
    const { send, layer, announced } = await start();
    send({ type: 'layers.picked', layer: 'bornes', id: 'z', members: ['z'] });
    expect(layerSelection(layer('bornes').getSnapshot())).toMatchObject({ id: 'z' });
    expect(layerSelection(layer('posts').getSnapshot())).toBeNull();
    expect(announced.slice(-2)).toMatchObject([
      { type: 'layers.selectionChanged', layer: 'bornes', item: { id: 'z' } },
      { type: 'layers.activated', layer: 'bornes', item: { id: 'z' } },
    ]);

    send({ type: 'layers.keepToggled', layer: 'posts', id: 'a' });
    expect(announced.at(-1)).toMatchObject({ type: 'layers.keptChanged', layer: 'posts', items: [{ id: 'a' }] });

    send({ type: 'layers.toggled', layer: 'posts' });
    expect(layerFeed(layer('posts').getSnapshot())).toBe('off');
    expect(layerFeed(layer('bornes').getSnapshot())).toBe('nominal');

    const before = announced.length;
    send({ type: 'layers.picked', layer: 'inconnu', id: 'z' });
    expect(announced).toHaveLength(before);
  });

  it('diffuse la vue à tous les calques', async () => {
    const { send, layer } = await start();
    send({ type: 'layers.viewChanged', distance: 42 });
    expect(layer('posts').getSnapshot().context.distance).toBe(42);
    expect(layer('bornes').getSnapshot().context.distance).toBe(42);
  });

  it('laisse au journal la trace de chaque geste, calque par calque', async () => {
    const buffer = new TelemetryBuffer();
    const { send } = await start({}, { inspect: createTelemetryInspector(buffer) });
    send({ type: 'layers.picked', layer: 'posts', id: 'a' });
    send({ type: 'layers.keepToggled', layer: 'posts', id: 'a' });
    send({ type: 'layers.dismissed', layer: 'posts' });
    const journal = JSON.stringify(buffer.drain());
    for (const type of ['layers.picked', 'layer.picked', 'layer.keepToggled', 'layer.dismissed']) expect(journal).toContain(type);
  });
});

/* ---- les deux calques tirés des scans ---- */
const credit = { author: 'A', title: 'T', url: 'https://exemple.be', licence: '©' };
const object = (id: string, x: number, y: number): Scan => ({ id, name: `Objet ${id}`, x, y, mesh: `/scans/${id}.glb`, credit });
const citadelle: Scan = { id: 'citadelle', name: 'Citadelle de Namur', x: 685265, y: 627878, splats: '/scans/namur.spz', credit };
const veves: Scan = { ...citadelle, id: 'veves', name: 'Château de Vêves', x: 693807, y: 601258 };
const facade = object('facade', 685186, 628504);
const mur = object('mur', 685188, 628493);
const lettres = object('lettres', 685567, 627965);
const view = { selectedId: null, distance: 900, keptIds: [] as string[] };

describe('calque de l’imagerie aérienne', () => {
  it('pose un marqueur par lieu, et efface de près celui d’un lieu dessiné', () => {
    expect(aerialLayer.markers([citadelle, veves], view).map((marker) => marker.id)).toEqual(['citadelle', 'veves']);
    const [selected, other] = aerialLayer.markers([citadelle, veves], { ...view, selectedId: 'citadelle' });
    expect(selected!.minDistance).toBeGreaterThan(0);
    expect(other!.minDistance).toBeUndefined();
    // un lieu gardé affiché est dessiné lui aussi
    expect(aerialLayer.markers([citadelle, veves], { ...view, keptIds: ['veves'] })[1]!.minDistance).toBeGreaterThan(0);
  });

  it('ne s’ouvre que lieu par lieu : un marqueur qui en rassemble plusieurs demande à s’approcher', async () => {
    const { actor, send, announced } = underParent(createSelectionLayer({ ...aerialLayer, load: async () => [citadelle, veves] }));
    await waitFor(actor, (snapshot) => snapshot.matches('visible'));
    send({ type: 'layer.picked', id: 'citadelle', members: ['citadelle', 'veves'] });
    expect(announced.at(-1)).toMatchObject({ type: 'layer.expandRequested', layer: 'scans' });
    send({ type: 'layer.picked', id: 'veves', members: ['veves'] });
    expect(announced.at(-1)).toMatchObject({ type: 'layer.activated', layer: 'scans', item: { id: 'veves' } });
  });

  it('dessine dans la carte le lieu sélectionné et ceux que l’on garde affichés', () => {
    expect(drawnScans(null, [])).toEqual([]);
    expect(drawnScans(citadelle, [])).toEqual([citadelle]);
    expect(drawnScans(veves, [citadelle])).toEqual([citadelle, veves]);
    expect(drawnScans(citadelle, [citadelle])).toEqual([citadelle]);
    expect(drawnScans(null, [citadelle])).toEqual([citadelle]);
  });

  it('se survole d’assez haut pour montrer tout un groupe, sans descendre trop bas pour un seul lieu', () => {
    expect(scansSpread([citadelle, veves])).toBeGreaterThan(20_000);
    const flyover = fitFlyover([citadelle, veves]);
    expect(flyover.x).toBeGreaterThan(685265);
    expect(flyover.x).toBeLessThan(693807);
    expect(flyover.height).toBeGreaterThan(20_000);
    expect(fitFlyover([citadelle]).height).toBe(150);
  });
});

describe('calque des objets scannés', () => {
  it('pose un marqueur par objet, chacun à sa place', () => {
    const markers = objectsLayer.markers([lettres, facade, mur], view);
    expect(markers.map((marker) => [marker.id, marker.x, marker.y])).toEqual([
      ['lettres', 685567, 627965], ['facade', 685186, 628504], ['mur', 685188, 628493],
    ]);
  });

  it('ouvre ensemble les objets qu’un marqueur rassemble', async () => {
    const { actor, send, announced } = underParent(createSelectionLayer({ ...objectsLayer, load: async () => [lettres, facade, mur] }));
    await waitFor(actor, (snapshot) => snapshot.matches('visible'));
    send({ type: 'layer.picked', id: 'facade', members: ['facade', 'mur'] });
    const activated = announced.at(-1)!;
    expect(activated).toMatchObject({ type: 'layer.activated', layer: 'objects', item: { id: 'facade' } });
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
