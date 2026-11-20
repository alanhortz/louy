import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { flightCellAt, flightDatesUrl, parseFlightDates } from '../src/domain/acquisition.ts';
import { toLambert, toWgs84 } from '../src/domain/lambert2008.ts';
import { parsePlaces } from '../src/domain/places.ts';
import { SCAN_HEIGHT, parseScans, scanFlyover } from '../src/domain/scans.ts';
import { DEFAULT_SCENE, normalizeScene, resolveScene } from '../src/domain/scene.ts';
import { FLAP_CHAR_MS, FLAP_MAX_TOTAL_MS, planSplitFlap } from '../src/domain/splitFlap.ts';
import { SERVICE_PATTERN, directTileUrl, edgeTileUrl, parseTilePath } from '../src/domain/tiles.ts';
import { MAX_LEVEL, isValidAddress, paddedExtent, tileExtent } from '../src/domain/tiling.ts';
import { DEFAULT_VIEW, decodeView, encodeView, hasPose, type View } from '../src/domain/view.ts';

describe('projection Lambert 2008', () => {
  it('projette l’origine de la projection sur ses fausses coordonnées', () => {
    // définition EPSG:3812 : latitude 50°47'52,134", longitude 4°21'33,177" → (649328, 665262)
    const { x, y } = toLambert(50.797815, 4.359215833);
    expect(x).toBeCloseTo(649_328, 3);
    expect(y).toBeCloseTo(665_262, 3);
  });

  it('est réversible', () => {
    const { lat, lon } = toWgs84(685070, 627918);
    const back = toLambert(lat, lon);
    expect(back.x).toBeCloseTo(685070, 3);
    expect(back.y).toBeCloseTo(627918, 3);
  });
});

describe('tuilage', () => {
  it('donne un pas de 50 cm au dernier niveau', () => {
    expect(tileExtent(MAX_LEVEL, 0, 0).size / 256).toBe(0.5);
  });

  it('élargit l’emprise demandée de la marge de reconstruction', () => {
    const tile = tileExtent(MAX_LEVEL, 10, 20);
    const padded = paddedExtent({ level: MAX_LEVEL, i: 10, j: 20 });
    expect(tile.xmin - padded.xmin).toBe(4); // 8 px × 0,5 m
    expect(padded.ymax - tile.ymax).toBe(4);
  });

  it('refuse les adresses hors du quadtree', () => {
    expect(isValidAddress({ level: 3, i: 7, j: 7 })).toBe(true);
    expect(isValidAddress({ level: 3, i: 8, j: 0 })).toBe(false);
    expect(isValidAddress({ level: MAX_LEVEL + 1, i: 0, j: 0 })).toBe(false);
    expect(isValidAddress({ level: 2, i: 1.5, j: 0 })).toBe(false);
  });
});

describe('adresses de tuiles', () => {
  const request = { service: 'RELIEF/WALLONIE_MNT_2021_2022', px: 272, level: 9, i: 250, j: 260, format: 'png' as const };

  it('fait l’aller-retour entre requête et chemin', () => {
    const path = edgeTileUrl('/edge/v1')(request);
    expect(path).toBe('/edge/v1/tiles/RELIEF/WALLONIE_MNT_2021_2022/272/9/250/260.png');
    expect(parseTilePath(path.slice('/edge/v1'.length))).toEqual(request);
  });

  it('demande au SPW une image png32 en Lambert 2008', () => {
    const url = new URL(directTileUrl(request));
    expect(url.pathname).toContain('/RELIEF/WALLONIE_MNT_2021_2022/MapServer/export');
    expect(url.searchParams.get('format')).toBe('png32');
    expect(url.searchParams.get('imageSR')).toBe('3812');
    expect(url.searchParams.get('size')).toBe('272,272');
  });

  it('n’accepte que les services du viewer', () => {
    expect(SERVICE_PATTERN.test('RELIEF/WALLONIE_MNS_2013_2014_HILLSHADE')).toBe(true);
    expect(SERVICE_PATTERN.test('IMAGERIE/ORTHO_2022_ETE_IR')).toBe(true);
    expect(SERVICE_PATTERN.test('RELIEF/LIDAR_MAILLES')).toBe(false);
    expect(SERVICE_PATTERN.test('IMAGERIE/ORTHO_LAST/../../admin')).toBe(false);
    expect(parseTilePath('/tiles/RELIEF/x/272/1/0/0.gif')).toBeNull();
  });
});

