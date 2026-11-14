import { useSelector } from '@xstate/react';
import { useEffect, useState } from 'react';
import { frameState, selectedCamera, type FrameState } from '../../machines/cameras.machine.ts';
import { CAMERA_SOURCE, FRAME_REFRESH_MS, positionLabel, type RoadCamera } from '../../services/cameras.ts';
import { useChild } from '../actors.ts';
import { time } from '../format.ts';
import { Panel } from './Panel.tsx';

const BADGE: Record<FrameState, string> = {
  idle: 'SOURCE · —',
  loading: 'IMAGE · CHARGEMENT',
  error: 'IMAGE · INDISPONIBLE',
  ready: 'IMAGE FIXE · OK',
};

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

function summary(camera: RoadCamera | null, total: number, loadedAt: number | null): string {
  if (!camera) {
    return total > 0
      ? `${total} CAMÉRAS EN VEILLE · AUCUNE SÉLECTIONNÉE · CLIQUEZ UNE CAMÉRA POUR L’ACTIVER`
      : 'Activez les caméras pour afficher le réseau routier wallon.';
  }
  return [
    camera.route.toUpperCase(),
    camera.label.toUpperCase(),
    loadedAt ? `IMAGE DE ${time(loadedAt)}` : 'IMAGE EN ATTENTE',
    `REDEMANDÉE TOUTES LES ${REFRESH_MINUTES} MIN`,
    camera.approximate ? 'POSITION = LOCALITÉ, PAS LE MÂT' : `POSITION AU ${positionLabel(camera)}`,
  ].join(' · ');
}

/** Lecteur des caméras routières : image fixe renouvelée, navigation dans la liste. */
export function CameraPanel() {
  const actor = useChild('cameras');
  const enabled = useSelector(actor, (snapshot) => snapshot.matches('visible'));
  const cameras = useSelector(actor, (snapshot) => snapshot.context.cameras);
  const camera = useSelector(actor, selectedCamera);
  const frame = useSelector(actor, (snapshot) => snapshot.context.frame);
  const state = useSelector(actor, frameState);
  const typed = useTypewriter(summary(camera, enabled ? cameras.length : 0, frame?.loadedAt ?? null));

  const navigable = enabled && cameras.length > 0;
  const meta = camera
    ? `${camera.place} · ${camera.route} · ${positionLabel(camera)} · ${CAMERA_SOURCE}`
    : navigable
      ? `${cameras.length} caméras chargées · cliquez une caméra pour l’activer`
      : 'Activez les caméras pour charger le réseau routier';

  return (
    <Panel id="camera" title="Caméras" className="camera-panel">
      <div className={`cctv-frame-wrap ${state === 'loading' ? 'loading' : ''} ${frame ? 'has-frame' : ''}`}>
        <img
          className={`cctv-frame ${frame ? 'active' : ''}`}
          src={frame?.url}
          alt={camera ? `Image de la caméra ${camera.label}` : ''}
        />
      </div>
      <div className="cctv-source-badge" role="status" aria-live="polite" data-frame-state={state}>
        {BADGE[state]}
      </div>
      <div className="cctv-meta">{meta}</div>

      <div className="cctv-controls">
        <button
          type="button"
          className={`scene-btn ${enabled ? 'active' : ''}`}
          onClick={() => actor.send({ type: 'cameras.toggled' })}
        >
          {enabled ? 'CAMÉRAS ON' : 'CAMÉRAS OFF'}
        </button>
        <button
          type="button"
          className="scene-btn"
          disabled={!navigable}
          onClick={() => actor.send({ type: 'cameras.nearestRequested' })}
        >
          LA PLUS PROCHE
        </button>
      </div>

      <div className="cctv-controls">
        <button
          type="button"
          className="scene-btn"
          disabled={!navigable}
          onClick={() => actor.send({ type: 'cameras.stepped', delta: -1 })}
        >
          PRÉC.
        </button>
        <select
          className="glass-select"
          aria-label="Caméra"
          disabled={!navigable}
          value={camera?.id ?? ''}
          onChange={(event) => {
            actor.send({ type: 'cameras.picked', id: event.target.value });
            actor.send({ type: 'cameras.focusRequested' });
          }}
        >
          <option value="" disabled>Choisir…</option>
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
          SUIV.
        </button>
      </div>

      <div className="cctv-controls">
        <button
          type="button"
          className="scene-btn"
          disabled={!camera}
          onClick={() => actor.send({ type: 'cameras.focusRequested' })}
        >
          CADRER
        </button>
        <button
          type="button"
          className="scene-btn"
          disabled={!camera}
          onClick={() => actor.send({ type: 'cameras.dismissed' })}
        >
          RELÂCHER
        </button>
      </div>

      <div className="cctv-summary-label">RÉSUMÉ</div>
      <div className="cctv-summary">{typed}</div>
    </Panel>
  );
}
