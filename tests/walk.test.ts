import { describe, expect, it } from 'vitest';
import { createActor, createMachine, type AnyEventObject } from 'xstate';
import { buildGround, canStep, castGround, groundAt, nearestPlace, nearestStand } from '../src/domain/walk.ts';
import type { Scan } from '../src/domain/scans.ts';
import { walkMachine, walkPhase } from '../src/machines/walk.machine.ts';

/** Une place de 60 m de côté à 100 m d'altitude, avec un bâtiment de 6 m de haut en son milieu. */
function square(): Float32Array {
  const points: number[] = [];
  for (let x = 0; x < 60; x += 0.5) {
    for (let z = 0; z < 60; z += 0.5) {
      const inside = x >= 20 && x < 40 && z >= 20 && z < 40;
      points.push(x, inside ? 106 : 100, z);
    }
  }
  // une voiture posée sur la place, et un splat égaré sous le sol
  for (let x = 5; x < 9; x += 0.25) for (let z = 5; z < 7; z += 0.25) points.push(x, 101.4, z);
  points.push(50.2, 80, 50.2);
  return new Float32Array(points);
}

describe('sol d’un lieu filmé', () => {
  const ground = buildGround(square())!;

  it('retient le bas des splats, sans le splat égaré ni la voiture', () => {
    expect(groundAt(ground, 50, 50)).toBeCloseTo(100, 1);
    expect(groundAt(ground, 7, 6)).toBeCloseTo(100, 1);
  });

  it('s’arrête hors du lieu', () => {
    expect(groundAt(ground, -30, 10)).toBeNull();
    expect(nearestStand(ground, -30, 10)!.x).toBeGreaterThanOrEqual(0);
  });

  it('laisse marcher sur la place et arrête devant le bâtiment', () => {
    expect(canStep(ground, { x: 5, z: 50 }, { x: 5.2, z: 50 })).toBe(true);
    let x = 5;
    while (x < 35 && canStep(ground, { x, z: 30 }, { x: x + 0.2, z: 30 })) x += 0.2;
    expect(x).toBeGreaterThan(12);
    expect(x).toBeLessThan(26);
  });

  it('trouve le point du sol visé d’en haut', () => {
    const hit = castGround(ground, { x: 10, y: 150, z: 50 }, { x: 0, y: -1, z: 0 }, 200)!;
    expect(hit.x).toBeCloseTo(10, 5);
    expect(castGround(ground, { x: 10, y: 150, z: 50 }, { x: 0, y: 1, z: 0 }, 200)).toBeNull();
  });

  it('refuse un lieu trop pauvre', () => {
    expect(buildGround(new Float32Array(30))).toBeNull();
  });
});

const place = (id: string, x: number, y: number): Scan => ({
  id, name: id, x, y, splats: `/scans/${id}.spz`,
  credit: { author: 'a', title: 't', url: 'https://example.org', licence: 'CC BY' },
});

describe('entrer dans un lieu en zoomant', () => {
  it('demande une pose stricte, et explique si le sol n’est pas là', () => {
    const heard: AnyEventObject[] = [];
    const parent = createActor(createMachine({
      invoke: { id: 'walk', src: walkMachine },
      on: { '*': { actions: ({ event }) => { heard.push(event); } } },
    })).start();
    const walk = parent.getSnapshot().children.walk as ReturnType<typeof createActor<typeof walkMachine>>;
    const scan = place('esplanade', 10, 20);
    walk.send({ type: 'walk.placed', scan, x: 11, y: 21, byZoom: true });
    expect(heard.at(-1)).toMatchObject({ type: 'walk.started', strict: true });
    expect(walkPhase(walk.getSnapshot())).toBe('checking');
    walk.send({ type: 'walk.failed' });
    // à côté du lieu : la carte reste la carte, et dit où viser
    expect(walkPhase(walk.getSnapshot())).toBe('declined');
    expect(walk.getSnapshot().context.notice).toBe('Rien de filmé à cet endroit — visez esplanade');
    expect(heard.at(-1)).toEqual({ type: 'walk.ended' });
    walk.send({ type: 'walk.left' });
    expect(walkPhase(walk.getSnapshot())).toBe('idle');
  });
});

describe('lieu filmé le plus proche', () => {
  it('ignore les objets et rend la distance', () => {
    const object = { ...place('objet', 0, 0), splats: undefined, mesh: '/scans/o.glb' };
    const nearest = nearestPlace([object, place('a', 300, 400), place('b', 3000, 0)], 0, 0)!;
    expect(nearest.scan.id).toBe('a');
    expect(nearest.distance).toBe(500);
    expect(nearestPlace([object], 0, 0)).toBeNull();
  });
});

