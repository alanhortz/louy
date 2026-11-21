import { useSelector } from '@xstate/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { frameState, hasCameraView, selectedCamera } from '../../machines/cameras.machine.ts';
import { CAMERA_SOURCE, FRAME_REFRESH_MS, positionLabel, type RoadCamera } from '../../services/cameras.ts';
import { t } from '../../i18n/index.ts';
import { useChild } from '../actors.ts';
import { time } from '../format.ts';
import { Panel } from './Panel.tsx';

const REFRESH_MINUTES = FRAME_REFRESH_MS / 60_000;

/** Fait apparaître un texte caractère par caractère, comme un téléscripteur. */
function useTypewriter(text: string): string {
  const [length, setLength] = useState(0);
  useEffect(() => {
    setLength(0);
    const timer = setInterval(() => setLength((shown) => {
      if (shown >= text.length) clearInterval(timer);
      return Math.min(text.length, shown + 3);
    }), 20);
    return () => clearInterval(timer);
  }, [text]);
  return text.slice(0, length);
}

function summary(camera: RoadCamera | null, total: number, loadedAt: number | null, posed: boolean): string {
  if (!camera) {
    return total > 0 ? t('camera.summaryIdle', { count: total }) : t('camera.summaryOff');
  }
  return [
    camera.route.toUpperCase(),
    camera.label.toUpperCase(),
    loadedAt ? t('camera.imageAt', { time: time(loadedAt) }) : t('camera.imagePending'),
    t('camera.refreshed', { minutes: REFRESH_MINUTES }),
    camera.approximate ? t('camera.positionApprox') : t('camera.positionAt', { position: positionLabel(camera) }),
    ...(posed ? [t('camera.posed')] : []),
  ].join(' · ');
}

/** Lecteur des caméras routières : image fixe renouvelée, navigation dans la liste. */
export function CameraPanel() {
  const { t } = useTranslation();
  const actor = useChild('cameras');
  const enabled = useSelector(actor, (snapshot) => snapshot.matches('visible'));
  const cameras = useSelector(actor, (snapshot) => snapshot.context.cameras);
  const camera = useSelector(actor, selectedCamera);
  const frame = useSelector(actor, (snapshot) => snapshot.context.frame);
  const state = useSelector(actor, frameState);
  const posed = useSelector(actor, hasCameraView);
  const typed = useTypewriter(summary(camera, enabled ? cameras.length : 0, frame?.loadedAt ?? null, posed));

  const navigable = enabled && cameras.length > 0;
  const meta = camera
    ? `${camera.place} · ${camera.route} · ${positionLabel(camera)} · ${CAMERA_SOURCE}`
    : navigable
      ? t('camera.metaLoaded', { count: cameras.length })
      : t('camera.metaOff');

  return (
    <Panel id="camera" title={t('camera.title')} className="camera-panel">
      <div className={`cctv-frame-wrap ${state === 'loading' ? 'loading' : ''} ${frame ? 'has-frame' : ''}`}>
        <img
          className={`cctv-frame ${frame ? 'active' : ''}`}
          src={frame?.url}
          alt={camera ? t('camera.frameAlt', { label: camera.label }) : ''}
        />
      </div>
      <div className="cctv-source-badge" role="status" aria-live="polite" data-frame-state={state}>
        {t(`camera.badge.${state}`)}
      </div>
      <div className="cctv-meta">{meta}</div>

      <div className="cctv-controls">
        <button
          type="button"
          className={`scene-btn ${enabled ? 'active' : ''}`}
          onClick={() => actor.send({ type: 'cameras.toggled' })}
        >
          {enabled ? t('camera.on') : t('camera.off')}
        </button>
        <button
          type="button"
          className="scene-btn"
          disabled={!navigable}
          onClick={() => actor.send({ type: 'cameras.nearestRequested' })}
        >
          {t('camera.nearest')}
        </button>
      </div>

      <div className="cctv-controls">
        <button
          type="button"
          className="scene-btn"
          disabled={!navigable}
          onClick={() => actor.send({ type: 'cameras.stepped', delta: -1 })}
        >
          {t('camera.previous')}
        </button>
        <select
          className="glass-select"
          aria-label={t('camera.select')}
          disabled={!navigable}
          value={camera?.id ?? ''}
          onChange={(event) => {
            actor.send({ type: 'cameras.picked', id: event.target.value });
            actor.send({ type: 'cameras.focusRequested' });
          }}
        >
          <option value="" disabled>{t('camera.choose')}</option>
          {cameras.map((item) => (
            <option key={item.id} value={item.id}>{item.route} · {item.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="scene-btn"
          disabled={!navigable}
          onClick={() => actor.send({ type: 'cameras.stepped', delta: 1 })}
        >
          {t('camera.next')}
        </button>
      </div>

      <div className="cctv-controls">
        <button
          type="button"
          className="scene-btn"
          disabled={!camera}
          title={posed ? t('camera.viewHint') : t('camera.frameHint')}
          onClick={() => actor.send({ type: 'cameras.focusRequested' })}
        >
          {posed ? t('camera.view') : t('camera.frame')}
        </button>
        <button
          type="button"
          className="scene-btn"
          disabled={!camera}
          onClick={() => actor.send({ type: 'cameras.dismissed' })}
        >
          {t('camera.release')}
        </button>
      </div>

      <div className="cctv-summary-label">{t('camera.summary')}</div>
      <div className="cctv-summary">{typed}</div>
    </Panel>
  );
}
