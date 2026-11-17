import { describe, expect, it } from 'vitest';
import { createActor, createMachine, sendTo, type AnyEventObject } from 'xstate';
import { hasHighDefinition, isDefinition, satelliteIn, scanIn } from '../src/domain/definition.ts';
import { isSatelliteImage } from '../src/domain/satellite.ts';
import { settingsMachine } from '../src/machines/settings.machine.ts';

const credit = { author: 'Auteur', title: 'Vidéo', url: 'https://exemple.be', licence: 'CC BY' };
const scan = { id: 'a', name: 'A', x: 0, y: 0, splats: '/scans/a.spz', credit };
const image = { id: 'p', name: 'P', src: '/satellite/p.webp', west: 0, south: 0, east: 10, north: 10, top: 100, credit };

describe('définition des relevés', () => {
  it('dessine la version haute quand elle existe, la standard sinon', () => {
    const both = { ...scan, hd: { splats: '/scans/a-hd.spz' } };
    expect(scanIn(both, 'high').splats).toBe('/scans/a-hd.spz');
    expect(scanIn(both, 'standard').splats).toBe('/scans/a.spz');
    // sans version haute, le réglage ne change rien
    expect(scanIn(scan, 'high')).toBe(scan);
    expect([hasHighDefinition(both), hasHighDefinition(scan)]).toEqual([true, false]);
  });

  it('fait de même pour les images de la vue satellite, sans accepter d’adresse extérieure', () => {
    expect(satelliteIn({ ...image, hd: { src: '/satellite/p-hd.webp' } }, 'high').src).toBe('/satellite/p-hd.webp');
    expect(satelliteIn(image, 'high')).toBe(image);
    expect(isSatelliteImage({ ...image, hd: { src: 'https://ailleurs.example/p.webp' } })).toBe(false);
  });

  it('ne reconnaît que ses deux définitions', () => {
    expect([isDefinition('high'), isDefinition('standard'), isDefinition('4k'), isDefinition(null)]).toEqual([true, true, false, false]);
  });

  it('annonce le réglage à l’ouverture, puis chaque changement — et seulement les changements', () => {
    const announced: AnyEventObject[] = [];
    const parent = createActor(createMachine({
      invoke: { id: 'child', src: settingsMachine, input: { definition: 'standard' as const } },
      on: {
        'to.child': { actions: sendTo('child', ({ event }) => (event as AnyEventObject).event) },
        '*': { actions: ({ event }) => { announced.push(event); } },
      },
    })).start();
    const choose = (definition: string) => parent.send({ type: 'to.child', event: { type: 'settings.definitionChosen', definition } });
    choose('high'); choose('high'); choose('standard');
    expect(announced.map((event) => event.definition)).toEqual(['standard', 'high', 'standard']);
  });
});
