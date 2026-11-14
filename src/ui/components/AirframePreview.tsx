import { useEffect, useRef } from 'react';
import { airframeType } from '../../domain/airframes.ts';

interface AirframePreviewProps {
  /** Type OACI de l'appareil (« B738 ») et catégorie ADS-B : la maquette est celle de la carte. */
  type: string | null;
  category: string | null;
}

/** Durée d'un tour complet de la maquette, en secondes. */
const TURN_SECONDS = 9;

/**
 * Vignette de la fiche d'un vol : la maquette en volume de son type d'appareil,
 * qui tourne lentement sur elle-même. C'est la même que sur la carte, vue de
 * près — de quoi reconnaître d'un coup d'œil un biréacteur d'un turbopropulseur.
 * Le rendu 3D n'est chargé et démarré que lorsqu'une fiche est ouverte.
 */
export function AirframePreview({ type, category }: AirframePreviewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawn = airframeType(type, category);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let stopped = false;
    let stop = () => {};

    void Promise.all([import('three'), import('../../engine/aircraftModel.ts'), import('../../domain/airframes.ts')])
      .then(([three, { buildAirframe }, { AIRFRAMES }]) => {
        if (stopped) return;
        const frame = AIRFRAMES.get(drawn)!;
        const renderer = new three.WebGLRenderer({ canvas: element, antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
        renderer.setSize(element.clientWidth, element.clientHeight, false);

        const scene = new three.Scene();
        const sun = new three.DirectionalLight(0xffffff, 1.7);
        sun.position.set(0.35, 1, 0.25);
        scene.add(new three.HemisphereLight(0xffffff, 0x4a5560, 1.25), sun);
        const geometry = buildAirframe(frame);
        const material = new three.MeshLambertMaterial({ vertexColors: true, flatShading: true });
        const model = new three.Mesh(geometry, material);
        scene.add(model);

        // cadrée sur la plus grande dimension de la cellule, vue de trois quarts, légèrement plongeante
        const size = Math.max(frame.length, frame.span);
        const camera = new three.PerspectiveCamera(28, element.clientWidth / element.clientHeight, size * 0.05, size * 10);
        camera.position.set(0, size * 0.62, size * 1.85);
        camera.lookAt(0, 0, 0);

        // le visiteur qui évite les animations voit la maquette immobile, de trois quarts
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        let frameId = 0;
        const draw = (now: number) => {
          model.rotation.y = still ? -0.7 : (now / 1000 / TURN_SECONDS) * 2 * Math.PI;
          renderer.render(scene, camera);
          if (!still) frameId = requestAnimationFrame(draw);
        };
        frameId = requestAnimationFrame(draw);

        stop = () => {
          cancelAnimationFrame(frameId);
          geometry.dispose();
          material.dispose();
          renderer.dispose();
        };
      })
      .catch(() => { /* sans WebGL, la fiche se passe de vignette */ });

    return () => { stopped = true; stop(); };
  }, [drawn]);

  return <canvas ref={canvas} className="airframe-preview" role="img" aria-label={`Maquette du type ${drawn}`} />;
}
