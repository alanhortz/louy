import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor, createMachine, sendTo, type AnyEventObject } from 'xstate';
import { isBelgianAddress, militaryLabel, parseAircraft, type Aircraft } from '../src/domain/aircraft.ts';
import { PHOTO_FAMILIES, PHOTO_HOSTS, isFreeLicence, parseAircraftPhotos, plainAuthor } from '../src/domain/aircraftPhotos.ts';
import { AIRFRAMES } from '../src/domain/airframes.ts';
import { AHEAD_SECONDS, pointAt, projectAhead, recordTracks, thin, type TrackPoint, type Tracks } from '../src/domain/trajectory.ts';
import { trajectoryCursor, trajectoryMachine } from '../src/machines/trajectory.machine.ts';

const NOW = 1_800_000_000_000;
const flight = (over: Partial<Aircraft> = {}): Aircraft => ({
  id: '44d1a7', callsign: 'JAF6LX', registration: 'OO-TMG', type: 'B38M', x: 650000, y: 620000, altitude: 6000, onGround: false,
  speed: 200, track: 90, heading: null, roll: null, turnRate: null, category: 'A3', military: null, verticalRate: -10, squawk: null,
  selectedAltitude: 3000, indicatedSpeed: null, mach: null, wind: null, temperature: null, seenAt: NOW, ...over,
});

describe('appareils militaires', () => {
  const entry = (hex: string, dbFlags?: number) => ({ hex, lat: 50.4, lon: 4.8, alt_baro: 20000, gs: 300, track: 10, ...(dbFlags === undefined ? {} : { dbFlags }) });

  it('reconnaît un militaire à l’indicateur du réseau, et un belge à l’adresse de son transpondeur', () => {
    const [civil, belgian, foreign] = parseAircraft({ now: NOW, ac: [entry('44d1a7'), entry('44f123', 1), entry('ae07d9', 1)] });
    expect([civil!.military, belgian!.military, foreign!.military]).toEqual([null, 'belgian', 'foreign']);
    expect(militaryLabel(civil!)).toBeNull();
    expect(militaryLabel(belgian!)).toBe('Militaire belge');
    expect(militaryLabel(foreign!)).toBe('Militaire étranger');
    // un autre indicateur que « militaire » ne compte pas
    expect(parseAircraft({ now: NOW, ac: [entry('ae07d9', 8)] })[0]!.military).toBeNull();
  });

  it('borne le bloc d’adresses attribué à la Belgique', () => {
    expect(['447fff', '448000', '44ffff', '450000'].map(isBelgianAddress)).toEqual([false, true, true, false]);
  });
});

describe('trace relevée par le site', () => {
  it('allonge la trace de chaque appareil à chaque relevé, et oublie ceux qui sont partis', () => {
    let tracks = recordTracks(new Map(), [flight(), flight({ id: 'ae07d9' })], NOW);
    tracks = recordTracks(tracks, [flight({ x: 651000, seenAt: NOW + 5000 })], NOW + 5000);
    expect([...tracks.keys()]).toEqual(['44d1a7']);
    expect(tracks.get('44d1a7')).toEqual([
      { at: NOW, x: 650000, y: 620000, altitude: 6000, speed: 200 },
      { at: NOW + 5000, x: 651000, y: 620000, altitude: 6000, speed: 200 },
    ]);
  });

  it('n’ajoute rien quand le réseau n’a rien entendu de neuf', () => {
    const once = recordTracks(new Map(), [flight()], NOW);
    expect(recordTracks(once, [flight()], NOW + 5000).get('44d1a7')).toHaveLength(1);
  });

  it('repart de zéro après un long silence, et ne garde que les deux dernières heures', () => {
    const once = recordTracks(new Map(), [flight()], NOW);
    const later = recordTracks(once, [flight({ seenAt: NOW + 200_000 })], NOW + 200_000);
    expect(later.get('44d1a7')).toEqual([expect.objectContaining({ at: NOW + 200_000 })]);

    let tracks: Tracks = new Map();
    for (let minute = 0; minute <= 150; minute++) tracks = recordTracks(tracks, [flight({ seenAt: NOW + minute * 60_000 })], NOW + minute * 60_000);
    expect(tracks.get('44d1a7')).toHaveLength(121);
    expect(tracks.get('44d1a7')![0]!.at).toBe(NOW + 30 * 60_000);
  });
});