describe('machine de la balade', () => {
  function start() {
    const heard: AnyEventObject[] = [];
    const parent = createActor(createMachine({
      invoke: { id: 'walk', src: walkMachine },
      on: { '*': { actions: ({ event }) => { heard.push(event); } } },
    })).start();
    const walk = parent.getSnapshot().children.walk as ReturnType<typeof createActor<typeof walkMachine>>;
    return { walk, heard, phase: () => walkPhase(walk.getSnapshot()) };
  }

  it('arme l’outil, puis descend dans le lieu désigné', () => {
    const { walk, heard, phase } = start();
    walk.send({ type: 'walk.toggled' });
    expect(phase()).toBe('aiming');
    expect(heard.at(-1)).toEqual({ type: 'walk.aimChanged', armed: true });

    walk.send({ type: 'walk.missed', nearest: { name: 'Esplanade', distance: 3200 } });
    expect(walk.getSnapshot().context.notice).toContain('Esplanade, à 3,2 km');

    const scan = place('esplanade', 10, 20);
    walk.send({ type: 'walk.placed', scan, x: 11, y: 21 });
    expect(phase()).toBe('arriving');
    expect(heard).toContainEqual({ type: 'walk.aimChanged', armed: false });
    expect(heard.at(-1)).toEqual({ type: 'walk.started', scan, x: 11, y: 21, azimuth: undefined, strict: false });

    walk.send({ type: 'walk.entered' });
    expect(phase()).toBe('walking');
    walk.send({ type: 'walk.left' });
    expect(phase()).toBe('idle');
    expect(heard.at(-1)).toEqual({ type: 'walk.ended' });
    expect(walk.getSnapshot().context.scan).toBeNull();
  });

  it('revient viser si le lieu ne se visite pas', () => {
    const { walk, heard, phase } = start();
    walk.send({ type: 'walk.placed', scan: place('a', 0, 0), x: 0, y: 0 });
    walk.send({ type: 'walk.failed' });
    expect(phase()).toBe('aiming');
    expect(heard).toContainEqual({ type: 'walk.ended' });
    expect(walk.getSnapshot().context.notice).toBe('Ce lieu ne se visite pas à pied');
  });
});

