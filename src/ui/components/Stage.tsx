import { useEffect, useRef } from 'react';
import { useChild } from '../actors.ts';

/** Le canvas du nuage de points, la couche d'entités posée dessus et l'altimètre. */
export function Stage() {
  const viewer = useChild('viewer');
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlayRoot = useRef<HTMLDivElement>(null);
  const cameraAltitude = useRef<HTMLSpanElement>(null);
  const groundAltitude = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    viewer.send({
      type: 'viewer.canvasAttached',
      mount: {
        canvas: canvas.current!,
        overlayRoot: overlayRoot.current!,
        altimeter: { camera: cameraAltitude.current!, ground: groundAltitude.current! },
      },
    });
    return () => viewer.send({ type: 'viewer.canvasDetached' });
  }, [viewer]);

  return (
    <div className="stage">
      <canvas ref={canvas} tabIndex={0} aria-label="Relief de la Wallonie en nuage de points 3D" />
      <div ref={overlayRoot} className="overlay-root" />
      {/* tenu à jour par le moteur, image par image */}
      <div className="altimeter" role="status" aria-label="Altitude de la vue">
        <span className="indicator-label">Altitude de vue</span>
        <span className="altimeter-value"><span ref={cameraAltitude}>—</span> m</span>
        <span className="altimeter-ground">Sol visé <span ref={groundAltitude}>—</span> m</span>
      </div>
    </div>
  );
}