describe('estimation devant l’appareil', () => {
  it('prolonge la route, et met en palier à l’altitude affichée', () => {
    const points = projectAhead(flight(), NOW);
    expect(points[0]).toMatchObject({ at: NOW, x: 650000, altitude: 6000 });
    expect(points.at(-1)!.at).toBe(NOW + AHEAD_SECONDS * 1000);
    // plein est, à 200 m/s pendant dix minutes
    expect(points.at(-1)!.x).toBeCloseTo(650000 + 200 * 600, -1);
    expect(points.at(-1)!.y).toBeCloseTo(620000, -1);
    // la descente s'arrête à l'altitude affichée, atteinte en cinq minutes
    expect(points.find((point) => point.at === NOW + 300_000)!.altitude).toBe(3000);
    expect(points.at(-1)!.altitude).toBe(3000);
  });

  it('suit le virage en cours, un temps seulement', () => {
    const points = projectAhead(flight({ turnRate: 1.5 }), NOW);
    // une minute de virage à droite depuis l'est : la route passe au sud-est, puis file droit
    expect(points.at(-1)!.y).toBeLessThan(620000 - 50_000);
    const last = points.at(-1)!, before = points.at(-2)!;
    const heading = (Math.atan2(last.x - before.x, last.y - before.y) * 180) / Math.PI;
    expect(heading).toBeCloseTo(180, 0);
  });

  it('repart de la position du moment, et se tait pour un appareil posé', () => {
    expect(projectAhead(flight({ seenAt: NOW - 5000 }), NOW)[0]!.x).toBe(651000);
    expect(projectAhead(flight({ onGround: true, altitude: null }), NOW)).toEqual([]);
    // sans altitude affichée, la descente ne se prolonge que trois minutes
    const free = projectAhead(flight({ selectedAltitude: null }), NOW);
    expect(free.at(-1)!.altitude).toBe(6000 - 10 * 180);
  });
});

