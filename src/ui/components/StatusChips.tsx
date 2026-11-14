import { useSelector } from '@xstate/react';
import { AERIAL_LABEL } from '../../domain/scans.ts';
import { isOrbiting } from '../../machines/viewer.machine.ts';
import { useChild } from '../actors.ts';
import { count } from '../format.ts';
import { FlapText } from './FlapText.tsx';

/**
 * Pastilles d'état transitoires : chargement des tuiles, orbite, confirmation de
 * partage. Celle du relief est animée à palettes, comme dans God's Eye View.
 */
export function StatusChips() {
  const viewer = useChild('viewer');
  const share = useChild('share');
  const activity = useChild('activity');
  const phase = useSelector(activity, (snapshot) => snapshot.value);
  const points = useSelector(activity, (snapshot) => snapshot.context.points);
  const orbiting = useSelector(viewer, isOrbiting);
  const suspended = useSelector(viewer, (snapshot) => snapshot.matches({ attached: 'suspended' }));
  const failure = useSelector(viewer, (snapshot) => snapshot.context.failure);
  const scanBuild = useSelector(viewer, (snapshot) => snapshot.context.scanBuild);
  const outcome = useSelector(share, (snapshot) => (snapshot.matches('confirmed') ? snapshot.context.outcome : null));

  return (
    <div className="chips" aria-live="polite">
      {failure && <span className="chip" data-tone="warning">Le rendu 3D n’a pas pu démarrer · {failure}</span>}
      {suspended && <span className="chip" data-tone="warning">Rendu suspendu par le système · reprise automatique</span>}
      {orbiting && (
        <button type="button" className="chip" onClick={() => viewer.send({ type: 'viewer.orbitStopped' })}>
          Orbite en cours · touchez la carte pour reprendre la main
        </button>
      )}
      {phase !== 'quiet' && !orbiting && (
        <span className="chip" data-phase={phase}>
          <FlapText text={phase === 'loading' ? 'Chargement du relief' : `Relief chargé · ${count(points)} points`} />
        </span>
      )}
      {scanBuild && (
        <span className="chip chip-progress" data-phase="loading" style={{ '--progress': scanBuild.fraction } as React.CSSProperties}>
          {AERIAL_LABEL} · {scanBuild.phase === 'loading' ? 'téléchargement' : 'construction'} {Math.round(scanBuild.fraction * 100)} %
        </span>
      )}
      {outcome && <span className="chip">{outcome === 'copied' ? 'Lien de la vue copié' : 'Vue partagée'}</span>}
    </div>
  );
}
