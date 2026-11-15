import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor, createMachine, fromPromise, sendTo, waitFor, type AnyEventObject } from 'xstate';
import { toLambert } from '../src/domain/lambert2008.ts';
import { inWallonia } from '../src/domain/walloniaOutline.ts';
import {
  VESSEL_ROUTE, parseVesselPage, vesselEdgePath, vesselLabel, vesselPageUrl, vesselStateLabel, type Vessel,
} from '../src/domain/vessels.ts';
import { selectedVessel, vesselsFeed, vesselsMachine } from '../src/machines/vessels.machine.ts';
import worker from '../worker/index.ts';

const NOW = Date.parse('2026-11-15T10:00:00Z');
/** Une piste telle qu'EuRIS la rend, sur la Sambre à Charleroi. */
const track = (over: Record<string, unknown> = {}) => ({
  trackId: '651050', name: 'Track 651050', mmsi: 0, eni: null, callSign: null,
  lat: 50.4079, lon: 4.4441, navigationalStatus: 0, length: 83, beam: 9.5,
  courseGround: 247, speedGround: 11.2, isMoving: true, isLost: false,
  positionMeasuredAt: '2026-11-15T09:59:20+00:00', isrsPositionName: 'Sambre km 38.2', privacyClass: 2, ...over,
});

describe('positions des bateaux', () => {
  it('lit position, route, vitesse et dimensions, et rien qui identifie le bateau', () => {
    const { vessels, more } = parseVesselPage({ items: [track()], count: 1 }, NOW);
    const at = toLambert(50.4079, 4.4441);
    expect(vessels).toEqual([{
      id: '651050', x: Math.round(at.x), y: Math.round(at.y), length: 83, beam: 9.5, course: 247, speed: 11.2,
      moving: true, state: 'underway', place: 'Sambre km 38.2', seenAt: Date.parse('2026-11-15T09:59:20Z'),
    }]);
    expect(Object.keys(vessels[0]!)).not.toEqual(expect.arrayContaining(['name', 'mmsi', 'eni', 'callSign']));
    expect(more).toBe(false);
  });

  it('écarte les bateaux hors de Wallonie, perdus de vue ou relevés il y a trop longtemps', () => {
    const { vessels } = parseVesselPage({ items: [
      track({ trackId: 'anvers', lat: 51.23, lon: 4.4 }),
      track({ trackId: 'perdu', isLost: true }),
      track({ trackId: 'vieux', positionMeasuredAt: '2026-11-15T08:00:00+00:00' }),
      track({ trackId: 'sans-position', lat: null }),
      track({ trackId: 'bon' }),
    ] }, NOW);
    expect(vessels.map((vessel) => vessel.id)).toEqual(['bon']);
    expect(parseVesselPage({ message: 'erreur' }, NOW)).toEqual({ vessels: [], more: false });
  });

  it('dit ce que fait le bateau, et tolère ce qu’il n’annonce pas', () => {
    const one = (over: Record<string, unknown>) => parseVesselPage({ items: [track(over)] }, NOW).vessels[0]!;
    expect(vesselStateLabel(one({}))).toBe('En route');
    expect(vesselStateLabel(one({ navigationalStatus: 5, isMoving: false, speedGround: 0 }))).toBe('Amarré');
    expect(vesselStateLabel(one({ isMoving: false, speedGround: 0 }))).toBe('À l’arrêt');
    expect(vesselStateLabel(one({ navigationalStatus: 15 }))).toBe('Statut non annoncé');
    const bare = one({ length: 0, beam: 0, courseGround: 511, isrsPositionName: null });
    expect([bare.length, bare.beam, bare.course, bare.place]).toEqual([null, null, 0, null]);
    expect([vesselLabel(one({})), vesselLabel(bare)]).toEqual(['83 m', 'Bateau']);
  });

  it('sait qu’il reste une page à lire quand celle-ci est pleine', () => {
    const items = Array.from({ length: 100 }, (_, k) => track({ trackId: String(k) }));
    expect(parseVesselPage({ items, nextPageLink: 'https://www.eurisportal.eu/…&$skip=100' }, NOW).more).toBe(true);
    expect(parseVesselPage({ items: items.slice(0, 7), nextPageLink: null }, NOW).more).toBe(false);
  });

  it('ne demande au relais qu’une des quatre pages prévues', () => {
    expect(VESSEL_ROUTE.exec(vesselEdgePath(100))?.[1]).toBe('100');
    expect(['/vessels/50.json', '/vessels/400.json', '/vessels/0.json?x', '/vessels/../x.json'].map((path) => VESSEL_ROUTE.test(path))).toEqual([false, false, false, false]);
    const url = new URL(vesselPageUrl(200));
    expect(url.origin + url.pathname).toBe('https://www.eurisportal.eu/api/v3/tracks/bounding-box');
    expect(url.searchParams.get('$skip')).toBe('200');
  });
});