describe('coordonnées et position du visiteur', () => {
  it('rend les coordonnées en latitude, longitude', async () => {
    const { formatCoordinates, devicePosition, locationHeight } = await import('../src/domain/whereabouts.ts');
    const { toLambert } = await import('../src/domain/lambert2008.ts');
    const namur = toLambert(50.464149, 4.855642);
    expect(formatCoordinates(namur.x, namur.y)).toBe('50.464149, 4.855642');
    expect(formatCoordinates(namur.x, namur.y, 180)).toBe('50.464149, 4.855642, 180°');
    expect(formatCoordinates(namur.x, namur.y, 359.7)).toBe('50.464149, 4.855642, 0°');
    expect(devicePosition(50.464149, 4.855642, 12)).toMatchObject({ accuracy: 12 });
    // Paris n'est pas sur la carte
    expect(devicePosition(48.8566, 2.3522, 12)).toBeNull();
    expect(locationHeight({ x: 0, y: 0, accuracy: 5 })).toBe(260);
    expect(locationHeight({ x: 0, y: 0, accuracy: 5000 })).toBe(4000);
  });

  it('pose le repère, y emmène la vue, puis le retire', async () => {
    const { fromPromise } = await import('xstate');
    const { locationMachine, locationNotice } = await import('../src/machines/location.machine.ts');
    const heard: AnyEventObject[] = [];
    const run = (locate: () => Promise<{ x: number; y: number; accuracy: number }>) => {
      const parent = createActor(createMachine({
        invoke: { id: 'location', src: locationMachine.provide({ actors: { locate: fromPromise(locate) } }) },
        on: { '*': { actions: ({ event }) => { heard.push(event); } } },
      })).start();
      return parent.getSnapshot().children.location as ReturnType<typeof createActor<typeof locationMachine>>;
    };
    const position = { x: 684783, y: 627522, accuracy: 20 };
    const found = run(async () => position);
    found.send({ type: 'location.toggled' });
    expect(locationNotice(found.getSnapshot())).toBe('Recherche de votre position…');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(found.getSnapshot().matches('shown')).toBe(true);
    expect(heard).toEqual([{ type: 'location.changed', position }, { type: 'location.flyRequested', position }]);
    found.send({ type: 'location.toggled' });
    expect(heard.at(-1)).toEqual({ type: 'location.changed', position: null });

    const refused = run(() => Promise.reject('denied'));
    refused.send({ type: 'location.toggled' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(locationNotice(refused.getSnapshot())).toBe('Localisation refusée par le navigateur');
  });
});

describe('la position du visiteur ne s’écrit nulle part', () => {
  it('est masquée dans le journal local, avec tout ce qui la trahirait', async () => {
    const { createTelemetryInspector } = await import('../src/app/inspector.ts');
    const { TelemetryBuffer } = await import('../src/services/telemetry.ts');
    const buffer = new TelemetryBuffer();
    const inspect = createTelemetryInspector(buffer);
    const actor = (id: string) => ({ id }) as never;
    const event = (to: string, from: string, payload: AnyEventObject) =>
      inspect({ type: '@xstate.event', actorRef: actor(to), sourceRef: actor(from), event: payload, rootId: 'app' } as never);
    const home = { x: 684783, y: 627522, accuracy: 20 };

    event('viewer', 'app', { type: 'viewer.flyoverRequested', flyover: { x: 700000, y: 640000, height: 200 } });
    event('location', 'location.locate', { type: 'xstate.done.actor.location.locate', output: home });
    event('app', 'location', { type: 'location.changed', position: home });
    event('viewer', 'app', { type: 'viewer.flyoverRequested', flyover: { x: home.x, y: home.y, height: 260 } });
    event('app', 'viewer', { type: 'viewer.viewSettled', pose: { x: home.x + 300, y: home.y - 200, distance: 400 } });
    event('app', 'viewer', { type: 'viewer.viewSettled', pose: { x: home.x + 5000, y: home.y + 7000, distance: 400 } });
    // le repère retiré, la position reste tue jusqu'à la fin de la page
    event('app', 'location', { type: 'location.changed', position: null });
    event('app', 'viewer', { type: 'viewer.viewSettled', pose: { x: home.x, y: home.y, distance: 400 } });

    const written = JSON.stringify(buffer.drain());
    expect(written).toContain('700000');
    expect(written).toContain(String(home.x + 5000));
    for (const secret of [home.x, home.y, home.x + 300, home.y - 200]) expect(written).not.toContain(String(secret));
    expect(written.match(/masqué/g)).toHaveLength(6);
  });
});

describe('séquences filmées replacées dans la carte', () => {
  it('interpole la pose de la caméra et lit son cap', async () => {
    const { clipPose, clipHeading, clipViewPose, clipScreenDistance, isClip } = await import('../src/domain/clips.ts');
    const { parseScans } = await import('../src/domain/scans.ts');
    const north: [number, number, number, number] = [0, 0, 0, 1];
    // un quart de tour vers la droite autour de la verticale : la caméra regarde l'est
    const east: [number, number, number, number] = [0, -Math.SQRT1_2, 0, Math.SQRT1_2];
    const track = [{ t: 0, x: 100, y: 200, altitude: 50, q: north }, { t: 2, x: 104, y: 200, altitude: 52, q: east }];
    expect(clipHeading(north)).toBeCloseTo(0);
    expect(clipHeading(east)).toBeCloseTo(90);
    const middle = clipPose(track, 1);
    expect(middle).toMatchObject({ x: 102, altitude: 51 });
    expect(clipHeading(middle.q)).toBeCloseTo(45);
    expect(clipPose(track, -3)).toBe(track[0]);
    expect(clipPose(track, 9)).toBe(track[1]);

    const clip = { id: 'c', name: 'Séquence', src: '/scans/clips/c.mp4', fov: 20, aspect: 16 / 9, track };
    expect(isClip(clip)).toBe(true);
    expect(isClip({ ...clip, src: 'https://ailleurs.example/c.mp4' })).toBe(false);
    expect(isClip({ ...clip, track: [track[1], track[0]] })).toBe(false);
    // la vue se place dans l'axe de la caméra, devant elle
    const view = clipViewPose(clip);
    expect(view.azimuth).toBeCloseTo(0);
    expect(view.y).toBeCloseTo(200 + clipScreenDistance(clip) / 2);
    // une séquence appartient à un lieu, jamais à un objet
    const place = { id: 'p', name: 'p', x: 0, y: 0, splats: '/scans/p.spz', credit: { author: 'a', title: 't', url: 'https://example.org', licence: 'CC BY' } };
    expect(parseScans([{ ...place, clips: [clip] }])).toHaveLength(1);
    expect(parseScans([{ ...place, splats: undefined, mesh: '/scans/p.glb', clips: [clip] }])).toEqual([]);
  });
});
