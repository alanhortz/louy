/**
 * Cellules d'avions : ce qu'il faut savoir d'un type d'appareil pour en dessiner
 * une maquette à faible nombre de polygones, à sa taille réelle.
 *
 * Chaque ligne décrit un type OACI (« B738 ») : longueur, envergure et diamètre
 * du fuselage en mètres, puis sa formule — nombre et place des moteurs, voilure
 * haute, empennage en T… La maquette est construite à partir de ces seules
 * mesures : deux types de la même famille se distinguent par leurs proportions.
 *
 * L'assiette n'est pas transmise par la centrale inertielle de l'avion : un
 * transpondeur ADS-B n'émet ni tangage ni lacet. Elle est reconstituée ici à
 * partir de ce qu'il émet — cap, roulis quand l'appareil le diffuse, route,
 * vitesses — et le reste est déduit de la mécanique du vol (voir `attitude`).
 */

import type { Aircraft } from './aircraft.ts';

export type EngineKind = 'jet' | 'prop' | 'rotor' | 'none';
/** Place des moteurs : sous la voilure, à l'arrière du fuselage, dans le nez, dans le fuselage. */
export type EngineMount = 'wing' | 'rear' | 'nose' | 'inside' | 'mast';

export interface Airframe {
  /** Mesures réelles, en mètres. */
  length: number;
  span: number;
  fuselage: number;
  engines: number;
  kind: EngineKind;
  mount: EngineMount;
  highWing: boolean;
  tTail: boolean;
  /** Troisième réacteur à la base de la dérive (MD-11, Falcon triréacteurs). */
  tailEngine: boolean;
  /** Pont supérieur partiel (747), complet (A380), ou soute bombée (Beluga). */
  upperDeck: 'none' | 'hump' | 'full' | 'bulge';
  /** Flèche de la voilure, en degrés. */
  sweep: number;
}

/**
 * Formules. Lettre du moteur (J réacteur, P hélice, H rotor, G planeur), nombre,
 * place (W voilure, R arrière, N nez, I interne), puis options : h voilure haute,
 * t empennage en T, 3 réacteur de dérive, u bosse, d double pont, b soute bombée,
 * f chasseur (aile en delta).
 */
