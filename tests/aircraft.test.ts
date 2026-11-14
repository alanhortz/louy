import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor, createMachine, fromPromise, sendTo, type AnyActorLogic, type AnyEventObject } from 'xstate';
import {
  AIRCRAFT_POLL_MS, AIRFIELDS, MAX_EXTRAPOLATION_S, aircraftAt, aircraftFeedUrl, aircraftPhase, cockpitPose,
  parseAircraft, phaseLabel, searchAircraft, type Aircraft,
} from '../src/domain/aircraft.ts';
import { decodeView, encodeView, DEFAULT_VIEW } from '../src/domain/view.ts';
import { aircraftFeed, aircraftMachine, listedAircraft, selectedAircraft } from '../src/machines/aircraft.machine.ts';
import worker from '../worker/index.ts';

const DEG = Math.PI / 180;

/** Un relevé tel que le réseau le renvoie : pieds, nœuds, pieds par minute. */
const feed = {
  now: 1_800_000_000_000,
  ac: [
    { hex: '4ca7b5', flight: 'RYR70EA ', r: 'EI-EMO', t: 'B738', lat: 50.47, lon: 4.87, alt_baro: 37000, alt_geom: 37750, gs: 410, track: 90, baro_rate: 0, squawk: '3105', nav_altitude_mcp: 38000, ias: 247, mach: 0.78, wd: 317, ws: 36, oat: -58, seen_pos: 2 },
    { hex: '44a821', flight: 'JAF3BX  ', r: 'OO-JAF', t: 'B738', lat: 50.46, lon: 4.56, alt_baro: 2500, gs: 150, track: 245, baro_rate: -800, seen_pos: 0.5 },
    { hex: '44b111', r: 'OO-TND', t: 'A320', lat: 50.4592, lon: 4.4538, alt_baro: 'ground', gs: 8, track: 60, seen_pos: 1 },
    { hex: '3c6444', flight: 'DLH400', lat: 53.5, lon: 10.0, alt_baro: 36000, gs: 450, track: 270 },   // Hambourg : hors Wallonie
    { hex: 'ffffff', flight: 'SANSPOS' },                                                              // sans position
  ],
};
const [cruiser, lander, parked] = parseAircraft(feed) as [Aircraft, Aircraft, Aircraft];

describe('avions : lecture du relevé', () => {
  it('ne garde que les appareils situés au-dessus de la Wallonie', () => {
    expect(parseAircraft(feed).map((aircraft) => aircraft.callsign)).toEqual(['RYR70EA', 'JAF3BX', 'OO-TND']);
    expect(parseAircraft(null)).toEqual([]);
    expect(parseAircraft({ ac: 'rien' })).toEqual([]);
  });

  it('convertit pieds, nœuds et pieds par minute en mètres et secondes', () => {
    expect(cruiser.altitude).toBe(Math.round(37750 * 0.3048));          // l'altitude géométrique prime
    expect(cruiser.speed).toBeCloseTo(410 * 0.514444, 3);
    expect(lander.verticalRate).toBeCloseTo(-800 * 0.3048 / 60, 4);
    expect(cruiser.selectedAltitude).toBe(Math.round(38000 * 0.3048));
    expect(cruiser.wind).toEqual({ from: 317, speed: 36 * 0.514444 });
    expect(cruiser.seenAt).toBe(feed.now - 2000);
    // Namur, en Lambert 2008
    expect(cruiser.x).toBeGreaterThan(684000);
    expect(cruiser.x).toBeLessThan(687000);
  });

  it('reconnaît un appareil au sol, et le nomme par son immatriculation faute d’indicatif', () => {
    expect(parked).toMatchObject({ onGround: true, altitude: null, callsign: 'OO-TND' });
  });
});

describe('avions : phase de vol', () => {
  it('distingue le survol, l’approche d’un terrain wallon et le stationnement', () => {
    expect(phaseLabel(aircraftPhase(cruiser))).toBe('En palier');
    expect(phaseLabel(aircraftPhase(lander))).toBe('En approche de Charleroi');
    expect(phaseLabel(aircraftPhase(parked))).toBe('Au sol à Charleroi');
    expect(phaseLabel(aircraftPhase({ ...lander, verticalRate: 9 }))).toBe('Au départ de Charleroi');
    expect(phaseLabel(aircraftPhase({ ...cruiser, verticalRate: -6 }))).toBe('En descente');
  });

  it('connaît Charleroi et Liège', () => {
    expect(AIRFIELDS.map((field) => field.code)).toEqual(expect.arrayContaining(['EBCI', 'EBLG']));
  });
});

