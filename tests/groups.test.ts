import { describe, expect, it } from 'vitest';
import { createActor, createMachine, fromPromise, sendTo, waitFor, type AnyEventObject } from 'xstate';
import { groupObjects, scanGroupRadius, type Scan } from '../src/domain/scans.ts';
import { objectMachine, objectPage } from '../src/machines/object.machine.ts';
import { scansMachine } from '../src/machines/scans.machine.ts';

const credit = { author: 'A', title: 'T', url: 'https://exemple.be', licence: '©' };
const object = (id: string, x: number, y: number): Scan => ({ id, name: `Objet ${id}`, x, y, mesh: `/scans/${id}.glb`, credit });
const place: Scan = { id: 'lieu', name: 'Lieu', x: 0, y: 0, splats: '/scans/lieu.spz', credit };

const facade = object('facade', 685186, 628504);
const mur = object('mur', 685188, 628493);
const lettres = object('lettres', 685567, 627965);

describe('groupes d’objets voisins', () => {
  it('réunit les objets à portée l’un de l’autre, et laisse les autres seuls', () => {
    const groups = groupObjects([place, lettres, facade, mur], 60);
    expect(groups.map((group) => group.map((scan) => scan.id))).toEqual([['lettres'], ['facade', 'mur']]);
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

describe('marqueur d’un groupe', () => {
  async function scans(list: Scan[]) {
    const announced: AnyEventObject[] = [];
    const parent = createActor(createMachine({
      invoke: { id: 'scans', src: scansMachine.provide({ actors: { loadScans: fromPromise(async () => list) } }), input: { distance: 900 } },
      on: {
        'to.child': { actions: sendTo('scans', ({ event }) => (event as AnyEventObject).event) },
        '*': { actions: ({ event }) => { announced.push(event); } },
      },
    })).start();
    await waitFor(parent.getSnapshot().children.scans!, (snapshot) => snapshot.matches('visible'));
    return { announced, send: (event: AnyEventObject) => parent.send({ type: 'to.child', event }) };
  }

  it('porte le nombre d’objets qu’il rassemble', async () => {
    const { announced } = await scans([place, lettres, facade, mur]);
    const features = announced.findLast((event) => event.type === 'scans.changed')!.features;
    expect(features).toHaveLength(3);
    expect(features.find((feature: { id: string }) => feature.id === 'lettres').count).toBeUndefined();
    expect(features.find((feature: { id: string }) => feature.id === 'facade')).toMatchObject({ count: 2, label: '2 objets en 3D', x: 685187 });
  });

  it('ouvre la visionneuse sur le groupe entier', async () => {
    const { announced, send } = await scans([place, lettres, facade, mur]);
    send({ type: 'scans.picked', id: 'facade' });
    const request = announced.at(-1)!;
    expect(request).toMatchObject({ type: 'scans.objectRequested', scan: { id: 'facade' } });
    expect(request.group.map((scan: Scan) => scan.id)).toEqual(['facade', 'mur']);
    send({ type: 'scans.picked', id: 'lettres' });
    expect(announced.at(-1)!.group).toHaveLength(1);
  });
});

describe('groupes et éloignement', () => {
  it('rend à chaque objet son marqueur quand on s’approche, et ne repose rien sinon', async () => {
    const announced: AnyEventObject[] = [];
    const parent = createActor(createMachine({
      invoke: { id: 'scans', src: scansMachine.provide({ actors: { loadScans: fromPromise(async () => [lettres, facade, mur]) } }), input: { distance: 900 } },
      on: {
        'to.child': { actions: sendTo('scans', ({ event }) => (event as AnyEventObject).event) },
        '*': { actions: ({ event }) => { announced.push(event); } },
      },
    })).start();
    const send = (event: AnyEventObject) => parent.send({ type: 'to.child', event });
    await waitFor(parent.getSnapshot().children.scans!, (snapshot) => snapshot.matches('visible'));
    const before = announced.length;
    send({ type: 'scans.viewChanged', distance: 700 });
    expect(announced).toHaveLength(before);
    send({ type: 'scans.viewChanged', distance: 100 });
    const laid = () => announced.findLast((event) => event.type === 'scans.changed')!.features;
    expect(laid().map((feature: { id: string }) => feature.id)).toEqual(['lettres', 'facade', 'mur']);
    // de près, le marqueur du mur peint n'ouvre que lui
    send({ type: 'scans.picked', id: 'mur' });
    expect(announced.at(-1)).toMatchObject({ type: 'scans.objectRequested', scan: { id: 'mur' } });
    expect(announced.at(-1)!.group).toHaveLength(1);
    // en reculant, les deux voisins se rassemblent ; le mur peint reste sélectionné, sous le marqueur du groupe
    send({ type: 'scans.viewChanged', distance: 900 });
    expect(laid()).toHaveLength(2);
    expect(announced.at(-1)).toMatchObject({ type: 'scans.selectionChanged', scan: { id: 'mur' }, markerId: 'facade' });
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
    expect(actor.getSnapshot().context.scan?.id).toBe('mur');
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
    actor.send({ type: 'object.paged', delta: 1, by: 'keyboard' });
    expect(actor.getSnapshot().context.scan?.id).toBe('lettres');
    actor.send({ type: 'object.closed', by: 'escape' });
    expect(objectPage(actor.getSnapshot())).toEqual({ index: 0, total: 0 });
  });
});
