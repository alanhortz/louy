import { MapPinIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useSelector } from '@xstate/react';
import { useEffect, useState } from 'react';
import { walkPhase } from '../../machines/walk.machine.ts';
import { useApp, useChild } from '../actors.ts';

/**
 * Balade au sol : le bandeau du bas dit où l'on en est — désigner un point, y
 * descendre, s'y promener — et porte la seule commande pour en sortir. Pendant
 * la balade, le reste de l'interface s'efface (walk.css).
 */
/** L'appareil sait-il ouvrir une séance de réalité virtuelle ? Faux tant que le navigateur n'a pas répondu oui. */
function useVrSupport(): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    const xr = (navigator as Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean> } }).xr;
    let alive = true;
    void xr?.isSessionSupported('immersive-vr').then((yes) => { if (alive) setSupported(yes); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return supported;
}

export function WalkBar() {
  const app = useApp();
  const touch = useSelector(app, (snapshot) => snapshot.context.support?.touch ?? false);
  const walk = useChild('walk');
  const viewer = useChild('viewer');
  const vrSupported = useVrSupport();
  const immersive = useSelector(viewer, (snapshot) => snapshot.context.immersive);
  // à pied, les pastilles de la carte sont effacées : la copie se confirme ici
  const copied = useSelector(useChild('coordinates'), (snapshot) => (
    snapshot.matches('copied') ? `Copié · ${snapshot.context.text}` : snapshot.matches('shown') ? snapshot.context.text : null
  ));
  const phase = useSelector(walk, walkPhase);
  const place = useSelector(walk, (snapshot) => snapshot.context.scan?.name ?? null);
  const notice = useSelector(walk, (snapshot) => snapshot.context.notice);
  if (phase === 'idle') return null;

  const leaving = phase === 'aiming' ? 'Annuler' : 'Quitter la balade';
  return (
    <div className={`walk-bar walk-${phase}`} role="status">
      <div className="walk-bar-text">
        {phase === 'aiming' && <span className="walk-bar-lead">Touchez l’endroit où vous poser</span>}
        {phase === 'aiming' && <span className="walk-bar-hint">{notice ?? 'dans un lieu de l’imagerie aérienne'}</span>}
        {phase !== 'aiming' && <span className="walk-bar-lead">{place}</span>}
        {phase === 'arriving' && <span className="walk-bar-hint">Arrivée sur place…</span>}
        {phase === 'walking' && (
          <span className="walk-bar-hint" aria-live="polite">
            {/* sans clavier, on ne parle pas de ses flèches : le texte tient sur un téléphone */}
            {copied ?? (touch ? 'Glisser pour regarder · toucher le sol pour avancer' : 'Glisser pour regarder · toucher le sol pour avancer · flèches du clavier')}
          </span>
        )}
      </div>
      {phase === 'walking' && vrSupported && (
        <button
          type="button"
          className="walk-bar-exit"
          aria-pressed={immersive}
          aria-label="Voir ce lieu en réalité virtuelle"
          title="Voir ce lieu en réalité virtuelle, avec un casque"
          // la demande part dans le geste même : le navigateur n'ouvre une séance qu'à cette condition
          onClick={() => viewer.send({ type: 'viewer.vrRequested' })}
        >
          {/* un casque : la coque et ses deux verres */}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3.5 8.500h17a1.5 1.5 0 0 1 1.5 1.500v6a1.5 1.5 0 0 1-1.5 1.500h-4.200a1.5 1.5 0 0 1-1.2-.6l-1.4-1.800a1.5 1.5 0 0 0-2.4 0l-1.4 1.800a1.5 1.5 0 0 1-1.2.6H3.500A1.5 1.5 0 0 1 2 16v-6a1.5 1.5 0 0 1 1.5-1.500Z" />
            <circle cx="7.5" cy="12.5" r="1.6" /><circle cx="16.5" cy="12.5" r="1.6" />
          </svg>
        </button>
      )}
      {phase === 'walking' && (
        <button
          type="button"
          className="walk-bar-exit"
          aria-label="Copier ma position et le cap de mon regard"
          title="Copier ma position et le cap de mon regard (degrés depuis le nord)"
          onClick={() => app.send({ type: 'app.coordinatesRequested' })}
        >
          <MapPinIcon aria-hidden="true" />
        </button>
      )}
      <button type="button" className="walk-bar-exit" aria-label={leaving} title={leaving} onClick={() => walk.send({ type: 'walk.left' })}>
        <XMarkIcon aria-hidden="true" />
      </button>
    </div>
  );
}