describe('avions : position entre deux relevés', () => {
  it('prolonge l’appareil sur sa route, à sa vitesse', () => {
    const later = aircraftAt(cruiser, cruiser.seenAt + 10_000);
    // route 090 : plein est, donc x croît et y ne bouge pas
    expect(later.x - cruiser.x).toBeCloseTo(cruiser.speed * 10, 0);
    expect(later.y - cruiser.y).toBeCloseTo(0, 0);
    expect(aircraftAt(lander, lander.seenAt + 10_000).altitude).toBeCloseTo(lander.altitude! + lander.verticalRate * 10, 3);
  });

  it('cesse d’extrapoler au-delà de l’horizon : l’appareil a pu virer', () => {
    const horizon = aircraftAt(cruiser, cruiser.seenAt + MAX_EXTRAPOLATION_S * 1000);
    expect(aircraftAt(cruiser, cruiser.seenAt + 600_000)).toEqual(horizon);
    expect(aircraftAt(cruiser, cruiser.seenAt - 5000)).toMatchObject({ x: cruiser.x, y: cruiser.y });
  });
});

describe('avions : recherche d’un vol', () => {
  const list = [cruiser, lander, parked];
  it('cherche par indicatif, immatriculation, type ou adresse du transpondeur', () => {
    expect(searchAircraft(list, 'ryr').map((aircraft) => aircraft.callsign)).toEqual(['RYR70EA']);
    expect(searchAircraft(list, 'oo-jaf')).toHaveLength(1);
    expect(searchAircraft(list, 'a320')[0]).toBe(parked);
    expect(searchAircraft(list, '44a821')[0]).toBe(lander);
    expect(searchAircraft(list, 'b738 jaf')).toEqual([lander]);
    expect(searchAircraft(list, '')).toHaveLength(3);
    expect(searchAircraft(list, 'zzz')).toEqual([]);
  });
});

describe('avions : vue cockpit', () => {
  it('place la caméra exactement sur l’appareil, tournée vers sa route', () => {
    const ground = 150;
    const pose = cockpitPose(cruiser, cruiser.track, ground);
    // la caméra est à `distance` du point visé, à l'opposé du cap de la vue
    const reach = pose.distance * Math.sin(pose.tilt * DEG);
    expect(pose.x - reach * Math.sin(pose.azimuth * DEG)).toBeCloseTo(cruiser.x, 3);
    expect(pose.y - reach * Math.cos(pose.azimuth * DEG)).toBeCloseTo(cruiser.y, 3);
    expect(ground + pose.distance * Math.cos(pose.tilt * DEG)).toBeCloseTo(cruiser.altitude!, 3);
    expect(pose.azimuth).toBe(90);
  });

  it('garde une hauteur minimale au roulage', () => {
    const pose = cockpitPose({ x: parked.x, y: parked.y, altitude: null }, parked.track, 187);
    expect(pose.distance * Math.cos(pose.tilt * DEG)).toBeCloseTo(40, 3);
  });
});

/** Fait tourner la machine sous un parent factice qui consigne ce qu'elle lui annonce. */
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
  return { actor, announced, send: (event: AnyEventObject) => parent.send({ type: 'to.child', event }) };
}