describe('scène', () => {
  it('ramène une scène invalide à la scène par défaut', () => {
    expect(normalizeScene({ campaign: '1999' as never, tint: 'ortho' })).toEqual(DEFAULT_SCENE);
  });

  it('résout les services de chaque habillage', () => {
    expect(resolveScene({ ...DEFAULT_SCENE, surface: 'mnt', tint: 'hillshade' }).colorService)
      .toBe('RELIEF/WALLONIE_MNT_2021_2022_HILLSHADE');
    expect(resolveScene({ ...DEFAULT_SCENE, tint: 'infrared', vintage: '2019' }).colorService)
      .toBe('IMAGERIE/ORTHO_2019_IR');
    // 1971 n'a pas d'infrarouge : repli sur la campagne la plus récente
    expect(resolveScene({ ...DEFAULT_SCENE, tint: 'infrared', vintage: '1971' }).colorService)
      .toBe('IMAGERIE/ORTHO_LAST_IR');
    expect(resolveScene({ ...DEFAULT_SCENE, tint: 'slope' })).toMatchObject({ colorMode: 'slope', colorService: null });
  });

  it('borne le niveau de détail à la résolution de la campagne', () => {
    expect(resolveScene({ ...DEFAULT_SCENE, surface: 'mns', campaign: '2013-2014' })).toMatchObject({
      maxLevel: 10,
      elevationService: 'RELIEF/WALLONIE_MNS_2013_2014',
    });
  });

  it('s’ouvre sur le terrain nu', () => {
    expect(resolveScene(DEFAULT_SCENE).elevationService).toBe('RELIEF/WALLONIE_MNT_2021_2022');
  });

  it('partage les tuiles entre habillages qui ne changent pas l’image', () => {
    const a = resolveScene({ ...DEFAULT_SCENE, tint: 'elevation', vintage: '2019' });
    const b = resolveScene({ ...DEFAULT_SCENE, tint: 'elevation', vintage: '2021' });
    expect(a.key).toBe(b.key);
  });
});

describe('vue partageable', () => {
  const view: View = {
    pose: { x: 688879, y: 605554, distance: 426, azimuth: 137, tilt: 58 },
    scene: { campaign: '2013-2014', surface: 'mnt', tint: 'infrared', vintage: '2019' },
    overlays: { places: false, cameras: true, aircraft: true, scans: true, objects: true, survival: true, fun: true, art: true, streets: true, vessels: true, motorways: true, orthophoto: true, clouds: true, sports: true, backed: true, drones: true, videos: true },
    cameraId: '519',
  };

  it('restitue exactement la vue encodée', () => {
    expect(decodeView(encodeView(view))).toEqual(view);
  });

  it('ramène à 0 un cap qui s’arrondit à 360°', () => {
    expect(encodeView({ ...view, pose: { ...view.pose, azimuth: 359.7 } })).toContain(',426,0,58');
  });

  it('produit un lien lisible', () => {
    expect(encodeView(view)).toBe('c=688879,605554,426,137,58&s=2013-2014.mnt.infrared.2019&o=caiodftrbmsnkwvu&cam=519');
  });

  it('garde l’imagerie et les objets allumés pour un lien d’avant leur existence, et éteints si le lien le dit', () => {
    const old = decodeView('c=685300,628200,1500&s=2021-2022.mnt.ortho.last&o=p');
    expect([old.overlays.scans, old.overlays.objects, old.overlays.survival]).toEqual([true, true, true]);
    // les calques « Fun » et « Street art », eux, sont éteints tant que le lien ne les allume pas
    expect([old.overlays.fun, old.overlays.art]).toEqual([false, false]);
    expect([DEFAULT_VIEW.overlays.fun, DEFAULT_VIEW.overlays.art]).toEqual([false, false]);
    const off = encodeView({ ...view, overlays: { ...view.overlays, scans: false, objects: false, survival: false } });
    expect(off).toContain('o=caftrbmsnkwvuxyz');
    expect(decodeView(off).overlays.art).toBe(true);
    expect(decodeView(off).overlays.fun).toBe(true);
    expect(decodeView(off).overlays.survival).toBe(false);
    expect([decodeView(off).overlays.scans, decodeView(off).overlays.objects]).toEqual([false, false]);
    const onlyObjects = encodeView({ ...view, overlays: { ...view.overlays, scans: false } });
    expect(onlyObjects).toContain('o=caodftrbmsnkwvux');
    expect([decodeView(onlyObjects).overlays.scans, decodeView(onlyObjects).overlays.objects]).toEqual([false, true]);
  });

  it('retombe sur la vue d’accueil pour un lien vide ou abîmé', () => {
    expect(decodeView('')).toEqual(DEFAULT_VIEW);
    expect(decodeView('#c=abc&s=x.y.z&cam=<script>')).toMatchObject({
      pose: DEFAULT_VIEW.pose,
      scene: DEFAULT_SCENE,
      cameraId: null,
    });
  });

  it('ramène une pose hors limites dans la Wallonie', () => {
    const { pose } = decodeView('c=0,9999999,1,725,200');
    expect(pose.x).toBe(542146.5);
    expect(pose.distance).toBe(12);
    expect(pose.azimuth).toBe(5);
    expect(pose.tilt).toBe(88);
  });
});

