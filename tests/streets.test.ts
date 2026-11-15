import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor, createMachine, fromPromise, sendTo, waitFor, type AnyEventObject } from 'xstate';
import { MAX_RECENT_SEARCHES, matchRecentSearches, parseRecentSearches, recentKey, rememberSearch, type RecentSearch } from '../src/domain/recentSearches.ts';
import {
  STREET_CELL, STREET_MAX_DISTANCE, buildStreetCell, parseStreetCell, parseStreetSearch, streetCellAt, streetCellUrl,
  streetCellsAround, streetEdgePath, streetQuery, streetSearchEdgePath, streetSearchQuery, streetSearchUrl,
  type Street, type StreetLabel,
} from '../src/domain/streets.ts';
import { recentsMachine } from '../src/machines/recents.machine.ts';
import { streetSearchMachine, streetSearchStage } from '../src/machines/streetSearch.machine.ts';
import { streetsCount, streetsFeed, streetsMachine, streetsOutOfRange } from '../src/machines/streets.machine.ts';
import worker from '../worker/index.ts';

/** La dalle de 2 km du centre de Namur. */
const CELL = { cx: 342, cy: 314 };
const X0 = CELL.cx * STREET_CELL, Y0 = CELL.cy * STREET_CELL;
/** Tracé d'une rue droite, d'ouest en est. */
const FLAT = '-250,0 -200,0 -150,0 -100,0 -50,0 0,0 50,0 100,0 150,0 200,0 250,0';
const feature = (name: string, ...paths: number[][][]) => ({ attributes: { RUE_NM: name }, geometry: { paths } });

describe('saisie d’une recherche de rue', () => {
  it('ramène des saisies équivalentes à la même forme', () => {
    expect(streetQuery('  Rue des   BRASSEURS, Namur ')).toBe('rue des brasseurs namur');
    expect(streetQuery('Rue Hors-Château')).toBe('rue hors-château');
    expect(streetQuery("Rue de l'Ange")).toBe("rue de l'ange");
    expect(streetQuery('ru')).toBeNull();
    expect(streetQuery('<<>>')).toBeNull();
    expect(streetQuery('a'.repeat(200))).toHaveLength(60);
  });

  it('n’accepte dans le chemin du relais qu’une saisie sous sa forme canonique', () => {
    expect(streetSearchQuery(streetSearchEdgePath('rue hors-château liège'))).toBe('rue hors-château liège');
    expect(streetSearchQuery('/streets/search/Rue%20Haute.json')).toBeNull();
    expect(streetSearchQuery('/streets/search/rue%20%20haute.json')).toBeNull();
    expect(streetSearchQuery('/streets/search/%E0%A4%A.json')).toBeNull();
    expect(streetSearchQuery('/streets/search/a/b.json')).toBeNull();
  });

  it('interroge le géocodeur au niveau des rues, dans le repère du site', () => {
    const url = new URL(streetSearchUrl('rue des brasseurs namur'));
    expect(url.origin + url.pathname).toBe('https://geoservices.wallonie.be/geocodeWS/searchAll');
    expect(Object.fromEntries(url.searchParams)).toEqual({ address: 'rue des brasseurs namur', levels: '3', bbox: 'true', crs: 'EPSG:3812' });
  });

  it('lit les rues candidates : nom, localité, et le milieu de leur emprise', () => {
    const tag = (ident: string, level: number, name: string, bbox?: number[]) => ({ score: 0.03, geotag: { ident, level, name, lang: 'fr', bbox } });
    const streets = parseStreetSearch({ candidates: [
      tag('7753938', 3, 'Rue des Brasseurs 5000 Namur', [684960.4, 628028.5, 685432, 628082.7]),
      tag('7736983', 3, 'Route du Ru des Bras 4960 Malmedy', [760000, 620000, 761000, 621000]),
      tag('7736983', 3, 'Route du Ru des Bras 4960 Bellevaux', [760000, 620000, 761000, 621000]),
      tag('7736983', 3, 'Route du Ru des Bras 4960 Bellevaux', [760000, 620000, 761000, 621000]),
      tag('542336', 4, '1 Rue du Bras de Fer 7971 Thumaide', [1, 2, 3, 4]),
      tag('1', 3, 'Sans code postal'),
    ] });
    expect(streets).toEqual([
      { id: '7753938|Namur', name: 'Rue des Brasseurs', near: '5000 Namur', x: 685196, y: 628056 },
      { id: '7736983|Malmedy', name: 'Route du Ru des Bras', near: '4960 Malmedy', x: 760500, y: 620500 },
      { id: '7736983|Bellevaux', name: 'Route du Ru des Bras', near: '4960 Bellevaux', x: 760500, y: 620500 },
    ]);
    expect(parseStreetSearch({ message: 'erreur' })).toEqual([]);
    expect(parseStreetSearch(null)).toEqual([]);
  });
});

