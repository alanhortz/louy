import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useChild } from '../actors.ts';

/** Le canvas du nuage de points, la couche d'entités posée dessus et l'altimètre. */
export function Stage() {
  const { t } = useTranslation();
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
      <canvas ref={canvas} tabIndex={0} aria-label={t('stage.canvas')} />
      <div ref={overlayRoot} className="overlay-root" />
      {/* tenu à jour par le moteur, image par image */}
      <div className="altimeter" role="status" aria-label={t('stage.altimeter')}>
        <span className="indicator-label">{t('stage.viewAltitude')}</span>
        <span className="altimeter-value"><span ref={cameraAltitude}>—</span> m</span>
        <span className="altimeter-ground">{t('stage.ground')} <span ref={groundAltitude}>—</span> m</span>
      </div>
    </div>
  );
}