describe('lieux OpenStreetMap', () => {
  it('lit la réponse CSV d’Overpass et classe par type puis population', () => {
    const csv = '1\t50.4669\t4.8675\tNamur\tcity\t110939\n2\t50.26\t4.91\tDinant\ttown\t13544\n3\t50.3\t4.9\t\ttown\t\n4\t50.3\t4.9\tLieu-dit\thamlet\t';
    const places = parsePlaces(csv);
    expect(places.map((place) => place.label)).toEqual(['Namur', 'Dinant']);
    expect(places[0]!.rank).toBeGreaterThan(places[1]!.rank);
    expect(places[0]!.id).toBe('osm:1');
  });
});

describe('manifeste des scans 3D', () => {
  const credit = { author: 'Une vidéaste', title: 'Vêves vu du ciel', url: 'https://example.org/v', licence: 'CC BY' };
  const scan = { id: 'veves', name: 'Château de Vêves', x: 693807, y: 601258, splats: '/scans/veves.spz', credit };

  it('garde les scans complets et écarte le reste', () => {
    expect(parseScans([scan, { ...scan, x: 'ouest' }, { id: 'vide' }, null])).toEqual([scan]);
    expect(parseScans({ scans: [scan] })).toEqual([]);
    expect(parseScans(null)).toEqual([]);
  });

  it('refuse un scan sans crédit complet de son auteur', () => {
    expect(parseScans([{ ...scan, credit: 'Une vidéaste' }])).toEqual([]);
    expect(parseScans([{ ...scan, credit: { ...credit, url: 'javascript:alert(1)' } }])).toEqual([]);
    expect(parseScans([{ ...scan, credit: { author: 'Une vidéaste' } }])).toEqual([]);
  });

  it('publie un manifeste valide, dont chaque fichier existe', () => {
    const manifest = JSON.parse(readFileSync(new URL('../public/scans/index.json', import.meta.url), 'utf8'));
    const scans = parseScans(manifest);
    // tout ce qui n'est pas mis de côté doit être valide
    expect(scans).toHaveLength(manifest.filter((entry: { disabled?: boolean }) => !entry.disabled).length);
    for (const published of scans) {
      // un lieu a ses splats, un objet son maillage
      expect(existsSync(new URL(`../public${published.splats ?? published.mesh}`, import.meta.url))).toBe(true);
    }
  });

  it('ouvre un scan sur son cadrage, ou à l’aplomb de son ancrage', () => {
    const view = { x: 693700, y: 601300, height: 123, azimuth: 220 };
    expect(parseScans([{ ...scan, view }, { ...scan, view: { x: 1 } }])).toEqual([{ ...scan, view }]);
    expect(scanFlyover({ ...scan, view })).toEqual({ ...view, orbit: true, turns: undefined });
    // un lieu filmé d'un seul côté : l'orbite s'arrête avant d'en montrer l'envers
    expect(scanFlyover({ ...scan, view: { ...view, sweep: 90 } })).toMatchObject({ orbit: true, turns: 0.25 });
    expect(scanFlyover(scan)).toEqual({
      x: scan.x, y: scan.y, height: SCAN_HEIGHT, azimuth: undefined, orbit: true, turns: undefined,
    });
  });
});

