import { XMarkIcon } from '@heroicons/react/24/outline';
import { useSelector } from '@xstate/react';
import { walkPhase } from '../../machines/walk.machine.ts';
import { useChild } from '../actors.ts';

/**
 * Balade au sol : le bandeau du bas dit où l'on en est — désigner un point, y
 * descendre, s'y promener — et porte la seule commande pour en sortir. Pendant
 * la balade, le reste de l'interface s'efface (walk.css).
 */
export function WalkBar() {
  const walk = useChild('walk');
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
          <span className="walk-bar-hint">Glisser pour regarder · toucher le sol pour avancer · flèches du clavier</span>
        )}
      </div>
      <button type="button" className="walk-bar-exit" aria-label={leaving} title={leaving} onClick={() => walk.send({ type: 'walk.left' })}>
        <XMarkIcon aria-hidden="true" />
      </button>
    </div>
  );
}