const TABLE = `
A318 31.4 34.1 3.95 J2W|A319 33.8 35.8 3.95 J2W|A320 37.6 35.8 3.95 J2W|A321 44.5 35.8 3.95 J2W
A19N 33.8 35.8 3.95 J2W|A20N 37.6 35.8 3.95 J2W|A21N 44.5 35.8 3.95 J2W
A306 54.1 44.8 5.64 J2W|A30B 53.6 44.8 5.64 J2W|A310 46.7 43.9 5.64 J2W
A332 58.8 60.3 5.64 J2W|A333 63.7 60.3 5.64 J2W|A338 58.8 64 5.64 J2W|A339 63.7 64 5.64 J2W
A342 59.4 60.3 5.64 J4W|A343 63.7 60.3 5.64 J4W|A345 67.9 63.5 5.64 J4W|A346 75.4 63.5 5.64 J4W
A359 66.8 64.8 5.96 J2W|A35K 73.8 64.8 5.96 J2W|A388 72.7 79.8 7.14 J4Wd
A3ST 56.2 44.8 5.64 J2Wb|A337 63.1 60.3 5.64 J2Wb
BCS1 35 35.1 3.7 J2W|BCS3 38.7 35.1 3.7 J2W
B712 37.8 28.4 3.34 J2Rt|B732 30.5 28.4 3.76 J2W|B733 33.4 28.9 3.76 J2W|B734 36.4 28.9 3.76 J2W|B735 31 28.9 3.76 J2W
B736 31.2 34.3 3.76 J2W|B737 33.6 35.8 3.76 J2W|B738 39.5 35.8 3.76 J2W|B739 42.1 35.8 3.76 J2W
B37M 35.6 35.9 3.76 J2W|B38M 39.5 35.9 3.76 J2W|B39M 42.2 35.9 3.76 J2W|B3XM 43.8 35.9 3.76 J2W
B741 70.7 59.6 6.5 J4Wu|B742 70.7 59.6 6.5 J4Wu|B744 70.7 64.4 6.5 J4Wu|B748 76.3 68.4 6.5 J4Wu
B752 47.3 38.1 3.76 J2W|B753 54.4 38.1 3.76 J2W
B762 48.5 47.6 5.03 J2W|B763 54.9 47.6 5.03 J2W|B764 61.4 51.9 5.03 J2W
B772 63.7 60.9 6.2 J2W|B77L 63.7 64.8 6.2 J2W|B773 73.9 60.9 6.2 J2W|B77W 73.9 64.8 6.2 J2W
B788 56.7 60.1 5.77 J2W|B789 62.8 60.1 5.77 J2W|B78X 68.3 60.1 5.77 J2W
MD11 61.6 51.7 6.02 J2W3|DC10 55.5 50.4 6.02 J2W3|MD82 45.1 32.9 3.34 J2Rt|MD83 45.1 32.9 3.34 J2Rt|MD88 45.1 32.9 3.34 J2Rt
E135 26.3 20 2.28 J2Rt|E145 29.9 20 2.28 J2Rt|E170 29.9 26 3.01 J2W|E75L 31.7 28.7 3.01 J2W|E75S 31.7 26 3.01 J2W
E190 36.2 28.7 3.01 J2W|E195 38.7 28.7 3.01 J2W|E290 36.2 33.7 3.01 J2W|E295 41.5 35.1 3.01 J2W
CRJ1 26.8 21.2 2.69 J2Rt|CRJ2 26.8 21.2 2.69 J2Rt|CRJ7 32.5 23.2 2.69 J2Rt|CRJ9 36.2 24.9 2.69 J2Rt|CRJX 39.1 26.2 2.69 J2Rt
F70 30.9 28.1 3.3 J2Rt|F100 35.5 28.1 3.3 J2Rt|B462 28.6 26.3 3.56 J4Wht|B463 31 26.3 3.56 J4Wht|RJ85 28.6 26.3 3.56 J4Wht|RJ1H 31 26.3 3.56 J4Wht
AT43 22.7 24.6 2.87 P2Wht|AT45 22.7 24.6 2.87 P2Wht|AT46 22.7 24.6 2.87 P2Wht|AT72 27.2 27.1 2.87 P2Wht|AT75 27.2 27.1 2.87 P2Wht|AT76 27.2 27.1 2.87 P2Wht
DH8A 22.3 25.9 2.69 P2Wht|DH8C 25.7 27.4 2.69 P2Wht|DH8D 32.8 28.4 2.69 P2Wht|SF34 19.7 21.4 2.31 P2W|SB20 27.3 24.8 2.31 P2W
F27 25.1 29 2.7 P2Wh|F50 25.3 29 2.7 P2Wh|D328 21.3 21 2.4 P2Wht|J328 21.3 21 2.4 J2Wht|JS41 19.3 18.3 1.98 P2W|L410 14.4 19.5 2 P2Wh
C130 29.8 40.4 4.3 P4Wh|C30J 29.8 40.4 4.3 P4Wh|A400 45.1 42.4 5.64 P4Wht|C17 53 51.8 6.86 J4Wht|IL76 46.6 50.5 4.8 J4Wht
A124 69.1 73.3 7.3 J4Wh|AN12 33.1 38 4.1 P4Wh|AN26 23.8 29.2 2.9 P2Wh|C295 24.5 25.8 2.8 P2Wh|CN35 21.4 25.8 2.8 P2Wh
K35R 41.5 39.9 3.66 J4W|E3TF 46.6 44.4 3.76 J4W|B703 46.6 44.4 3.76 J4W|A332M 58.8 60.3 5.64 J2W
F16 15 10 1.4 J1If|F35 15.7 10.7 1.6 J1If|EUFI 16 11 1.5 J2If|RFAL 15.3 10.9 1.5 J2If|HAWK 12.4 9.9 1.3 J1I|PC21 11.2 9.1 1.2 P1Nt|SF26 7.1 8.4 1 P1N
C25A 14.5 15.2 1.6 J2Rt|C25B 15.6 16.3 1.6 J2Rt|C25C 16.3 15.5 1.6 J2Rt|C25M 13 14.4 1.6 J2Rt|C510 12.4 13.2 1.5 J2Rt|C525 13 14.3 1.6 J2Rt
C550 14.4 15.9 1.6 J2R|C560 14.9 15.9 1.6 J2R|C56X 16 17.2 1.8 J2R|C680 19.4 19.3 1.9 J2R|C68A 19 22 1.9 J2R|C700 22.3 21 2 J2R|C750 22 19.4 1.9 J2Rt
CL30 20.9 19.5 2.3 J2Rt|CL35 20.9 21 2.3 J2Rt|CL60 20.9 19.6 2.7 J2Rt|GLEX 30.3 28.7 2.7 J2Rt|GL5T 29.5 28.7 2.7 J2Rt|GL7T 33.9 31.7 2.7 J2Rt
GLF4 26.9 23.7 2.4 J2Rt|GLF5 29.4 28.5 2.4 J2Rt|GLF6 30.4 30.4 2.6 J2Rt|GA5C 27.9 26.3 2.6 J2Rt|GA6C 30.4 28.7 2.6 J2Rt|G280 20.4 19.2 2.2 J2Rt|G150 17.3 16.9 1.9 J2R
E50P 12.8 12.3 1.6 J2Rt|E55P 15.6 16.2 1.8 J2Rt|E545 20.7 21 2.1 J2Rt|E550 20.7 21 2.1 J2Rt|E35L 26.3 21.2 2.28 J2Rt
F2TH 20.2 19.3 2.5 J2R|F900 20.2 19.3 2.5 J2R3|FA50 18.5 18.9 2 J2R3|FA7X 23.2 26.2 2.7 J2R3|FA8X 24.5 26.3 2.7 J2R3|FA6X 25.7 25.9 2.9 J2R
LJ35 14.8 12 1.6 J2Rt|LJ45 17.6 14.6 1.7 J2Rt|LJ60 17.9 13.4 1.7 J2Rt|LJ75 17.6 15.5 1.7 J2Rt|H25B 15.6 16.6 1.9 J2Rt|BE40 14.8 13.3 1.6 J2Rt
PC24 16.8 17 1.8 J2Rt|HDJT 13 12.1 1.5 J2Rt|SF50 9.4 11.8 1.5 J1I|EA50 10.1 11.4 1.5 J2Rt|PRM1 14 13.6 1.7 J2Rt
PC12 14.4 16.3 1.6 P1Nt|TBM7 10.7 12.7 1.3 P1N|TBM8 10.7 12.7 1.3 P1N|TBM9 10.7 12.8 1.3 P1N|C208 11.5 15.9 1.6 P1Nh|PC6T 11 15.9 1.3 P1Nh|M600 9 13.2 1.3 P1N|P46T 8.8 13.1 1.3 P1N
BE20 13.3 16.6 1.5 P2Wt|B350 14.2 17.7 1.5 P2Wt|BE9L 10.8 15.3 1.5 P2W|P180 14.4 14 1.9 P2W|C441 11.9 15 1.5 P2W|PA31 9.9 12.4 1.3 P2W|PA34 8.7 11.9 1.2 P2W|DA42 8.6 13.4 1.2 P2Wt|DA62 9.2 14.6 1.3 P2Wt|BE58 9.1 11.5 1.2 P2W
C150 7.3 10.2 1.1 P1Nh|C152 7.3 10.2 1.1 P1Nh|C172 8.3 11 1.2 P1Nh|C182 8.8 11 1.2 P1Nh|C206 8.6 11 1.2 P1Nh|C210 8.6 11.2 1.2 P1Nh|PA18 6.9 10.7 0.9 P1Nh
P28A 7.3 10.7 1.1 P1N|P28R 7.5 10.8 1.1 P1N|PA32 8.4 11 1.2 P1N|PA46 8.8 13.1 1.3 P1N|DA40 8.1 11.9 1.2 P1Nt|DA20 7.2 10.9 1.1 P1Nt|SR20 7.9 11.7 1.3 P1N|SR22 7.9 11.7 1.3 P1N
DR40 7 8.7 1.1 P1N|BE36 8.4 10.2 1.2 P1N|M20P 7.5 11 1.1 P1N|TB20 7.7 9.8 1.2 P1N|AA5 6.7 9.6 1.1 P1N|RV7 6.2 7.7 1 P1N|ULAC 6.5 9 1 P1Nh|GLID 7 15 0.7 G0It
EC35 12.2 10.2 1.6 H2M|EC45 13 11 1.7 H2M|H145 13.6 11 1.7 H2M|EC30 12.6 10.7 1.6 H1M|AS50 12.9 10.7 1.6 H1M|AS55 12.9 10.7 1.6 H2M|AS65 13.7 11.9 1.9 H2M
A109 13 11 1.6 H2M|A139 16.7 13.8 2.2 H2M|A169 14.7 12.1 2 H2M|NH90 19.6 16.3 2.6 H2M|EC25 19.5 16.2 2.4 H2M|S92 20.9 17.2 2.6 H2M|H60 19.8 16.4 2.4 H2M
R22 8.7 7.7 1.1 H1M|R44 11.7 10.1 1.3 H1M|R66 11.7 10.1 1.3 H1M|B06 12 10.2 1.3 H1M|B407 12.7 10.7 1.5 H1M|B429 13 11 1.7 H2M|EXPL 9.9 10.3 1.6 H2M|G2CA 8.1 7.2 1.2 H1M
`;

