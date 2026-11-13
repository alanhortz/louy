import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { AIRFRAMES, airframeOf, airframeType, attitude } from '../src/domain/airframes.ts';
import { airframeOrientation } from '../src/engine/AircraftLayer.ts';
import { buildAirframe } from '../src/engine/aircraftModel.ts';

const flying = { track: 90, speed: 230, verticalRate: 0, onGround: false, heading: null, roll: null, turnRate: null };

describe('catalogue des cellules', () => {
  it('décrit chaque type par des mesures plausibles', () => {
    expect(AIRFRAMES.size).toBeGreaterThan(200);
    for (const [type, frame] of AIRFRAMES) {
      expect(type).toMatch(/^[A-Z0-9]{2,5}$/);
      expect(frame.length, type).toBeGreaterThan(5);
      expect(frame.length, type).toBeLessThan(80);
      expect(frame.span, type).toBeGreaterThan(6);
      expect(frame.span, type).toBeLessThan(90);
      expect(frame.fuselage, type).toBeLessThan(frame.length / 3);
    }
  });

  it('distingue les formules : biréacteur, quadriréacteur à bosse, turbopropulseur, hélicoptère', () => {
    expect(AIRFRAMES.get('B738')).toMatchObject({ engines: 2, kind: 'jet', mount: 'wing', length: 39.5 });
    expect(AIRFRAMES.get('B744')).toMatchObject({ engines: 4, upperDeck: 'hump' });
    expect(AIRFRAMES.get('A388')).toMatchObject({ engines: 4, upperDeck: 'full' });
    expect(AIRFRAMES.get('AT76')).toMatchObject({ kind: 'prop', highWing: true, tTail: true });
    expect(AIRFRAMES.get('CRJ9')).toMatchObject({ mount: 'rear', tTail: true });
    expect(AIRFRAMES.get('MD11')).toMatchObject({ tailEngine: true });
    expect(AIRFRAMES.get('EC35')).toMatchObject({ kind: 'rotor' });
  });

  it('retombe sur le gabarit de la catégorie quand le type est inconnu', () => {
    expect(airframeType('B738', 'A3')).toBe('B738');
    expect(airframeType('ZZZZ', 'A5')).toBe('B772');
    expect(airframeType(null, 'A7')).toBe('EC35');
    expect(airframeType(null, null)).toBe('A320');
    expect(airframeOf('ZZZZ', 'A1').kind).toBe('prop');
  });

  it('construit chaque maquette avec peu de polygones', () => {
    for (const [type, frame] of AIRFRAMES) {
      const geometry = buildAirframe(frame);
      const triangles = geometry.getAttribute('position').count / 3;
      expect(triangles, type).toBeGreaterThan(60);
      expect(triangles, type).toBeLessThan(700);
      // à sa taille réelle : la maquette tient dans la sphère de ses mesures
      const reach = Math.hypot(frame.length, frame.span) / 2;
      expect(geometry.boundingSphere!.radius, type).toBeLessThan(reach * 1.25);
      expect(geometry.boundingSphere!.radius, type).toBeGreaterThan(Math.max(frame.length, frame.span) * 0.38);
      geometry.dispose();
    }
  });
});

describe('assiette', () => {
  it('reprend le cap et le roulis que l’avion diffuse', () => {
    const result = attitude({ ...flying, heading: 84, roll: -12.5 });
    expect(result).toMatchObject({ heading: 84, roll: -12.5, measured: { heading: true, roll: true } });
  });

  it('déduit le roulis du taux de virage quand il n’est pas diffusé', () => {
    // virage standard (3°/s) à 120 m/s : environ 33° d'inclinaison
    const result = attitude({ ...flying, speed: 120, turnRate: 3 });
    expect(result.roll).toBeGreaterThan(30);
    expect(result.roll).toBeLessThan(36);
    expect(result.measured.roll).toBe(false);
    expect(attitude({ ...flying, speed: 120, turnRate: -3 }).roll).toBeLessThan(-30);
    expect(attitude(flying)).toMatchObject({ heading: 90, roll: 0 });
  });

  it('cabre en montée, pique en descente, et reste à plat au sol', () => {
    expect(attitude({ ...flying, speed: 150, verticalRate: 15 }).pitch).toBeGreaterThan(5);
    expect(attitude({ ...flying, speed: 150, verticalRate: -15 }).pitch).toBeLessThan(-3);
    // en approche lente, le nez reste haut malgré la descente
    expect(attitude({ ...flying, speed: 70, verticalRate: -3.6 }).pitch).toBeGreaterThan(2);
    expect(attitude({ ...flying, onGround: true, verticalRate: 4, roll: 9 })).toMatchObject({ pitch: 0, roll: 0 });
  });
});

describe('orientation de la maquette', () => {
  const nose = (heading: number, pitch: number, roll: number) => new Vector3(0, 0, -1).applyQuaternion(airframeOrientation(heading, pitch, roll));
  const rightWing = (heading: number, pitch: number, roll: number) => new Vector3(1, 0, 0).applyQuaternion(airframeOrientation(heading, pitch, roll));

  it('pointe le nez sur le cap : nord vers −Z, est vers +X', () => {
    expect(nose(0, 0, 0).z).toBeCloseTo(-1);
    expect(nose(90, 0, 0).x).toBeCloseTo(1);
    expect(nose(180, 0, 0).z).toBeCloseTo(1);
    expect(nose(270, 0, 0).x).toBeCloseTo(-1);
  });

  it('lève le nez en tangage positif, quel que soit le cap', () => {
    expect(nose(0, 10, 0).y).toBeCloseTo(Math.sin(10 * Math.PI / 180));
    expect(nose(137, 10, 0).y).toBeCloseTo(Math.sin(10 * Math.PI / 180));
  });

  it('abaisse l’aile droite en roulis positif', () => {
    expect(rightWing(0, 0, 20).y).toBeCloseTo(-Math.sin(20 * Math.PI / 180));
    expect(rightWing(90, 0, 20).y).toBeLessThan(0);
    expect(rightWing(90, 0, -20).y).toBeGreaterThan(0);
  });
});