describe('machine des avions en direct', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const start = (visible: boolean, readings: Aircraft[][]) => {
    let calls = 0;
    const run = underParent(aircraftMachine.provide({
      actors: {
        loadAircraft: fromPromise(async () => {
          const reading = readings[Math.min(calls, readings.length - 1)]!;
          calls++;
          return reading;
        }),
      },
    }), { visible });
    const settle = () => vi.advanceTimersByTimeAsync(0);
    return { ...run, calls: () => calls, settle, emitted: (type: string) => run.announced.filter((event) => event.type === type) };
  };

  it('ne relève rien tant que le calque est éteint', async () => {
    const { actor, calls, settle } = start(false, [[cruiser]]);
    await settle();
    expect(aircraftFeed(actor.getSnapshot())).toBe('off');
    expect(calls()).toBe(0);
  });

  it('relève, publie les marqueurs avec leur altitude et leur mouvement, puis recommence', async () => {
    const { actor, calls, settle, emitted } = start(true, [[cruiser, parked]]);
    await settle();
    expect(aircraftFeed(actor.getSnapshot())).toBe('nominal');
    const { features } = emitted('aircraft.changed').at(-1)!;
    expect(features).toHaveLength(2);
    expect(features[0]).toMatchObject({ id: cruiser.id, label: 'RYR70EA', altitude: cruiser.altitude, track: 90 });
    expect(features[0].motion).toMatchObject({ at: cruiser.seenAt, horizon: MAX_EXTRAPOLATION_S });
    expect(features[0].motion.vx).toBeCloseTo(cruiser.speed, 3);
    // un appareil au sol est posé sur le relief : pas d'altitude imposée
    expect(features[1].altitude).toBeUndefined();
    expect(features[1].detail).toBe('au sol');

    await vi.advanceTimersByTimeAsync(AIRCRAFT_POLL_MS);
    expect(calls()).toBe(2);
  });

  it('retient le vol choisi et filtre la liste à la recherche', async () => {
    const { actor, send, settle, emitted } = start(true, [[cruiser, lander, parked]]);
    await settle();
    send({ type: 'aircraft.picked', id: lander.id });
    expect(selectedAircraft(actor.getSnapshot())).toBe(lander);
    expect(emitted('aircraft.selectionChanged').at(-1)).toMatchObject({ aircraft: { callsign: 'JAF3BX' } });

    send({ type: 'aircraft.queryChanged', query: 'ryr' });
    expect(listedAircraft(actor.getSnapshot())).toEqual([cruiser]);
    send({ type: 'aircraft.picked', id: 'inconnu' });
    expect(selectedAircraft(actor.getSnapshot())).toBe(lander);
  });

  it('installe la caméra au poste de pilotage, et lui donne chaque nouvelle position', async () => {
    const moved = { ...cruiser, x: cruiser.x + 2000, seenAt: cruiser.seenAt + 8000 };
    const { actor, send, settle, emitted } = start(true, [[cruiser], [moved]]);
    await settle();
    send({ type: 'aircraft.cockpitRequested' });                       // sans vol choisi : sans effet
    expect(emitted('aircraft.followChanged')).toEqual([]);

    send({ type: 'aircraft.picked', id: cruiser.id });
    send({ type: 'aircraft.cockpitRequested' });
    expect(actor.getSnapshot().context.inCockpit).toBe(true);
    expect(emitted('aircraft.followChanged').at(-1)!.target).toMatchObject({ x: cruiser.x, altitude: cruiser.altitude, track: 90 });

    await vi.advanceTimersByTimeAsync(AIRCRAFT_POLL_MS);
    expect(emitted('aircraft.followChanged').at(-1)!.target).toMatchObject({ x: moved.x, at: moved.seenAt });
    // le relevé ne ré-annonce pas la sélection : le panneau, s'il a été refermé, le reste
    expect(emitted('aircraft.selectionChanged')).toHaveLength(1);

    send({ type: 'aircraft.cockpitLeft' });
    expect(emitted('aircraft.followChanged').at(-1)).toEqual({ type: 'aircraft.followChanged', target: null });
  });

  it('lâche l’appareil qui a quitté le ciel wallon', async () => {
    const { actor, send, settle, emitted } = start(true, [[cruiser, lander], [lander]]);
    await settle();
    send({ type: 'aircraft.picked', id: cruiser.id });
    send({ type: 'aircraft.cockpitRequested' });
    await vi.advanceTimersByTimeAsync(AIRCRAFT_POLL_MS);
    expect(selectedAircraft(actor.getSnapshot())).toBeNull();
    expect(emitted('aircraft.selectionChanged').at(-1)).toEqual({ type: 'aircraft.selectionChanged', aircraft: null });
    expect(emitted('aircraft.followChanged').at(-1)).toEqual({ type: 'aircraft.followChanged', target: null });
  });

  it('garde les dernières positions quand le réseau ne répond plus, et réessaie', async () => {
    let calls = 0;
    const { actor } = underParent(aircraftMachine.provide({
      actors: { loadAircraft: fromPromise(async () => { if (++calls > 1) throw new Error('réseau'); return [cruiser]; }) },
    }), { visible: true });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(AIRCRAFT_POLL_MS);
    expect(aircraftFeed(actor.getSnapshot())).toBe('degraded');
    expect(actor.getSnapshot().context.list).toEqual([cruiser]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(calls).toBe(3);
  });

  it('retire tout quand on éteint le calque', async () => {
    const { actor, send, settle, emitted } = start(true, [[cruiser]]);
    await settle();
    send({ type: 'aircraft.picked', id: cruiser.id });
    send({ type: 'aircraft.toggled' });
    expect(aircraftFeed(actor.getSnapshot())).toBe('off');
    expect(emitted('aircraft.changed').at(-1)).toEqual({ type: 'aircraft.changed', visible: false, features: [] });
    expect(emitted('aircraft.selectionChanged').at(-1)).toEqual({ type: 'aircraft.selectionChanged', aircraft: null });
  });
});

describe('relais des avions', () => {
  const store = new Map<string, Response>();
  const context = { waitUntil: (promise: Promise<unknown>) => { void promise; } };
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

  it('interroge le réseau à une adresse fixe et ne garde la réponse que quelques secondes', async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response('{"ac":[]}', { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await call('/edge/v1/aircraft.json');
    expect(fetchMock.mock.calls[0]![0]).toBe(aircraftFeedUrl());
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=5, s-maxage=5');

    // mille visiteurs dans la même seconde : une seule requête vers le réseau
    await call('/edge/v1/aircraft.json?x=1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuse toute autre adresse : ce n’est pas un proxy ouvert', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect((await call('/edge/v1/aircraft.json/../v2/mil')).status).toBe(404);
    expect((await call('/edge/v1/aircraft/4ca7b5.json')).status).toBe(404);
  });
});

describe('avions : vue partageable', () => {
  it('garde le calque des avions dans le lien', () => {
    const view = { ...DEFAULT_VIEW, overlays: { places: true, cameras: false, aircraft: true, scans: false } };
    expect(encodeView(view)).toContain('o=pa');
    expect(decodeView(encodeView(view)).overlays.aircraft).toBe(true);
  });
});
