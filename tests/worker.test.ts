import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index.ts';

const store = new Map<string, Response>();
const pending: Promise<unknown>[] = [];
const context = { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } };
/** Attend la fin du travail d'arrière-plan du Worker, y compris ce qu'il enchaîne en s'adressant à lui-même. */
const settle = async () => { while (pending.length > 0) await Promise.all(pending.splice(0)); };
const env = {
  ASSETS: { fetch: vi.fn(async () => new Response('site')) },
  SELF: { fetch: (request: Request) => worker.fetch(request, env, context) },
};

const call = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://louy.be${path}`, init), env, context);

const upstream = (body: BodyInit, contentType: string, status = 200) =>
  vi.fn(async (_url: string) => new Response(body, { status, headers: { 'Content-Type': contentType, 'Cache-Control': 'max-age=0', 'Set-Cookie': 'x=1' } }));

beforeEach(() => {
  store.clear();
  vi.stubGlobal('caches', {
    default: {
      match: async (request: Request) => store.get(request.url)?.clone(),
      put: async (request: Request, response: Response) => { store.set(request.url, response); },
      delete: async (request: Request) => store.delete(request.url),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('relais des tuiles', () => {
  const TILE = '/edge/v1/tiles/RELIEF/WALLONIE_MNT_2021_2022/272/9/250/260.png';

  it('traduit le chemin en requête ArcGIS et rend la tuile immuable', async () => {
    const fetchMock = upstream('png', 'image/png');
    vi.stubGlobal('fetch', fetchMock);

    const response = await call(TILE);
    const requested = new URL(fetchMock.mock.calls[0]![0]);
    expect(requested.hostname).toBe('geoservices.wallonie.be');
    expect(requested.searchParams.get('bbox')).toBe('665736,596569.5,666280,597113.5');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });

  it('sert la deuxième demande depuis le cache, sans rappeler le SPW', async () => {
    const fetchMock = upstream('png', 'image/png');
    vi.stubGlobal('fetch', fetchMock);
    await call(TILE);
    const second = await call(`${TILE}?contournement=1`);
    expect(await second.text()).toBe('png');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sert aussi les tuiles d’époque, quatre fois la grille', async () => {
    const fetchMock = upstream('jpg', 'image/jpeg');
    vi.stubGlobal('fetch', fetchMock);
    expect((await call('/edge/v1/tiles/IMAGERIE/ORTHO_2015/1088/11/1147/1285.jpg')).status).toBe(200);
    expect(new URL(fetchMock.mock.calls[0]![0]).searchParams.get('size')).toBe('1088,1088');
    expect((await call('/edge/v1/tiles/IMAGERIE/ORTHO_2015/2176/11/1147/1285.jpg')).status).toBe(404);
  });

  it('garde une durée de vie courte pour l’orthophoto « la plus récente »', async () => {
    vi.stubGlobal('fetch', upstream('jpg', 'image/jpeg'));
    const response = await call('/edge/v1/tiles/IMAGERIE/ORTHO_LAST/544/11/1000/1000.jpg');
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=604800');
  });

  it('ne met pas en cache une erreur ArcGIS déguisée en succès', async () => {
    vi.stubGlobal('fetch', upstream('{"error":{}}', 'application/json'));
    const response = await call(TILE);
    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(store.size).toBe(0);
  });

  it.each([
    '/edge/v1/tiles/RELIEF/LIDAR_MAILLES/272/1/0/0.png',
    '/edge/v1/tiles/RELIEF/WALLONIE_MNT_2021_2022/999/1/0/0.png',
    '/edge/v1/tiles/RELIEF/WALLONIE_MNT_2021_2022/272/12/0/0.png',
    '/edge/v1/tiles/RELIEF/WALLONIE_MNT_2021_2022/272/2/4/0.png',
    '/edge/v1/autre',
  ])('refuse %s', async (path) => {
    const fetchMock = upstream('png', 'image/png');
    vi.stubGlobal('fetch', fetchMock);
    expect((await call(path)).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuse les méthodes autres que la lecture', async () => {
    expect((await call(TILE, { method: 'POST' })).status).toBe(405);
  });
});

describe('autres routes', () => {
  it('relaie les dates de vol d’une maille wallonne', async () => {
    const fetchMock = upstream('{"features":[]}', 'application/json;charset=UTF-8');
    vi.stubGlobal('fetch', fetchMock);
    expect((await call('/edge/v1/flights/1370/1255.json')).status).toBe(200);
    expect(fetchMock.mock.calls[0]![0]).toContain('LIDAR_MAILLES');
    expect((await call('/edge/v1/flights/1/1.json')).status).toBe(404);
  });

  it('laisse le site statique à Cloudflare', async () => {
    expect(await (await call('/index.html')).text()).toBe('site');
  });
});

describe('préchauffage du film du temps', () => {
  const ORTHO = '/edge/v1/tiles/IMAGERIE/ORTHO_1971/544/11/1000/1000.jpg';

  it('prépare la même tuile aux autres millésimes quand le film la demande', async () => {
    const fetchMock = upstream('jpg', 'image/jpeg');
    vi.stubGlobal('fetch', fetchMock);
    await call(`${ORTHO}?film`);
    await settle();
    // 19 millésimes datés : celui demandé, et les 18 autres
    expect(fetchMock).toHaveBeenCalledTimes(19);
    expect(store.has('https://louy.be/edge/v1/tiles/IMAGERIE/ORTHO_2024/544/11/1000/1000.jpg')).toBe(true);
    expect(store.has('https://louy.be/edge/v1/tiles/IMAGERIE/ORTHO_LAST/544/11/1000/1000.jpg')).toBe(false);

    // le millésime suivant est servi sans rappeler le SPW, et ne relance rien
    await call('/edge/v1/tiles/IMAGERIE/ORTHO_2024/544/11/1000/1000.jpg?film');
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(19);
  });

  it('ne prépare rien hors du film, ni pour le relief', async () => {
    const fetchMock = upstream('jpg', 'image/jpeg');
    vi.stubGlobal('fetch', fetchMock);
    await call(ORTHO);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.stubGlobal('fetch', upstream('png', 'image/png'));
    await call('/edge/v1/tiles/RELIEF/WALLONIE_MNT_2021_2022/272/9/250/260.png?film');
    await settle();
    expect(store.size).toBe(2);
  });

  it('ne range jamais une erreur du SPW parmi les tuiles préparées', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (calls++ === 0
      ? new Response('jpg', { headers: { 'Content-Type': 'image/jpeg' } })
      : new Response('{"error":{}}', { headers: { 'Content-Type': 'application/json' } }))));
    await call(`${ORTHO}?film`);
    await settle();
    expect(store.size).toBe(1);
  });
});

describe('altitudes exactes', () => {
  const CELL = '/edge/v1/altitudes/MNT/42800/39252.json';
  const answer = (count: number) => JSON.stringify({ results: Array.from({ length: count }, (_, k) => ({ attributes: { 'Stretch.Pixel Value': k === 0 ? 'NoData' : String(80 + k / 1000) } })) });

  it('demande tout le carré au SPW en une fois, et ne garde que les altitudes en centimètres', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(answer(1024), { headers: { 'Content-Type': 'application/json;charset=UTF-8' } }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await call(CELL);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(url).pathname).toBe('/arcgis/rest/services/RELIEF/WALLONIE_MNT_2021_2022/MapServer/identify');
    expect(init?.method).toBe('POST');
    const geometry = JSON.parse(new URLSearchParams(String(init?.body)).get('geometry')!);
    expect(geometry.points).toHaveLength(1024);
    expect(geometry.points[0]).toEqual([42800 * 16 + 0.25, 39252 * 16 + 0.25]);
    const values = await response.json() as (number | null)[];
    expect(values).toHaveLength(1024);
    expect(values[0]).toBeNull();
    expect(values[1]).toBe(8000);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('ne garde pas une réponse partielle', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(answer(1000), { headers: { 'Content-Type': 'application/json' } })));
    expect((await call(CELL)).status).toBe(502);
    await settle();
    expect(store.size).toBe(0);
  });

  it('refuse un carré hors de Wallonie ou une autre campagne', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect((await call('/edge/v1/altitudes/MNT/10000/10000.json')).status).toBe(404);
    expect((await call('/edge/v1/altitudes/MNT_2013_2014/42800/39252.json')).status).toBe(404);
  });
});