describe('dalles de noms de rues', () => {
  it('découpe la Wallonie en dalles de 2 km et en demande neuf autour de la vue', () => {
    expect(streetCellAt(685070, 627918)).toEqual({ cx: 342, cy: 313 });
    const cells = streetCellsAround(685070, 627918);
    expect(cells).toHaveLength(9);
    expect(cells[4]).toEqual({ cx: 342, cy: 313 });
    expect(streetEdgePath(CELL)).toBe('/streets/342/314.tsv');
  });

  it('demande à ICAR les rues en vigueur de la dalle, tracé au mètre', () => {
    const params = new URL(streetCellUrl(CELL)).searchParams;
    expect(params.get('geometry')).toBe('684000,628000,686000,630000');
    expect(params.get('where')).toBe("RUE_VALIDE='O'");
    expect([params.get('inSR'), params.get('outSR'), params.get('outFields'), params.get('geometryPrecision')]).toEqual(['3812', '3812', 'RUE_NM', '0']);
  });

  it('réduit la réponse à une ligne par rue, posée sur son tracé, classée par sa longueur', () => {
    const tsv = buildStreetCell({ features: [
      // une longue chaussée qui traverse la dalle d'ouest en est : grand axe
      feature('Chaussée de Louvain', [[X0 - 500, Y0 + 1000], [X0 + 500, Y0 + 1000], [X0 + 1500, Y0 + 1000], [X0 + 2500, Y0 + 1000]]),
      // une rue en deux tronçons : une seule étiquette
      feature('Rue de Fer', [[X0 + 100, Y0 + 100], [X0 + 200, Y0 + 100]]),
      feature('Rue de  Fer ', [[X0 + 200, Y0 + 100], [X0 + 300, Y0 + 100]]),
      // une rue qui touche l'emprise mais dont le tracé est dans la dalle voisine
      feature('Rue Voisine', [[X0 - 300, Y0 + 50], [X0 - 100, Y0 + 50]]),
      feature('', [[X0 + 10, Y0 + 10], [X0 + 20, Y0 + 10]]),
    ] }, CELL)!;
    expect(tsv.trim().split('\n')).toEqual([
      `Chaussée de Louvain\t${X0 + 950}\t${Y0 + 1000}\t3\t${FLAT}`,
      `Rue de Fer\t${X0 + 150}\t${Y0 + 100}\t0\t${FLAT}`,
    ]);
  });

  it('garde, autour de l’étiquette, le tracé que le nom devra suivre', () => {
    // une rue en équerre : 300 m vers l'est, puis 300 m vers le nord
    const tsv = buildStreetCell({ features: [feature('Rue du Coude', [[X0 + 400, Y0 + 400], [X0 + 700, Y0 + 400], [X0 + 700, Y0 + 700]])] }, CELL)!;
    const [name, x, y, rank, curve] = tsv.trim().split('\t');
    expect([name, x, y, rank]).toEqual(['Rue du Coude', String(X0 + 650), String(Y0 + 400), '2']);
    const points = curve!.split(' ').map((pair) => pair.split(',').map(Number));
    expect(points).toHaveLength(11);
    // le tracé passe par l'étiquette, tourne au coin, et se prolonge tout droit au-delà de ses deux bouts
    expect(points[5]).toEqual([0, 0]);
    expect(points[6]).toEqual([50, 0]);
    expect(points[7]).toEqual([50, 50]);
    expect(points[10]).toEqual([50, 200]);
    expect(points[0]).toEqual([-250, 0]);
    expect(buildStreetCell({ features: [] }, CELL)).toBe('');
    // ArcGIS signale ses erreurs avec un statut 200 : ce n'est pas une dalle
    expect(buildStreetCell({ error: { code: 400 } }, CELL)).toBeNull();
  });

  it('relit la dalle servie en étiquettes', () => {
    const labels = parseStreetCell(`Rue de Fer\t684150\t628100\t0\t-50,0 0,0 50,10\nChaussée de Louvain\t685000\t629000\t2\n\nabîmée\tx\ty\n`, CELL);
    expect(labels).toEqual([
      { id: '342_314:Rue de Fer', label: 'Rue de Fer', x: 684150, y: 628100, rank: 0, curve: [-50, 0, 0, 0, 50, 10], maxDistance: STREET_MAX_DISTANCE },
      { id: '342_314:Chaussée de Louvain', label: 'Chaussée de Louvain', x: 685000, y: 629000, rank: 2, curve: [-250, 0, 250, 0], maxDistance: STREET_MAX_DISTANCE },
    ]);
  });
});

