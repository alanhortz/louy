import { MapPinIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useSelector } from '@xstate/react';
import { walkPhase } from '../../machines/walk.machine.ts';
import { useApp, useChild } from '../actors.ts';

/**
 * Balade au sol : le bandeau du bas dit où l'on en est — désigner un point, y
 * descendre, s'y promener — et porte la seule commande pour en sortir. Pendant
 * la balade, le reste de l'interface s'efface (walk.css).
 */
export function WalkBar() {
  const app = useApp();
  const touch = useSelector(app, (snapshot) => snapshot.context.support?.touch ?? false);
  const walk = useChild('walk');
  // à pied, les pastilles de la carte sont effacées : la copie se confirme ici
  const copied = useSelector(useChild('coordinates'), (snapshot) => (
    snapshot.matches('copied') ? `Copié · ${snapshot.context.text}` : snapshot.matches('shown') ? snapshot.context.text : null
  ));
  const phase = useSelector(walk, walkPhase);
  const place = useSelector(walk, (snapshot) => snapshot.context.scan?.name ?? null);
  const notice = useSelector(walk, (snapshot) => snapshot.context.notice);
  if (phase === 'idle') return null;

  const leaving = phase === 'aiming' ? 'Annuler' : phase === 'declined' ? 'Fermer' : 'Quitter la balade';
  return (
    <div className={`walk-bar walk-${phase}`} role="status">
      <div className="walk-bar-text">
        {phase === 'aiming' && <span className="walk-bar-lead">Touchez l’endroit où vous poser</span>}
        {phase === 'aiming' && <span className="walk-bar-hint">{notice ?? 'dans un lieu de l’imagerie aérienne'}</span>}
        {phase === 'declined' && <span className="walk-bar-lead">Pas de visite ici</span>}
        {phase === 'declined' && <span className="walk-bar-hint">{notice}</span>}
        {phase !== 'aiming' && phase !== 'declined' && <span className="walk-bar-lead">{place}</span>}
        {(phase === 'arriving' || phase === 'checking') && <span className="walk-bar-hint">Arrivée sur place…</span>}
        {phase === 'walking' && (
          <span className="walk-bar-hint" aria-live="polite">
            {/* sans clavier, on ne parle pas de ses flèches : le texte tient sur un téléphone */}
            {copied ?? (touch ? 'Glisser pour regarder · toucher le sol pour avancer' : 'Glisser pour regarder · toucher le sol pour avancer · flèches du clavier')}
          </span>
        )}
      </div>
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
