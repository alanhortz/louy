import { describe, expect, it } from 'vitest';
import { createActor, createMachine, fromPromise, sendTo, waitFor, type ActorRefFrom, type AnyEventObject } from 'xstate';
import {
  SATELLITE_TILT, isSatelliteImage, nearestSatelliteImage, satelliteDestination, satelliteViewPose, type SatelliteImage,
} from '../src/domain/satellite.ts';
import { satelliteActive, satelliteAvailable, satelliteMachine } from '../src/machines/satellite.machine.ts';

const credit = { author: 'Auteur', title: 'Vidéo', url: 'https://exemple.be', licence: 'CC BY' };
const image: SatelliteImage = { id: 'place', name: 'Place', src: '/satellite/place.webp', west: 1000, south: 2000, east: 1100, north: 2250, top: 110, credit };

describe('vue satellite', () => {
  it('n’accepte que des images du site, à l’emprise cohérente', () => {
    expect(isSatelliteImage(image)).toBe(true);
    expect(isSatelliteImage({ ...image, src: 'https://ailleurs.example/x.webp' })).toBe(false);
    expect(isSatelliteImage({ ...image, east: 900 })).toBe(false);
    expect(isSatelliteImage({ ...image, top: undefined })).toBe(false);
  });

  it('mesure la distance à l’emprise, nulle quand on est dessus', () => {
    expect(nearestSatelliteImage([image], 1050, 2100)!.distance).toBe(0);
    expect(nearestSatelliteImage([image], 1400, 2100)!.distance).toBe(300);
  });

  it('montre une image entière, du dessus, nord en haut', () => {
    const pose = satelliteViewPose(image);
    expect([pose.x, pose.y, pose.azimuth, pose.tilt]).toEqual([1050, 2125, 0, SATELLITE_TILT]);
    expect(pose.distance).toBeGreaterThan(250);
  });

  it('n’emmène au-dessus d’une image que si aucune n’est à portée de la vue', () => {
    const view = { x: 1300, y: 2100, distance: 800, azimuth: 40, tilt: 55 };
    expect(satelliteDestination([image], view)).toBeNull();
    expect(satelliteDestination([image], { ...view, x: 30000 })).toEqual(satelliteViewPose(image));
    // vue très large : l'image est dans le champ même à plusieurs kilomètres
    expect(satelliteDestination([image], { ...view, x: 5000, distance: 20000 })).toBeNull();
  });
});

describe('machine de la vue satellite', () => {
  const start = (images: SatelliteImage[]) => {
    const announced: AnyEventObject[] = [];
    const parent = createActor(createMachine({
      invoke: { id: 'child', src: satelliteMachine.provide({ actors: { load: fromPromise(async () => images) } }) },
      on: {
        'to.child': { actions: sendTo('child', ({ event }) => (event as AnyEventObject).event) },
        '*': { actions: ({ event }) => { announced.push(event); } },
      },
    })).start();
    const actor = parent.getSnapshot().children.child as ActorRefFrom<typeof satelliteMachine>;
    return { actor, announced, send: (event: AnyEventObject) => parent.send({ type: 'to.child', event }) };
  };

  it('ne propose pas le globe quand le site ne publie aucune image', async () => {
    const { actor } = start([]);
    await waitFor(actor, (snapshot) => snapshot.matches('absent'));
    expect(satelliteAvailable(actor.getSnapshot())).toBe(false);
  });

  it('s’enclenche et se quitte, en annonçant ses images', async () => {
    const { actor, announced, send } = start([image]);
    await waitFor(actor, satelliteAvailable);
    send({ type: 'satellite.toggled' });
    expect(satelliteActive(actor.getSnapshot())).toBe(true);
    expect(announced.at(-1)).toEqual({ type: 'satellite.changed', active: true, images: [image], byVisitor: true });
    send({ type: 'satellite.toggled' });
    expect(announced.at(-1)).toEqual({ type: 'satellite.changed', active: false, images: [], byVisitor: true });
  });
});

describe('lieux où l’on se promène', () => {
  it('écarte les tracés, les images du sol et les lieux de quelques mètres', async () => {
    const { isWalkable } = await import('../src/domain/scans.ts');
    const place = { id: 'a', name: 'A', x: 0, y: 0, splats: '/scans/a.spz', credit };
    expect(isWalkable(place)).toBe(true);
    expect(isWalkable({ ...place, span: 9 })).toBe(false);
    expect(isWalkable({ ...place, span: 120 })).toBe(true);
    expect(isWalkable({ ...place, trace: true })).toBe(false);
    expect(isWalkable({ ...place, orthophoto: true })).toBe(false);
  });
});

describe('relevé mis de côté', () => {
  it('n’est pas lu du manifeste tant qu’il porte `disabled`', async () => {
    const { parseScans } = await import('../src/domain/scans.ts');
    const place = { id: 'a', name: 'A', x: 0, y: 0, splats: '/scans/a.spz', credit };
    expect(parseScans([place, { ...place, id: 'b', disabled: true }]).map((scan) => scan.id)).toEqual(['a']);
  });
});
