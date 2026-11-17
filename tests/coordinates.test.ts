import { describe, expect, it } from 'vitest';
import { createActor, fromPromise, waitFor } from 'xstate';
import { coordinatesMachine } from '../src/machines/coordinates.machine.ts';

describe('copie des coordonnées', () => {
  const start = () => {
    const copied: string[] = [];
    const actor = createActor(coordinatesMachine.provide({
      actors: { copy: fromPromise<void, string>(async ({ input }) => { copied.push(input); }) },
    })).start();
    return { actor, copied };
  };

  it('copie les coordonnées, puis le lien qui rouvre la vue telle quelle', async () => {
    const { actor, copied } = start();
    actor.send({ type: 'coordinates.copyRequested', x: 685070, y: 627918, view: 'https://louy.be/#c=685070,627918,1800,40,58' });
    await waitFor(actor, (snapshot) => snapshot.matches('copied'));
    expect(copied).toEqual(['50.461001, 4.862606\nhttps://louy.be/#c=685070,627918,1800,40,58']);
    // la confirmation, elle, ne montre que les coordonnées
    expect(actor.getSnapshot().context.text).toBe('50.461001, 4.862606');
  });

  it('à pied, garde le cap du regard devant le lien', async () => {
    const { actor, copied } = start();
    actor.send({ type: 'coordinates.copyRequested', x: 685070, y: 627918, azimuth: 291, view: 'https://louy.be/#c=1' });
    await waitFor(actor, (snapshot) => snapshot.matches('copied'));
    expect(copied[0]).toBe('50.461001, 4.862606, 291°\nhttps://louy.be/#c=1');
  });
});

describe('vitesse du visiteur', () => {
  it('prend celle de l’appareil, sinon la déduit de deux relevés, et se tait quand rien ne la dit', async () => {
    const { speedKmh, locationLabel } = await import('../src/domain/whereabouts.ts');
    const a = { x: 0, y: 0, accuracy: 5, at: 0 }, b = { x: 50, y: 0, accuracy: 5, at: 10_000 };
    expect(speedKmh(null, b, 5)).toBe(18);          // 5 m/s mesurés
    expect(speedKmh(a, b, null)).toBe(18);          // 50 m en 10 s
    expect(speedKmh(null, b, null)).toBeUndefined();
    // un déplacement noyé dans l'incertitude, ou le bruit d'un appareil à l'arrêt : immobile
    expect(speedKmh(a, { ...b, x: 2 }, null)).toBe(0);
    expect(speedKmh(null, b, 0.2)).toBe(0);
    expect(locationLabel({ ...b, speed: 18 })).toBe('Vous êtes ici · 18 km/h');
    expect(locationLabel(b)).toBe('Vous êtes ici');
  });
});

describe('marqueur actif dans l’adresse', () => {
  it('s’écrit, se relit, et n’admet que des noms simples', async () => {
    const { DEFAULT_VIEW, decodeView, encodeView } = await import('../src/domain/view.ts');
    const link = encodeView({ ...DEFAULT_VIEW, active: { sports: 'sport-esplanade-citadelle' } });
    expect(link).toContain('sel=sports:sport-esplanade-citadelle');
    expect(decodeView(link).active).toEqual({ sports: 'sport-esplanade-citadelle' });
    expect(decodeView('c=685300,628200,1500&sel=sports:../../x,<b>:y').active).toBeUndefined();
  });
});

describe('vue cockpit dans l’adresse', () => {
  it('s’écrit avec le vol actif et se relit', async () => {
    const { DEFAULT_VIEW, decodeView, encodeView } = await import('../src/domain/view.ts');
    const link = encodeView({ ...DEFAULT_VIEW, active: { drones: 'vol-namur-sambre' }, cockpit: true });
    expect(link).toContain('sel=drones:vol-namur-sambre');
    expect(link).toContain('cockpit=1');
    expect(decodeView(link).cockpit).toBe(true);
    expect(decodeView(encodeView(DEFAULT_VIEW)).cockpit).toBeUndefined();
  });
});
