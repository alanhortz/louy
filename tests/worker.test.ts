import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index.ts';

const store = new Map<string, Response>();
const context = { waitUntil: (promise: Promise<unknown>) => { void promise; } };
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