describe('mailles de vol LiDAR', () => {
  it('interroge la maille par son centre', () => {
    const cell = flightCellAt(685070, 627918);
    expect(cell).toEqual({ cx: 1370, cy: 1255 });
    expect(new URL(flightDatesUrl(cell)).searchParams.get('geometry')).toBe('685250,627750');
  });

  it('lit les dates, ou rien hors couverture', () => {
    expect(parseFlightDates({ features: [{ attributes: { DATE_FIRST: 1, DATE_LAST: 2 } }] })).toEqual({ first: 1, last: 2 });
    expect(parseFlightDates({ features: [] })).toBeNull();
  });
});

describe('affichage à palettes', () => {
  it('ne fait basculer que les caractères qui changent, de gauche à droite', () => {
    const { cells, durationMs } = planSplitFlap('RELIEF', 'RELAIS');
    expect(cells.map((cell) => cell.changed)).toEqual([false, false, false, true, true, true]);
    expect(cells.map((cell) => cell.delayMs)).toEqual([0, 0, 0, 0, 26, 52]);
    expect(durationMs).toBe(52 + FLAP_CHAR_MS);
  });

  it('fait apparaître un libellé depuis le vide, et libère les colonnes en trop', () => {
    expect(planSplitFlap('', 'OK').cells).toMatchObject([{ from: '', to: 'O' }, { from: '', to: 'K' }]);
    expect(planSplitFlap('OKAY', 'OK').cells.at(-1)).toMatchObject({ from: 'Y', to: '', changed: true });
  });

  it('resserre la cascade d’un long libellé sous le plafond', () => {
    const plan = planSplitFlap('', 'x'.repeat(60));
    expect(plan.durationMs).toBeLessThanOrEqual(FLAP_MAX_TOTAL_MS);
  });

  it('ne planifie rien quand le texte ne change pas', () => {
    expect(planSplitFlap('RELIEF', 'RELIEF')).toMatchObject({ durationMs: 0 });
  });
});

describe('vue d’accueil', () => {
  it('distingue un lien qui désigne un point de vue d’une simple ouverture du site', () => {
    expect(hasPose('')).toBe(false);
    expect(hasPose('#s=2021-2022.mns.ortho.last&o=p')).toBe(false);
    expect(hasPose('#c=685070,627918,1800,0,58')).toBe(true);
  });
});

describe('chargement des relevés', () => {
  it('ne prépare d’avance que les lieux proches de la vue, et charge le plus proche d’abord', async () => {
    const { PRELOAD_RADIUS, nearestFirst, scansWorthPreloading } = await import('../src/domain/scans.ts');
    const here = { x: 685000, y: 628000 };
    const scans = [{ id: 'loin', x: 636186, y: 619125 }, { id: 'voisin', x: 685900, y: 628000 }, { id: 'ici', x: 685100, y: 628050 }];
    expect(scansWorthPreloading(scans, here).map((scan) => scan.id)).toEqual(['voisin', 'ici']);
    expect(scansWorthPreloading([{ x: here.x + PRELOAD_RADIUS + 1, y: here.y }], here)).toEqual([]);
    expect(nearestFirst(scans, here).map((scan) => scan.id)).toEqual(['ici', 'voisin', 'loin']);
  });

  it('accepte un aperçu, à une adresse du site seulement', async () => {
    const { parseScans } = await import('../src/domain/scans.ts');
    const credit = { author: 'a', title: 't', url: 'https://exemple.be', licence: 'CC BY' };
    const scan = { id: 'lieu', name: 'Lieu', x: 1, y: 2, splats: '/scans/lieu.spz', credit };
    expect(parseScans([{ ...scan, preview: '/scans/lieu-apercu.spz' }])).toHaveLength(1);
    expect(parseScans([{ ...scan, preview: 'https://ailleurs.example/x.spz' }])).toHaveLength(0);
  });
});