function read(row: string): [string, Airframe] {
  const [type, length, span, fuselage, formula] = row.trim().split(/\s+/) as [string, string, string, string, string];
  const letter = formula[0]!;
  const options = formula.slice(3);
  const kind: EngineKind = letter === 'J' ? 'jet' : letter === 'P' ? 'prop' : letter === 'H' ? 'rotor' : 'none';
  const mount = ({ W: 'wing', R: 'rear', N: 'nose', I: 'inside', M: 'mast' } as const)[formula[2] as 'W'] ?? 'inside';
  const fighter = options.includes('f');
  return [type, {
    length: Number(length),
    span: Number(span),
    fuselage: Number(fuselage),
    engines: Number(formula[1]),
    kind,
    mount,
    highWing: options.includes('h'),
    tTail: options.includes('t'),
    tailEngine: options.includes('3'),
    upperDeck: options.includes('u') ? 'hump' : options.includes('d') ? 'full' : options.includes('b') ? 'bulge' : 'none',
    // la flèche suit la vitesse : forte sur un long-courrier, nulle sur un avion de club
    sweep: fighter ? 42 : kind === 'jet' ? (Number(span) > 40 ? 32 : 26) : kind === 'prop' ? 3 : 0,
  }];
}

export const AIRFRAMES: ReadonlyMap<string, Airframe> =
  new Map(TABLE.trim().split(/[|\n]/).filter((row) => row.trim()).map(read));