describe('relief exact d’une tuile', () => {
  const TILE = '/edge/v1/relief/MNT/11/1153/1282.bin';
  const COUNT = 272 * 272;
  const STAGE = 17 * 272;
  const json = (body: string) => new Response(body, { headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
  /** Une réponse du SPW : `count` points, le deuxième sans donnée. */
  const answer = (count: number) =>
    `{"results":[${Array.from({ length: count }, (_, k) => `{"layerId":0,"attributes":{"Stretch.Pixel Value":"${k === 1 ? 'NoData' : (100 + k * 0.01).toFixed(6)}"}}`).join(',')}]}`;
  const stageOf = (init?: RequestInit) => Number(new URLSearchParams(String(init?.body)).get('geometry') && JSON.parse(new URLSearchParams(String(init?.body)).get('geometry')!).points.length);

  it('répond « en préparation », demande la tuile au SPW en seize étapes enchaînées, puis la sert du cache sans fin', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json(answer(STAGE)));
    vi.stubGlobal('fetch', fetchMock);
    const first = await call(TILE);
    expect(first.status).toBe(202);
    expect(first.headers.get('Retry-After')).toBe('15');
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(16);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(url).pathname).toBe('/arcgis/rest/services/RELIEF/WALLONIE_MNT_2021_2022/MapServer/identify');
    expect(stageOf(init)).toBe(STAGE);
    expect(new URLSearchParams(String(init?.body)).get('returnGeometry')).toBe('false');

    const second = await call(TILE);
    expect(second.status).toBe(200);
    expect(second.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    const values = new Uint16Array(await second.arrayBuffer());
    expect(values).toHaveLength(COUNT);
    expect(values[0]).toBe(15000);
    expect(values[1]).toBe(0);
    expect(values[2]).toBe(15001);
    expect(values[STAGE]).toBe(15000);
    expect(values[COUNT - 1]).toBe(15000 + Math.round((STAGE - 1) * 0.01 / 0.02));
    expect(fetchMock).toHaveBeenCalledTimes(16);
  });

  it('ne prépare jamais la même tuile deux fois en même temps', async () => {
    const fetchMock = vi.fn(async () => json(answer(STAGE)));
    vi.stubGlobal('fetch', fetchMock);
    expect((await call(TILE)).status).toBe(202);
    expect((await call(TILE)).status).toBe(202);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(16);
  });

  it('au bord de la couverture, redemande chaque point de l’étape avec sa position', async () => {
    const { paddedExtent } = await import('../src/domain/tiling.ts');
    const { xmin, ymax } = paddedExtent({ level: 11, i: 1153, j: 1282 });
    const placed = JSON.stringify({ results: [
      { geometry: { x: xmin + 0.25, y: ymax - 0.25 }, attributes: { 'Stretch.Pixel Value': '100' } },
      { geometry: { x: xmin + 0.75, y: ymax - 0.25 }, attributes: { 'Stretch.Pixel Value': '101' } },
    ] });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      json(String(init?.body).includes('returnGeometry=true') ? placed : answer(STAGE - 1)));
    vi.stubGlobal('fetch', fetchMock);
    await call(TILE);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(32);
    const values = new Uint16Array(await (await call(TILE)).arrayBuffer());
    expect(values[0]).toBe(15000);
    expect(values[1]).toBe(15050);
    expect(values[2]).toBe(0);
    // les deux points sont dans la première étape : les autres restent sans donnée
    expect(values[STAGE]).toBe(0);
  });

  it('ne garde rien quand le SPW ne répond pas, et laisse reprendre la préparation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('indisponible', { status: 503 })));
    expect((await call(TILE)).status).toBe(202);
    await settle();
    // ni étape, ni tuile : la voie et le marqueur sont rendus, la tuile pourra repartir aussitôt
    expect([...store.keys()].filter((key) => key.includes('/relief/'))).toEqual([]);
    expect((await call(TILE)).status).toBe(202);
    await settle();
    expect([...store.keys()].filter((key) => key.includes('/relief/'))).toEqual([]);
  });

  it('reprend une préparation là où elle s’était arrêtée', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++calls <= 3 ? json(answer(STAGE)) : new Response('indisponible', { status: 503 }))));
    await call(TILE);
    await settle();
    expect(calls).toBe(4);   // trois étapes faites, la quatrième refusée : la chaîne s'arrête
    // plus tard, le SPW répond de nouveau : les trois étapes faites ne lui sont pas redemandées
    vi.stubGlobal('fetch', vi.fn(async () => json(answer(STAGE))));
    await call(TILE);
    await settle();
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(13);
    expect((await call(TILE)).status).toBe(200);
  });

  it('ne prépare que quatre tuiles à la fois ; les autres attendent d’être redemandées', async () => {
    const fetchMock = vi.fn(async () => json(answer(STAGE)));
    vi.stubGlobal('fetch', fetchMock);
    const tiles = [1282, 1283, 1284, 1285, 1286].map((j) => `/edge/v1/relief/MNT/11/1153/${j}.bin`);
    // cinq tuiles demandées d'un coup : la cinquième ne trouve pas de voie, rien ne part pour elle
    for (const tile of tiles) expect((await call(tile)).status).toBe(202);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(4 * 16);
    expect((await call(tiles[3]!)).status).toBe(200);
    // ses quatre aînées assemblées, les voies sont libres : redemandée, la cinquième part
    expect((await call(tiles[4]!)).status).toBe(202);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(5 * 16);
    expect((await call(tiles[4]!)).status).toBe(200);
  });

  it('refuse une tuile inexistante, un autre modèle ou une étape inconnue', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect((await call('/edge/v1/relief/MNT/12/576/641.bin')).status).toBe(404);
    expect((await call('/edge/v1/relief/MNT/11/0/0.bin')).status).toBe(404);
    expect((await call('/edge/v1/relief/MNP/11/1153/1282.bin')).status).toBe(404);
    expect((await call(`${TILE}?etape=16&voie=0`)).status).toBe(404);
    expect((await call(`${TILE}?etape=0&voie=4`)).status).toBe(404);
  });
});