/** Un parent qui relaie les événements à la machine testée et note ses annonces. */
function host(id: string, src: unknown, input?: unknown) {
  const announced: AnyEventObject[] = [];
  const parent = createActor(createMachine({
    invoke: { id, src, input } as never,
    on: {
      'to.child': { actions: sendTo(id, ({ event }) => (event as AnyEventObject).event) },
      '*': { actions: ({ event }: { event: AnyEventObject }) => { announced.push(event); } },
    },
  } as never)).start();
  return { announced, actor: parent.getSnapshot().children[id]!, send: (event: AnyEventObject) => parent.send({ type: 'to.child', event }) };
}

describe('machine de recherche de rues', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  const brasseurs: Street = { id: '7753938|Namur', name: 'Rue des Brasseurs', near: '5000 Namur', x: 685196, y: 628056 };
  function searching(answer: (query: string) => Promise<Street[]> = async () => [brasseurs]) {
    const search = vi.fn(({ input }: { input: string }) => answer(input));
    return { search, ...host('streetSearch', streetSearchMachine.provide({ actors: { search: fromPromise(search) } })) };
  }
  const stage = (actor: { getSnapshot(): unknown }) => streetSearchStage(actor.getSnapshot() as never);

  it('attend la fin de la frappe, puis ne lance qu’une recherche', async () => {
    const { actor, send, search } = searching();
    send({ type: 'streetSearch.opened' });
    for (const query of ['rue', 'rue des', 'rue des bras']) {
      send({ type: 'streetSearch.queryChanged', query });
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(search).not.toHaveBeenCalled();
    expect(stage(actor)).toBe('loading');
    await vi.advanceTimersByTimeAsync(300);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]![0].input).toBe('rue des bras');
    expect(stage(actor)).toBe('idle');
    expect((actor.getSnapshot() as { context: { results: Street[] } }).context.results).toEqual([brasseurs]);
  });

  it('ne demande rien pour une saisie trop courte, et vide alors la liste', async () => {
    const { actor, send, search } = searching();
    send({ type: 'streetSearch.opened' });
    send({ type: 'streetSearch.queryChanged', query: 'rue des bras' });
    await vi.advanceTimersByTimeAsync(400);
    send({ type: 'streetSearch.queryChanged', query: 'ru' });
    await vi.advanceTimersByTimeAsync(400);
    expect(search).toHaveBeenCalledTimes(1);
    expect((actor.getSnapshot() as { context: { results: Street[] } }).context.results).toEqual([]);
  });

  it('annonce la rue choisie et se referme', async () => {
    const { actor, send, announced } = searching();
    send({ type: 'streetSearch.opened' });
    send({ type: 'streetSearch.queryChanged', query: 'brasseurs' });
    await vi.advanceTimersByTimeAsync(400);
    send({ type: 'streetSearch.picked', id: 'inconnue' });
    expect(stage(actor)).toBe('idle');
    send({ type: 'streetSearch.picked', id: brasseurs.id });
    expect(announced.at(-1)).toEqual({ type: 'streetSearch.chosen', street: brasseurs });
    expect(stage(actor)).toBe('closed');
    expect((actor.getSnapshot() as { context: { query: string } }).context.query).toBe('');
  });

  it('signale un géocodeur muet, et repart à la saisie suivante', async () => {
    let fail = true;
    const { actor, send } = searching(async () => { if (fail) throw new Error('502'); return [brasseurs]; });
    send({ type: 'streetSearch.opened' });
    send({ type: 'streetSearch.queryChanged', query: 'brasseurs' });
    await vi.advanceTimersByTimeAsync(400);
    expect(stage(actor)).toBe('failed');
    fail = false;
    send({ type: 'streetSearch.queryChanged', query: 'brasseurs n' });
    await vi.advanceTimersByTimeAsync(400);
    expect(stage(actor)).toBe('idle');
  });
});

