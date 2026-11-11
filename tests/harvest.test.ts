import { describe, expect, it } from 'vitest';
import { interpolate, parseStamp, routeCode } from '../scripts/harvest-cameras.mjs';

describe('bandeau des images de caméras', () => {
  it('lit la route, le lieu et le point kilométrique', () => {
    expect(parseStamp('A015_SPY_061.400_(+) 10:46:57', 'A015')).toEqual({ code: 'A015', place: 'SPY', km: 61.4 });
    expect(parseStamp('A003_HERSTAL-HAUT_095.600_PTZ 10:46:54', 'A003'))
      .toEqual({ code: 'A003', place: 'HERSTAL-HAUT', km: 95.6 });
  });

  it.each([
    ['NO05_COUVIN_095.150_(+) 10:46:48', 'N005', 95.15],          // « O » lu pour zéro
    ['ROO0 _BRAINE-L-ALLEUD_006.900_PTZ 10:47:44', 'R000', 6.9],
    ['4007 HENSIES 078.200 (+) (10:47:09)', 'A007', 78.2],         // « 4 » lu pour « A »
    ['А007 HENSIES 078.200 (-) (10:47:06)', 'A007', 78.2],         // « А » cyrillique
    ['A054JUMET-EST_021.650_(-) 10:47:51', 'A054', 21.65],         // séparateur mangé
    ['A015 ONOZ 063.80011.Nov 2026 10:46:06', 'A015', 63.8],       // date collée au kilométrage
    ['A604_GRACE-HOLLOGNE_0.900_PTZ 10:46:12', 'A604', 0.9],
    ['R003_HUBLINBU_012.600(-) 10:46:51', 'R003', 12.6],
  ])('tolère ce que l’OCR abîme : %s', (text, code, km) => {
    expect(parseStamp(text, code)).toMatchObject({ code, km });
  });

  it('refuse un bandeau qui ne correspond pas à la route attendue', () => {
    expect(parseStamp('A004_CHAMPION_053.435_(-) 10:46:55', 'A015')).toBeNull();
  });

  it('refuse un bandeau sans point kilométrique, ou illisible', () => {
    expect(parseStamp('NO05_FRASNES ECHANGEUR_(+) 10:47:51', 'N005')).toBeNull();
    expect(parseStamp('ULULLUUUUUUGCUV', 'A015')).toBeNull();
    expect(parseStamp('', 'A015')).toBeNull();
  });

  it('ne prend pas l’heure pour un kilométrage', () => {
    expect(parseStamp('A015_SPY 10.46.570', 'A015')).toBeNull();
  });

  it('déduit le code de route du libellé', () => {
    expect(routeCode('A15 SPY (> Namur)')).toBe('A015');
    expect(routeCode('N5 COUVIN')).toBe('N005');
    expect(routeCode("R0 Braine l'alleud PTZ")).toBe('R000');
    expect(routeCode('Baraque de Fraiture')).toBeNull();
  });
});

describe('du point kilométrique à la position', () => {
  const markers = [{ at: 61_500, x: 200, y: 20 }, { at: 61_300, x: 0, y: 0 }, { at: 61_400, x: 100, y: 10 }];

  it('interpole entre les deux bornes qui encadrent le point', () => {
    expect(interpolate(markers, 61_450)).toEqual({ x: 150, y: 15 });
  });

  it('s’arrête à la dernière borne connue plutôt que d’extrapoler', () => {
    expect(interpolate(markers, 61_900)).toMatchObject({ x: 200, y: 20 });
    expect(interpolate(markers, 61_000)).toMatchObject({ x: 0, y: 0 });
  });

  it('ne place rien sans borne', () => {
    expect(interpolate([], 61_400)).toBeNull();
  });
});