/**
 * Catégorie d'émetteur ADS-B → type de repli, quand le type OACI est inconnu ou
 * absent : A1 léger, A2 petit, A3 moyen, A4 « sillage fort » (757), A5 gros
 * porteur, A6 haute performance, A7 voilure tournante, B1 planeur.
 */
const BY_CATEGORY: Record<string, string> = {
  A1: 'C172', A2: 'C56X', A3: 'A320', A4: 'B752', A5: 'B772', A6: 'F16', A7: 'EC35', B1: 'GLID', B4: 'ULAC',
};
const DEFAULT_TYPE = 'A320';

/** Type effectivement dessiné pour un appareil : le sien s'il est connu, sinon celui de sa catégorie. */
export function airframeType(type: string | null, category: string | null): string {
  if (type && AIRFRAMES.has(type)) return type;
  return BY_CATEGORY[category ?? ''] ?? DEFAULT_TYPE;
}

export const airframeOf = (type: string | null, category: string | null): Airframe =>
  AIRFRAMES.get(airframeType(type, category))!;

/* ------------------------------------------------------------ assiette --- */

export interface Attitude {
  /** Cap du nez, en degrés depuis le nord. */
  heading: number;
  /** Assiette longitudinale, en degrés (positive nez en l'air). */
  pitch: number;
  /** Inclinaison latérale, en degrés (positive aile droite basse). */
  roll: number;
  /** Ce qui vient de l'avion lui-même, par opposition à ce qui est déduit. */
  measured: { heading: boolean; roll: boolean };
}

const DEG = Math.PI / 180;
const GRAVITY = 9.81;
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

/**
 * Assiette d'un appareil. Le cap et le roulis sont ceux que l'avion diffuse
 * quand il les diffuse (messages Mode S « heading » et « roll ») ; sinon le cap
 * est la route suivie, et le roulis celui d'un virage coordonné au taux de
 * virage observé (tan φ = V·ω / g). Le tangage n'est jamais émis : c'est la
 * pente de la trajectoire, relevée de l'incidence qu'un avion lent doit prendre.
 */
export function attitude(aircraft: Pick<Aircraft, 'track' | 'speed' | 'verticalRate' | 'onGround' | 'heading' | 'roll' | 'turnRate'>): Attitude {
  const heading = aircraft.heading ?? aircraft.track;
  if (aircraft.onGround) {
    return { heading, pitch: 0, roll: 0, measured: { heading: aircraft.heading !== null, roll: false } };
  }
  const slope = aircraft.speed > 1 ? Math.atan2(aircraft.verticalRate, aircraft.speed) / DEG : 0;
  // incidence : ~2° en croisière rapide, jusqu'à ~7° en approche lente
  const incidence = 2 + 5 * Math.max(0, Math.min(1, (120 - aircraft.speed) / 60));
  const roll = aircraft.roll
    ?? (aircraft.turnRate === null ? 0 : Math.atan((aircraft.speed * aircraft.turnRate * DEG) / GRAVITY) / DEG);
  return {
    heading,
    pitch: clamp(slope + incidence, 30),
    roll: clamp(roll, 60),
    measured: { heading: aircraft.heading !== null, roll: aircraft.roll !== null },
  };
}