describe('machine du calque des noms de rues', () => {
  const label = (key: string): StreetLabel => ({ id: `${key}:Rue`, label: 'Rue', x: 0, y: 0, rank: 0, curve: [-250, 0, 250, 0], maxDistance: STREET_MAX_DISTANCE });
  function layer(visible: boolean, distance = 900) {
    const load = vi.fn(async ({ input }: { input: { cx: number; cy: number }[] }) =>
      input.map((cell) => [`${cell.cx}_${cell.cy}`, [label(`${cell.cx}_${cell.cy}`)]] as [string, StreetLabel[]]));
    const machine = streetsMachine.provide({ actors: { loadCells: fromPromise(load) } });
    return { load, ...host('streets', machine, { visible, focus: { x: 685070, y: 627918, distance } }) };
  }
  const snap = (actor: { getSnapshot(): unknown }) => actor.getSnapshot() as never;

  it('éteint, ne charge rien ; allumé de près, charge les neuf dalles et publie leurs noms', async () => {
    const { actor, send, load, announced } = layer(false);
    expect(streetsFeed(snap(actor))).toBe('off');
    expect(load).not.toHaveBeenCalled();
    send({ type: 'streets.toggled' });
    await waitFor(actor, (snapshot) => snapshot.matches({ visible: 'shown' }));
    expect(load.mock.calls[0]![0].input).toHaveLength(9);
    expect(announced.at(-1)).toMatchObject({ type: 'streets.changed', visible: true });
    expect(announced.at(-1)!.features).toHaveLength(9);
    expect(streetsCount(snap(actor))).toBe(9);
  });

  it('ne recharge que les dalles nouvelles quand la vue glisse', async () => {
    const { actor, send, load } = layer(true);
    await waitFor(actor, (snapshot) => snapshot.matches({ visible: 'shown' }));
    send({ type: 'streets.viewChanged', x: 685070 + STREET_CELL, y: 627918, distance: 900 });
    await waitFor(actor, (snapshot) => snapshot.matches({ visible: 'shown' }));
    expect(load.mock.calls[1]![0].input).toHaveLength(3);
  });

  it('se tait de loin, sans s’éteindre', async () => {
    const { actor, send, load, announced } = layer(true, 12000);
    expect(streetsOutOfRange(snap(actor))).toBe(true);
    expect(load).not.toHaveBeenCalled();
    expect(announced.at(-1)).toEqual({ type: 'streets.changed', visible: true, features: [] });
    send({ type: 'streets.toggled' });
    expect(announced.at(-1)).toEqual({ type: 'streets.changed', visible: false, features: [] });
  });
});

