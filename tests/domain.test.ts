import { describe, expect, it } from 'vitest';
import { flightCellAt, flightDatesUrl, parseFlightDates } from '../src/domain/acquisition.ts';
import { toLambert, toWgs84 } from '../src/domain/lambert2008.ts';
import { parsePlaces } from '../src/domain/places.ts';
import { DEFAULT_SCENE, normalizeScene, resolveScene } from '../src/domain/scene.ts';
import { FLAP_CHAR_MS, FLAP_MAX_TOTAL_MS, planSplitFlap } from '../src/domain/splitFlap.ts';
import { SERVICE_PATTERN, directTileUrl, edgeTileUrl, parseTilePath } from '../src/domain/tiles.ts';
import { MAX_LEVEL, isValidAddress, paddedExtent, tileExtent } from '../src/domain/tiling.ts';
import { DEFAULT_VIEW, decodeView, encodeView, type View } from '../src/domain/view.ts';

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
    expect(resolveScene({ ...DEFAULT_SCENE, campaign: '2013-2014' })).toMatchObject({
      maxLevel: 10,
      elevationService: 'RELIEF/WALLONIE_MNS_2013_2014',
    });
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
    overlays: { places: false, cameras: true },
    cameraId: '519',
  };

  it('restitue exactement la vue encodée', () => {
    expect(decodeView(encodeView(view))).toEqual(view);
  });

  it('produit un lien lisible', () => {
    expect(encodeView(view)).toBe('c=688879,605554,426,137,58&s=2013-2014.mnt.infrared.2019&o=c&cam=519');
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
