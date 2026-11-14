import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index.ts';

const store = new Map<string, Response>();
const pending: Promise<unknown>[] = [];
const context = { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } };
/** Attend la fin du travail d'arrière-plan du Worker. */
const settle = async () => { await Promise.all(pending.splice(0)); };
const env = { ASSETS: { fetch: vi.fn(async () => new Response('site')) } };

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