describe('lecture d’une trajectoire', () => {
  const track: TrackPoint[] = [
    { at: 0, x: 0, y: 0, altitude: 1000, speed: 100 },
    { at: 10_000, x: 1000, y: 0, altitude: 2000, speed: 200 },
    { at: 20_000, x: 1000, y: 3000, altitude: null, speed: 0 },
  ];

  it('donne la position à un instant, entre les deux points qui l’encadrent', () => {
    expect(pointAt(track, 5000)).toMatchObject({ x: 500, y: 0, altitude: 1500, speed: 150 });
    expect(pointAt(track, 0)).toMatchObject({ x: 0, altitude: 1000 });
    expect(pointAt(track, 20_000)).toMatchObject({ y: 3000, altitude: null });
    expect(pointAt(track, 25_000)).toBeNull();
    expect(pointAt([], 0)).toBeNull();
  });

  it('allège un long tracé en gardant ses deux bouts', () => {
    const long = Array.from({ length: 5000 }, (_, k) => k);
    const light = thin(long, 600);
    expect(light).toHaveLength(600);
    expect([light[0], light.at(-1)]).toEqual([0, 4999]);
    expect(thin([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe('machine de la trajectoire', () => {
  beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ['Date'] }); });
  afterEach(() => vi.useRealTimers());

  const track: TrackPoint[] = [
    { at: NOW - 600_000, x: 530000, y: 620000, altitude: 9000, speed: 200 },
    { at: NOW - 300_000, x: 590000, y: 620000, altitude: 8000, speed: 200 },
    { at: NOW, x: 650000, y: 620000, altitude: 6000, speed: 200 },
  ];
  function tracker() {
    const announced: AnyEventObject[] = [];
    const parent = createActor(createMachine({
      invoke: { id: 'trajectory', src: trajectoryMachine },
      on: {
        'to.child': { actions: sendTo('trajectory', ({ event }) => (event as AnyEventObject).event) },
        '*': { actions: ({ event }) => { announced.push(event); } },
      },
    })).start();
    const actor = parent.getSnapshot().children.trajectory!;
    return { announced, actor, send: (event: AnyEventObject) => parent.send({ type: 'to.child', event }) };
  }

  it('montre la trace relevée de l’appareil sélectionné, et l’estimation devant lui', () => {
    const { actor, send, announced } = tracker();
    send({ type: 'trajectory.aircraftChanged', aircraft: flight(), track });
    expect(actor.getSnapshot().matches('tracking')).toBe(true);
    const shown = announced.at(-1)!;
    expect(shown.type).toBe('trajectory.changed');
    expect(shown.past).toEqual(track);
    expect(shown.future.at(-1).at).toBe(NOW + AHEAD_SECONDS * 1000);
    expect(shown.cursor).toBeNull();
  });

  it('avance avec chaque relevé', () => {
    const { send, announced } = tracker();
    send({ type: 'trajectory.aircraftChanged', aircraft: flight(), track });
    vi.setSystemTime(NOW + 8000);
    const moved = flight({ x: 651600, seenAt: NOW + 8000 });
    send({ type: 'trajectory.aircraftChanged', aircraft: moved, track: [...track, { at: NOW + 8000, x: 651600, y: 620000, altitude: 6000, speed: 200 }] });
    expect(announced.at(-1)!.past.at(-1)).toMatchObject({ at: NOW + 8000, x: 651600 });
    expect(announced.at(-1)!.future[0]).toMatchObject({ x: 651600 });
  });

  it('place le curseur dans le passé ou dans l’estimation, sans sortir de leurs bornes', () => {
    const { actor, send, announced } = tracker();
    send({ type: 'trajectory.aircraftChanged', aircraft: flight(), track });
    const read = () => trajectoryCursor(actor.getSnapshot() as never);
    expect(read()).toMatchObject({ earliest: -600, latest: 600, offset: 0, point: null });

    send({ type: 'trajectory.scrubbed', offset: -450 });
    // sept minutes et demie plus tôt, à mi-chemin des deux premiers points
    expect(read().point).toMatchObject({ x: 560000, altitude: 8500 });
    expect(announced.at(-1)!.cursor).toMatchObject({ x: 560000 });
    send({ type: 'trajectory.scrubbed', offset: 300 });
    expect(read().point).toMatchObject({ x: 710000, altitude: 3000 });
    send({ type: 'trajectory.scrubbed', offset: -99999 });
    expect(read().offset).toBe(-600);
    send({ type: 'trajectory.scrubbed', offset: 99999 });
    expect(read().offset).toBe(600);
    send({ type: 'trajectory.scrubbed', offset: 0 });
    expect(announced.at(-1)!.cursor).toBeNull();
  });

  it('change d’appareil en ramenant le curseur à maintenant, et s’efface quand plus rien n’est sélectionné', () => {
    const { actor, send, announced } = tracker();
    send({ type: 'trajectory.aircraftChanged', aircraft: flight(), track });
    send({ type: 'trajectory.scrubbed', offset: -100 });
    send({ type: 'trajectory.aircraftChanged', aircraft: flight({ id: 'ae07d9' }), track: track.slice(-1) });
    expect(announced.at(-1)).toMatchObject({ past: track.slice(-1), cursor: null });
    // un appareil vu à l'instant n'a pas encore de passé à parcourir
    expect(trajectoryCursor(actor.getSnapshot() as never)).toMatchObject({ earliest: 0, latest: 600 });

    send({ type: 'trajectory.aircraftChanged', aircraft: null, track: [] });
    expect(actor.getSnapshot().matches('idle')).toBe(true);
    expect(announced.at(-1)).toEqual({ type: 'trajectory.changed', past: [], future: [], cursor: null });
  });
});

describe('photos des types d’appareils', () => {
  const published = parseAircraftPhotos(JSON.parse(readFileSync(new URL('../public/data/aircraft-photos.json', import.meta.url), 'utf8')));

  it('ne publie que des photos libres de Wikimedia Commons, avec auteur, licence et page d’origine', () => {
    expect(Object.keys(published).length).toBeGreaterThan(100);
    for (const [type, photo] of Object.entries(published)) {
      expect(isFreeLicence(photo.licence), `${type} : ${photo.licence}`).toBe(true);
      expect(PHOTO_HOSTS.some((host) => photo.url.startsWith(host)), type).toBe(true);
      expect(photo.url, type).not.toContain('?');
      expect(photo.page.startsWith('https://commons.wikimedia.org/wiki/File:'), type).toBe(true);
      expect(photo.author.length, type).toBeGreaterThan(0);
      expect(photo.author, type).not.toMatch(/[<>]/);
    }
  });

  it('n’illustre que des types que le site sait dessiner', () => {
    for (const type of PHOTO_FAMILIES.flatMap((family) => family.types)) expect(AIRFRAMES.has(type), type).toBe(true);
    expect(published.B738).toMatchObject({ subject: 'Boeing 737 Next Generation' });
  });

  it('écarte les licences qui demandent plus qu’une mention, et le balisage des noms d’auteurs', () => {
    expect(['CC BY-SA 4.0', 'CC BY 2.0', 'CC0', 'Public domain'].map(isFreeLicence)).toEqual([true, true, true, true]);
    expect(['GFDL 1.2', 'Fair use', '', 'OGL v1.0'].map(isFreeLicence)).toEqual([false, false, false, false]);
    expect(plainAuthor('<a href="//commons.wikimedia.org/wiki/User:X">Jean &amp; Co</a>')).toBe('Jean & Co');
    expect(plainAuthor('')).toBe('Auteur inconnu');
    expect(parseAircraftPhotos({ B738: { url: 'https://exemple.be/x.jpg', page: 'https://commons.wikimedia.org/wiki/File:X', author: 'A', licence: 'CC0', subject: 'S' }, 'x<y': {} })).toEqual({});
  });
});
