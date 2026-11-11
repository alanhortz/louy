import 'fake-indexeddb/auto';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { identifyBrowser } from '../src/services/capabilities.ts';
import { nearestCamera, type RoadCamera } from '../src/services/cameras.ts';
import { fold, searchSites, type SiteIndexEntry, type TouristSite } from '../src/services/sites.ts';
import {
  RETENTION_MS, SESSION_ID, TelemetryBuffer, clear, exportArchive, persist, prune, readAll, sanitize, summarize,
} from '../src/services/telemetry.ts';

describe('identification du navigateur', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 Version/15.6 Mobile/15E148 Safari/604.1', 'ios', '15.6'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 CriOS/124.0 Mobile/15E148 Safari/604.1', 'ios', '17.4'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36', 'samsung', '25.0'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36', 'chrome', '126'],
    ['Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0', 'firefox', '127'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0', 'edge', '125'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15', 'safari', '17.4'],
  ])('%s', (agent, id, version) => {
    expect(identifyBrowser(agent)).toMatchObject({ id, version });
  });

  it('reconnaît un iPad qui se présente comme un Mac', () => {
    const agent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/16.1 Safari/605.1.15';
    expect(identifyBrowser(agent, 5)).toMatchObject({ id: 'ios', version: '16.1' });
  });

  it('n’invente rien pour un navigateur inconnu', () => {
    expect(identifyBrowser('Lynx/2.9')).toMatchObject({ id: 'unknown', version: null });
  });
});

describe('recherche de sites', () => {
  const site = (name: string, kind: string, near: string, notable = false): TouristSite =>
    ({ id: name, name, kind, near, x: 0, y: 0, notable });
  const index: SiteIndexEntry[] = [
    site('Citadelle de Dinant', 'Château', 'Dinant', true),
    site('Château de Walzin', 'Château', 'Dréhance', true),
    site('Musée de la Leffe', 'Musée', 'Dinant'),
    site('Château de Vêves', 'Château', 'Celles', true),
  ].map((entry) => ({ site: entry, name: fold(entry.name), haystack: fold(`${entry.name} ${entry.kind} ${entry.near}`) }));

  it('ignore accents et majuscules', () => {
    expect(searchSites(index, 'CHATEAU veves').map((found) => found.name)).toEqual(['Château de Vêves']);
  });

  it('cherche aussi par localité et par catégorie', () => {
    expect(searchSites(index, 'dinant').map((found) => found.name))
      .toEqual(['Citadelle de Dinant', 'Musée de la Leffe']);
    expect(searchSites(index, 'musée')).toHaveLength(1);
  });

  it('place en tête le nom qui commence par la saisie', () => {
    expect(searchSites(index, 'château')[0]!.name).toBe('Château de Vêves');
  });

  it('propose les sites notoires quand rien n’est saisi', () => {
    expect(searchSites(index, '').at(-1)!.name).toBe('Musée de la Leffe');
  });
});

describe('caméras', () => {
  it('trouve la plus proche du point visé', () => {
    const cameras = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 100, y: 100 }] as RoadCamera[];
    expect(nearestCamera(cameras, 90, 80)?.id).toBe('b');
    expect(nearestCamera([], 0, 0)).toBeNull();
  });
});

describe('télémétrie locale', () => {
  beforeEach(() => clear());

  it('borne et assainit les charges utiles', () => {
    expect(sanitize({
      canvas: { nodeName: 'CANVAS' },
      features: Array.from({ length: 500 }, (_, k) => k),
      callback: () => 1,
      error: new TypeError('raté'),
      text: 'x'.repeat(1000),
      deep: { a: { b: { c: { d: { e: 1 } } } } },
    })).toEqual({
      canvas: { nodeName: 'CANVAS' },
      features: { items: 500 },
      error: { error: 'TypeError', message: 'raté' },
      text: `${'x'.repeat(240)}…`,
      deep: { a: { b: { c: '…' } } },
    });
  });

  it('compresse, relit et résume un lot', async () => {
    const buffer = new TelemetryBuffer();
    for (let k = 0; k < 200; k++) buffer.push({ k: 'event', a: 'scene', n: 'scene.tintSelected', d: { tint: 'slope' } });
    const records = buffer.drain();
    expect(buffer.size).toBe(0);

    await persist(records);
    const summary = await summarize();
    expect(summary).toMatchObject({ batches: 1, events: 200 });
    // 200 lignes quasi identiques : la compression doit être massive
    expect(summary.bytes).toBeLessThan(JSON.stringify(records).length / 10);

    const restored = await readAll();
    expect(restored).toHaveLength(200);
    expect(restored[0]).toMatchObject({ s: SESSION_ID, a: 'scene', n: 'scene.tintSelected', d: { tint: 'slope' } });
  });

  it('exporte une archive gzip valide de plusieurs lots', async () => {
    const buffer = new TelemetryBuffer();
    buffer.push({ k: 'state', a: 'app', n: 'running' });
    await persist(buffer.drain());
    buffer.push({ k: 'state', a: 'viewer', n: 'detached' });
    await persist(buffer.drain());

    // L'archive concatène un membre gzip par lot. On la relit comme le fera son
    // destinataire, avec gunzip : `DecompressionStream`, lui, refuse par
    // spécification tout ce qui suit le premier membre.
    const archive = Buffer.from(await (await exportArchive()).arrayBuffer());
    const lines = gunzipSync(archive).toString('utf8').trim().split('\n');
    expect(lines.map((line) => JSON.parse(line).a)).toEqual(['app', 'viewer']);
  });

  it('purge ce qui sort de la fenêtre de trente jours, et rien d’autre', async () => {
    const now = Date.now();
    const at = (t: number) => [{ t, s: SESSION_ID, k: 'state' as const, a: 'app', n: 'running' }];
    await persist(at(now - RETENTION_MS - 60_000));
    await persist(at(now - RETENTION_MS + 60_000));
    await persist(at(now));

    await prune(now);
    const kept = await readAll();
    expect(kept.map((record) => record.t)).toEqual([now - RETENTION_MS + 60_000, now]);
  });

  it('rend au tampon les événements dont l’écriture a échoué', () => {
    const buffer = new TelemetryBuffer();
    buffer.push({ k: 'state', a: 'app', n: 'checking' });
    const failed = buffer.drain();
    buffer.push({ k: 'state', a: 'app', n: 'running' });
    buffer.restore(failed);
    expect(buffer.drain().map((record) => record.n)).toEqual(['checking', 'running']);
  });
});