describe('relais des rues', () => {
  const store = new Map<string, Response>();
  const pending: Promise<unknown>[] = [];
  const context = { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } };
  const env = { ASSETS: { fetch: vi.fn(async () => new Response('site')) } };
  const call = (path: string) => worker.fetch(new Request(`https://louy.be${path}`), env, context);
  const spw = (body: unknown, status = 200) =>
    vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json;charset=UTF-8' } }));

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

  it('sert une dalle réduite à ses noms, et ne la redemande pas au SPW', async () => {
    const fetchMock = spw({ features: [feature('Rue de Fer', [[X0 + 100, Y0 + 100], [X0 + 200, Y0 + 100]])] });
    vi.stubGlobal('fetch', fetchMock);
    const response = await call('/edge/v1/streets/342/314.tsv');
    expect(new URL(fetchMock.mock.calls[0]![0]).pathname).toContain('/ICAR_ADR_PT/MapServer/4/query');
    expect(response.headers.get('Content-Type')).toBe('text/tab-separated-values; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=2592000');
    expect(await response.text()).toBe(`Rue de Fer\t${X0 + 150}\t${Y0 + 100}\t0\t${FLAT}\n`);
    await Promise.all(pending.splice(0));
    await call('/edge/v1/streets/342/314.tsv');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ne garde pas une erreur du SPW, et refuse une dalle hors de Wallonie', async () => {
    const fetchMock = spw({ error: { code: 400, message: 'Invalid' } });
    vi.stubGlobal('fetch', fetchMock);
    expect((await call('/edge/v1/streets/342/314.tsv')).status).toBe(502);
    expect(store.size).toBe(0);
    expect((await call('/edge/v1/streets/10/10.tsv')).status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('relaie une recherche sous sa forme canonique, et la garde une semaine', async () => {
    const fetchMock = spw({ candidates: [] });
    vi.stubGlobal('fetch', fetchMock);
    const response = await call(`/edge/v1${streetSearchEdgePath('rue hors-château liège')}`);
    expect(new URL(fetchMock.mock.calls[0]![0]).searchParams.get('address')).toBe('rue hors-château liège');
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=604800');
    expect((await call('/edge/v1/streets/search/RUE%20HAUTE.json')).status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('recherches récentes', () => {
  const entry = (kind: 'site' | 'street', id: string, name = id, meta = 'Namur'): RecentSearch => ({ kind, id, name, meta, x: 685000, y: 628000 });

  it('place le dernier choix en tête, sans le répéter, et n’en garde que huit', () => {
    let list: RecentSearch[] = [];
    for (let k = 0; k < 10; k++) list = rememberSearch(list, entry('street', `rue-${k}`));
    expect(list).toHaveLength(MAX_RECENT_SEARCHES);
    expect(list[0]!.id).toBe('rue-9');
    list = rememberSearch(list, entry('street', 'rue-5'));
    expect(list.map((item) => item.id).slice(0, 2)).toEqual(['rue-5', 'rue-9']);
    expect(list).toHaveLength(MAX_RECENT_SEARCHES);
    // un site et une rue de même identifiant sont deux choix
    expect(rememberSearch([entry('site', 'a')], entry('street', 'a'))).toHaveLength(2);
  });

  it('écarte ce qui est abîmé dans la liste gardée par le navigateur', () => {
    expect(parseRecentSearches([entry('site', 'citadelle'), { kind: 'avion', id: 'x' }, { kind: 'street', id: 'r', name: 'R', meta: 'M', x: 'a', y: 1 }, null, entry('site', 'citadelle')]))
      .toEqual([entry('site', 'citadelle')]);
    expect(parseRecentSearches('rien')).toEqual([]);
  });

  it('répond à une saisie mot par mot, sans tenir compte des accents', () => {
    const list = [entry('street', '1', 'Rue Hors-Château', '4000 Liège'), entry('site', '2', 'Citadelle de Namur', 'Château · Namur')];
    expect(matchRecentSearches(list, '')).toHaveLength(2);
    expect(matchRecentSearches(list, 'chateau').map((item) => item.id)).toEqual(['1', '2']);
    expect(matchRecentSearches(list, 'liege hors').map((item) => item.id)).toEqual(['1']);
    expect(matchRecentSearches(list, 'dinant')).toEqual([]);
  });

  it('retient un choix, le rend en tête quand on le reprend, et s’efface sur demande', () => {
    const persist = vi.fn();
    const { actor, send, announced } = host('recents', recentsMachine.provide({ actions: { persist } }), { list: [entry('site', 'citadelle')] });
    const list = () => (actor.getSnapshot() as { context: { list: RecentSearch[] } }).context.list.map(recentKey);
    send({ type: 'recents.added', entry: entry('street', 'fer') });
    expect(list()).toEqual(['street:fer', 'site:citadelle']);
    send({ type: 'recents.picked', key: 'site:citadelle' });
    expect(list()).toEqual(['site:citadelle', 'street:fer']);
    expect(announced.at(-1)).toEqual({ type: 'recents.chosen', entry: entry('site', 'citadelle') });
    send({ type: 'recents.picked', key: 'site:inconnu' });
    expect(announced).toHaveLength(1);
    send({ type: 'recents.cleared' });
    expect(list()).toEqual([]);
    expect(persist).toHaveBeenCalledTimes(3);
  });
});