describe('vidéos signalées', () => {
  it('n’accepte qu’un identifiant YouTube, et construit elle-même l’adresse de la page', async () => {
    const { isWebVideo, videoPageUrl } = await import('../src/domain/videos.ts');
    const credit = { author: 'a', title: 't', url: 'https://exemple.be', licence: '©' };
    const video = { id: 'v', name: 'Vidéo', x: 1, y: 2, youtube: 'LVxdUiKYWGs', credit };
    expect(isWebVideo(video)).toBe(true);
    expect(isWebVideo({ ...video, youtube: 'https://ailleurs.example/x' })).toBe(false);
    expect(isWebVideo({ ...video, youtube: 'LVxdUiKYWGs&autoplay=1' })).toBe(false);
    expect(videoPageUrl(video)).toBe('https://www.youtube.com/watch?v=LVxdUiKYWGs');
    expect(videoPageUrl({ ...video, start: 443.2 })).toBe('https://www.youtube.com/watch?v=LVxdUiKYWGs&t=443s');
  });

  it('s’écrit dans l’adresse comme les autres calques', async () => {
    const { DEFAULT_VIEW, decodeView, encodeView } = await import('../src/domain/view.ts');
    expect(DEFAULT_VIEW.overlays.videos).toBe(true);
    expect(decodeView(encodeView({ ...DEFAULT_VIEW, overlays: { ...DEFAULT_VIEW.overlays, videos: false } })).overlays.videos).toBe(false);
    expect(decodeView(encodeView(DEFAULT_VIEW)).overlays.videos).toBe(true);
  });
});

