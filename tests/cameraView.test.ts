import { describe, expect, it } from 'vitest';
import {
  CAMERA_EDGE_ROUTE, CAMERA_IMAGE, cameraEdgePath, cameraRay, cameraViewPose, castCameraPixel, type CameraPose,
} from '../src/domain/cameraView.ts';

/** Caméra à 10 m du sol, tournée vers l'est, qui plonge de 30° ; objectif sans déformation. */
const pose: CameraPose = { x: 1000, y: 2000, altitude: 110, height: 10, azimuth: 90, pitch: -30, roll: 0, focal: 400, bend: 1 };
const flat = () => 100;
const centre = [CAMERA_IMAGE.width / 2, CAMERA_IMAGE.height / 2] as const;

describe('vue d’une caméra routière', () => {
  it('fait regarder le centre de l’image dans l’axe de la caméra', () => {
    const ray = cameraRay(pose, ...centre);
    expect(ray.east).toBeCloseTo(Math.cos(Math.PI / 6));
    expect(ray.north).toBeCloseTo(0);
    expect(ray.up).toBeCloseTo(-0.5);
  });

  it('place la droite de l’image à droite du regard, et le bas plus près', () => {
    // tournée vers l'est, la droite est au sud
    expect(cameraRay(pose, centre[0] + 100, centre[1]).north).toBeLessThan(0);
    expect(cameraRay(pose, centre[0], centre[1] + 100).up).toBeLessThan(cameraRay(pose, ...centre).up);
  });

  it('resserre les bords d’un objectif grand-angle', () => {
    const edge = [CAMERA_IMAGE.width, centre[1]] as const;
    const straight = cameraRay(pose, ...edge), wide = cameraRay({ ...pose, bend: 0.1 }, ...edge);
    // le même pixel du bord montre un point plus écarté de l'axe quand l'objectif est grand-angle
    expect(Math.abs(wide.north)).toBeGreaterThan(Math.abs(straight.north));
  });

  it('pose un pixel là où son regard touche le sol', () => {
    const hit = castCameraPixel(pose, ...centre, flat)!;
    // 10 m de haut, 30° de plongée : le sol est touché 17,3 m plus loin
    expect(hit.x).toBeCloseTo(1000 + 10 / Math.tan(Math.PI / 6), 1);
    expect(hit.y).toBeCloseTo(2000, 1);
    expect(hit.altitude).toBe(100);
  });

  it('suit le relief : un talus est touché plus tôt', () => {
    const bank = (x: number) => (x > 1010 ? 105 : 100);
    expect(castCameraPixel(pose, ...centre, bank)!.x).toBeLessThan(castCameraPixel(pose, ...centre, flat)!.x);
  });

  it('ne pose pas le ciel', () => {
    expect(castCameraPixel(pose, centre[0], 0, flat)).toBeNull();
  });

  it('donne à la carte la place et l’axe de la caméra', () => {
    const view = cameraViewPose(pose);
    expect(view.azimuth).toBeCloseTo(90);
    expect(view.tilt).toBeCloseTo(60);
    expect(view.distance).toBeCloseTo(20);
    // le point visé est sur le sol, devant la caméra
    expect(view.x).toBeCloseTo(1000 + 20 * Math.cos(Math.PI / 6));
    expect(view.y).toBeCloseTo(2000);
  });

  it('n’accepte au relais qu’un numéro de caméra', () => {
    expect(CAMERA_EDGE_ROUTE.test(cameraEdgePath('516'))).toBe(true);
    expect(CAMERA_EDGE_ROUTE.test('/cameras/516_mini.jpg')).toBe(false);
    expect(CAMERA_EDGE_ROUTE.test('/cameras/../secret.jpg')).toBe(false);
  });
});
