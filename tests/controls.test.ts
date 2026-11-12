import { PerspectiveCamera, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapControls } from '../src/engine/core/MapControls.js';

const DEG = Math.PI / 180;
const WIDTH = 400;
const HEIGHT = 800;
const CENTRE = { x: WIDTH / 2, y: HEIGHT / 2 };

/** Le strict nécessaire d'un canvas pour les contrôles : des écouteurs, une taille. */
class FakeCanvas extends EventTarget {
  style: Record<string, string> = {};
  clientHeight = HEIGHT;
  parentElement = null;
  setPointerCapture(): void {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: WIDTH, height: HEIGHT };
  }
}

const pointer = (type: string, pointerId: number, at: { x: number; y: number }) =>
  Object.assign(new Event(type), { pointerId, clientX: at.x, clientY: at.y, button: 0, shiftKey: false });

/** Point de l'écran à `radius` pixels du centre, dans la direction `angle` (sens horaire, y vers le bas). */
const around = (angle: number, radius = 100) =>
  ({ x: CENTRE.x + radius * Math.cos(angle), y: CENTRE.y + radius * Math.sin(angle) });

describe('gestes tactiles sur la carte', () => {
  let canvas: FakeCanvas;
  let camera: PerspectiveCamera;
  let controls: MapControls;

  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget());
    canvas = new FakeCanvas();
    camera = new PerspectiveCamera(55, WIDTH / HEIGHT, 1, 1e6);
    controls = new MapControls(camera, canvas);
    // presque à la verticale : à l'écran, la carte tourne alors du même angle que la caméra
    controls.goTo(0, 0, 1000, { azimuth: 40 * DEG, polar: 2 * DEG });
    settle();
  });

  afterEach(() => {
    controls.dispose();
    vi.unstubAllGlobals();
  });

  /** Laisse l'inertie s'éteindre. */
  function settle(): void {
    for (let frame = 0; frame < 400; frame++) controls.update(1 / 60);
  }

  /** Direction à l'écran d'un repère au sol, en degrés, sens horaire (y vers le bas). */
  function landmarkBearing(): number {
    camera.updateMatrixWorld(true);
    const ndc = new Vector3(120, 0, 60).project(camera);
    return Math.atan2(-ndc.y * HEIGHT, ndc.x * WIDTH) / DEG;
  }

  /** Deux doigts posés de part et d'autre du centre, tournés de `degrees` (sens horaire positif), écartés de `spread`. */
  function twoFingers(degrees: number, spread = 1): void {
    canvas.dispatchEvent(pointer('pointerdown', 1, around(Math.PI)));
    canvas.dispatchEvent(pointer('pointerdown', 2, around(0)));
    const STEPS = 12;
    for (let step = 1; step <= STEPS; step++) {
      const angle = (degrees * DEG * step) / STEPS;
      const radius = 100 * (1 + ((spread - 1) * step) / STEPS);
      canvas.dispatchEvent(pointer('pointermove', 1, around(Math.PI + angle, radius)));
      canvas.dispatchEvent(pointer('pointermove', 2, around(angle, radius)));
      controls.update(1 / 60);
    }
    canvas.dispatchEvent(pointer('pointerup', 1, around(Math.PI + degrees * DEG)));
    canvas.dispatchEvent(pointer('pointerup', 2, around(degrees * DEG)));
    settle();
  }

  const turned = (before: number, after: number) => ((after - before + 540) % 360) - 180;

  it('fait tourner la carte dans le sens des doigts : anti-horaire', () => {
    const before = landmarkBearing();
    twoFingers(-25);
    expect(turned(before, landmarkBearing())).toBeCloseTo(-25, 0);
  });

  it('fait tourner la carte dans le sens des doigts : horaire', () => {
    const before = landmarkBearing();
    twoFingers(25);
    expect(turned(before, landmarkBearing())).toBeCloseTo(25, 0);
  });

  it('ne fait pas pivoter la carte quand les doigts s’écartent sans tourner', () => {
    const before = landmarkBearing();
    const distance = controls.distance;
    twoFingers(0, 1.8);
    expect(turned(before, landmarkBearing())).toBeCloseTo(0, 1);
    expect(controls.distance).toBeLessThan(distance);
  });
});