describe('relief exact', () => {
  it('adresse la tuile relevée d’avance, sinon le relais, à tous les niveaux de la campagne servie', async () => {
    const { exactReliefUrl, parseExactRelief } = await import('../src/domain/exactRelief.ts');
    const index = parseExactRelief({ WALLONIE_MNT_2021_2022: ['11/1153/1282', 'n’importe quoi', 3], 'autre chose': ['11/1/1'] });
    expect(exactReliefUrl(index, 'RELIEF/WALLONIE_MNT_2021_2022', 11, 1153, 1282)).toBe('/relief/WALLONIE_MNT_2021_2022/11/1153/1282.bin');
    expect(exactReliefUrl(index, 'RELIEF/WALLONIE_MNT_2021_2022', 11, 1153, 1283)).toBe('/edge/v1/relief/MNT/11/1153/1283.bin');
    expect(exactReliefUrl(index, 'RELIEF/WALLONIE_MNS_2021_2022', 3, 4, 5)).toBe('/edge/v1/relief/MNS/3/4/5.bin');
    // une campagne que l'interrogation groupée du SPW ne sert pas
    expect(exactReliefUrl(index, 'RELIEF/WALLONIE_MNT_2013_2014', 11, 1153, 1283)).toBeNull();
    expect(parseExactRelief(null).size).toBe(0);
    expect(index.size).toBe(1);
  });

  it('ne prépare que les tuiles existantes, en Wallonie, du niveau 2 au plus fin', async () => {
    const { parseExactPath, exactReliefUrl } = await import('../src/domain/exactRelief.ts');
    const exactReliefUrlLevel1 = () => exactReliefUrl(new Map(), 'RELIEF/WALLONIE_MNT_2021_2022', 1, 1, 1);
    expect(parseExactPath('/relief/MNT/11/1153/1282.bin')).toEqual({ model: 'MNT', level: 11, i: 1153, j: 1282 });
    expect(parseExactPath('/relief/MNT/8/144/160.bin')).toEqual({ model: 'MNT', level: 8, i: 144, j: 160 });
    expect(parseExactPath('/relief/MNT/12/1153/1282.bin')).toBeNull();
    // trop haut : le SPW n'y répond pas
    expect(parseExactPath('/relief/MNT/1/1/1.bin')).toBeNull();
    expect(exactReliefUrlLevel1()).toBeNull();
    expect(parseExactPath('/relief/MNT/11/0/0.bin')).toBeNull();
    expect(parseExactPath('/relief/MNT/11/5000/1282.bin')).toBeNull();
    expect(parseExactPath('/relief/MNP/11/1153/1282.bin')).toBeNull();
  });

  it('demande une étape de 17 lignes, première ligne au nord, et code la réponse complète', async () => {
    const { encodeExactValues, exactStagePoints, exactStageRequest, EXACT_STAGE_COUNT, EXACT_STAGE_ROWS, EXACT_STAGES } = await import('../src/domain/exactRelief.ts');
    const { paddedExtent, REQUEST_PX } = await import('../src/domain/tiling.ts');
    const tile = { model: 'MNT' as const, level: 11, i: 1153, j: 1282 };
    const extent = paddedExtent(tile);
    expect(EXACT_STAGES * EXACT_STAGE_ROWS).toBe(REQUEST_PX);
    const first = exactStagePoints(tile, 0);
    expect(first).toHaveLength(EXACT_STAGE_COUNT);
    expect(first[0]).toEqual([extent.xmin + 0.25, extent.ymax - 0.25]);
    expect(first[REQUEST_PX]).toEqual([extent.xmin + 0.25, extent.ymax - 0.75]);
    expect(exactStagePoints(tile, 1)[0]).toEqual([extent.xmin + 0.25, extent.ymax - EXACT_STAGE_ROWS * 0.5 - 0.25]);
    // le corps écrit à la main est celui que l'on aurait composé avec les outils du navigateur
    const body = new URLSearchParams(exactStageRequest(tile, 1).body);
    expect(JSON.parse(body.get('geometry')!).points).toEqual(exactStagePoints(tile, 1));
    expect(body.get('returnGeometry')).toBe('false');
    expect(body.get('geometryType')).toBe('esriGeometryMultipoint');
    expect(new URLSearchParams(exactStageRequest(tile, 1, true).body).get('returnGeometry')).toBe('true');
    const answer = (values: string[]) => JSON.stringify({ results: values.map((value) => ({ layerId: 0, attributes: { 'Stretch.Pixel Value': value } })) });
    expect(Array.from(encodeExactValues(answer(['100.5', 'NoData', '-250']), 3)!)).toEqual([15025, 0, 0]);
    // une réponse incomplète décalerait tout : refusée
    expect(encodeExactValues(answer(['100.5', '101']), 3)).toBeNull();
  });

  it('replace par sa position chaque point d’une étape au bord de la couverture, et assemble la tuile', async () => {
    const { assembleExactTile, encodeExactValuesByPosition, EXACT_COUNT, EXACT_STAGE_COUNT, EXACT_STAGE_ROWS, EXACT_STAGES } = await import('../src/domain/exactRelief.ts');
    const { paddedExtent, REQUEST_PX } = await import('../src/domain/tiling.ts');
    const tile = { model: 'MNT' as const, level: 11, i: 1153, j: 1282 };
    const { xmin, ymax } = paddedExtent(tile);
    const north = ymax - EXACT_STAGE_ROWS * 0.5;   // bord nord de l'étape 1
    const values = encodeExactValuesByPosition({ results: [
      { geometry: { x: xmin + 0.25, y: north - 0.25 }, attributes: { 'Stretch.Pixel Value': '100' } },
      { geometry: { x: xmin + 1.25, y: north - 0.75 }, attributes: { 'Stretch.Pixel Value': '101' } },
      { geometry: { x: xmin + 0.25, y: ymax - 0.25 }, attributes: { 'Stretch.Pixel Value': '102' } },
    ] }, tile, 1);
    expect(values[0]).toBe(15000);
    expect(values[REQUEST_PX + 2]).toBe(15050);
    expect(values.reduce((sum, value) => sum + (value ? 1 : 0), 0)).toBe(2);
    const whole = assembleExactTile(Array.from({ length: EXACT_STAGES }, (_, k) => new Uint16Array(EXACT_STAGE_COUNT).fill(k + 1)));
    expect(whole).toHaveLength(EXACT_COUNT);
    expect(whole[0]).toBe(1);
    expect(whole[EXACT_STAGE_COUNT]).toBe(2);
    expect(whole[EXACT_COUNT - 1]).toBe(EXACT_STAGES);
  });
});