describe('machine du trafic fluvial', () => {
  beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout'] }); });
  afterEach(() => vi.useRealTimers());

  const barge = (id: string, over: Partial<Vessel> = {}): Vessel => ({
    id, x: 650000, y: 620000, length: 83, beam: 9.5, course: 247, speed: 11, moving: true, state: 'underway', place: null, seenAt: NOW, ...over,
  });
  function traffic(visible: boolean, load: () => Promise<Vessel[]> = async () => [barge('a'), barge('b', { moving: false, length: 110 })]) {
    const announced: AnyEventObject[] = [];
    const calls = vi.fn(load);
    const parent = createActor(createMachine({
      invoke: { id: 'vessels', src: vesselsMachine.provide({ actors: { loadVessels: fromPromise(calls) } }), input: { visible } },
      on: {
        'to.child': { actions: sendTo('vessels', ({ event }) => (event as AnyEventObject).event) },
        '*': { actions: ({ event }) => { announced.push(event); } },
      },
    })).start();
    const actor = parent.getSnapshot().children.vessels!;
    return { announced, actor, calls, send: (event: AnyEventObject) => parent.send({ type: 'to.child', event }) };
  }
  const snap = (actor: { getSnapshot(): unknown }) => actor.getSnapshot() as never;

  it('éteint, ne demande rien ; allumé, relève les bateaux et recommence toutes les trente secondes', async () => {
    const { actor, send, calls, announced } = traffic(false);
    expect(vesselsFeed(snap(actor))).toBe('off');
    expect(calls).not.toHaveBeenCalled();
    send({ type: 'vessels.toggled' });
    await waitFor(actor, (snapshot) => snapshot.matches({ visible: 'waiting' }));
    expect(announced.at(-1)).toMatchObject({ type: 'vessels.changed', visible: true });
    // en route d'abord, quand la place manque
    expect(announced.at(-1)!.features.map((feature: { id: string; rank: number }) => [feature.id, feature.rank])).toEqual([['a', 1083], ['b', 110]]);
    expect(vesselsFeed(snap(actor))).toBe('nominal');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('ouvre la fiche du bateau choisi, le situe, et le lâche s’il quitte le relevé', async () => {
    let list = [barge('a'), barge('b')];
    const { actor, send, announced } = traffic(true, async () => list);
    await waitFor(actor, (snapshot) => snapshot.matches({ visible: 'waiting' }));
    send({ type: 'vessels.picked', id: 'inconnu' });
    expect(selectedVessel(snap(actor))).toBeNull();
    send({ type: 'vessels.picked', id: 'a' });
    expect(announced.at(-1)).toMatchObject({ type: 'vessels.selectionChanged', vessel: { id: 'a' } });
    send({ type: 'vessels.locateRequested' });
    expect(announced.at(-1)).toMatchObject({ type: 'vessels.flyRequested', x: 650000, y: 620000 });
    list = [barge('b')];
    await vi.advanceTimersByTimeAsync(30_000);
    expect(selectedVessel(snap(actor))).toBeNull();
    expect(announced.at(-1)).toEqual({ type: 'vessels.selectionChanged', vessel: null });
  });

  it('garde les dernières positions quand EuRIS se tait, et retire tout quand on éteint', async () => {
    let fail = false;
    const { actor, send, announced } = traffic(true, async () => { if (fail) throw new Error('502'); return [barge('a')]; });
    await waitFor(actor, (snapshot) => snapshot.matches({ visible: 'waiting' }));
    fail = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(vesselsFeed(snap(actor))).toBe('degraded');
    expect((actor.getSnapshot() as { context: { list: Vessel[] } }).context.list).toHaveLength(1);
    send({ type: 'vessels.toggled' });
    expect(announced.some((event) => event.type === 'vessels.changed' && event.visible === false && event.features.length === 0)).toBe(true);
  });
});

describe('relais des bateaux', () => {
  const store = new Map<string, Response>();
  const pending: Promise<unknown>[] = [];
  const context = { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } };
  const env = { ASSETS: { fetch: vi.fn(async () => new Response('site')) } };
  const call = (path: string) => worker.fetch(new Request(`https://louy.be${path}`), env, context);

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('caches', {
      default: {
        match: async (request: Request) => store.get(request.url)?.clone(),
        put: async (request: Request, response: Response) => { store.set(request.url, response); },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('demande la page à EuRIS, la garde une demi-minute, et refuse toute autre page', async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response('{"items":[]}', { headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await call('/edge/v1/vessels/100.json');
    expect(fetchMock.mock.calls[0]![0]).toBe(vesselPageUrl(100));
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=30, s-maxage=30');
    await Promise.all(pending.splice(0));
    await call('/edge/v1/vessels/100.json');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await call('/edge/v1/vessels/500.json')).status).toBe(404);
  });
});

describe('contour de la Wallonie', () => {
  const at = (lat: number, lon: number) => { const p = toLambert(lat, lon); return inWallonia(p.x, p.y); };

  it('distingue ce qui est en Wallonie de ce qui la borde', () => {
    // Namur, Liège, Tournai, Arlon
    expect([at(50.4669, 4.8675), at(50.6451, 5.5734), at(50.6056, 3.3879), at(49.6833, 5.8167)]).toEqual([true, true, true, true]);
    // Bruxelles, Maastricht, Valenciennes, Luxembourg, Anvers
    expect([at(50.8466, 4.3528), at(50.8514, 5.691), at(50.3579, 3.5235), at(49.6117, 6.1319), at(51.2194, 4.4025)]).toEqual([false, false, false, false, false]);
  });
});