describe('époque d’un lieu ancien', () => {
  it('prend la campagne LiDAR et la photo aérienne les plus proches de son année', async () => {
    const { periodOf, periodYear } = await import('../src/domain/period.ts');
    expect(periodYear('2013–2014')).toBe(2013.5);
    expect(periodYear('La plus récente')).toBeNull();
    expect(periodOf(2014)).toEqual({ campaign: '2013-2014', vintage: '2015' });
    expect(periodOf(1972)).toEqual({ campaign: '2013-2014', vintage: '1971' });
    expect(periodOf(2025)).toEqual({ campaign: '2021-2022', vintage: '2025' });
  });

  it('ne change la carte qu’autour d’un lieu daté, et seulement si sa scène diffère', async () => {
    const { inPeriod, periodPatch, samePatch, PERIOD_LEVEL } = await import('../src/domain/period.ts');
    const { DEFAULT_SCENE } = await import('../src/domain/scene.ts');
    const credit = { author: 'a', title: 't', url: 'https://exemple.be', licence: '©' };
    const { ROOT_X0, ROOT_Y0, tileSize } = await import('../src/domain/tiling.ts');
    const size = tileSize(PERIOD_LEVEL);
    // un lieu un peu au nord-est d'un coin de tuiles : le carré de quatre tuiles autour de ce coin
    const old = { id: 'trakk', name: 'TRAKK', x: ROOT_X0 + 1000 * size + 30, y: ROOT_Y0 + 500 * size + 60, splats: '/scans/trakk.spz', credit, year: 2014 };
    const patch = periodPatch(old, DEFAULT_SCENE)!;
    expect(patch).toMatchObject({ level: PERIOD_LEVEL, i: 999, j: 499 });
    const inside = [[999, 499], [1000, 499], [999, 500], [1000, 500]].filter(([i, j]) => inPeriod(patch, { level: PERIOD_LEVEL, i: i!, j: j! }));
    expect(inside).toHaveLength(4);
    expect(inPeriod(patch, { level: PERIOD_LEVEL, i: 1001, j: 500 })).toBe(false);
    expect(inPeriod(patch, { level: PERIOD_LEVEL + 1, i: 2000, j: 1000 })).toBe(false);
    expect(patch.source.elevationService).toBe('RELIEF/WALLONIE_MNT_2013_2014');
    expect(patch.source.colorService).toBe('IMAGERIE/ORTHO_2015');
    // la surface et l'habillage choisis par le visiteur restent les siens
    expect(periodPatch(old, { ...DEFAULT_SCENE, surface: 'mns', tint: 'hillshade' })!.source.colorService).toBe('RELIEF/WALLONIE_MNS_2013_2014_HILLSHADE');
    expect(periodPatch({ ...old, year: undefined }, DEFAULT_SCENE)).toBeNull();
    expect(periodPatch(old, { ...DEFAULT_SCENE, campaign: '2013-2014', vintage: '2015' })).toBeNull();
    expect(periodPatch(null, DEFAULT_SCENE)).toBeNull();
    expect(samePatch(patch, periodPatch(old, DEFAULT_SCENE))).toBe(true);
  });

  it('n’accepte une année que pour un lieu, et plausible', async () => {
    const { parseScans } = await import('../src/domain/scans.ts');
    const credit = { author: 'a', title: 't', url: 'https://exemple.be', licence: '©' };
    const scan = { id: 'lieu', name: 'Lieu', x: 1, y: 2, splats: '/scans/lieu.spz', credit };
    expect(parseScans([{ ...scan, year: 2014 }])).toHaveLength(1);
    expect(parseScans([{ ...scan, year: 2014.5 }])).toHaveLength(0);
    expect(parseScans([{ ...scan, year: 214 }])).toHaveLength(0);
  });
});
