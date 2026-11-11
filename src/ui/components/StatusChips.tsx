import { useSelector } from '@xstate/react';
import { isOrbiting } from '../../machines/viewer.machine.ts';
import { useChild } from '../actors.ts';

/** Pastilles d'état transitoires : chargement des tuiles, orbite, confirmation de partage. */
export function StatusChips() {
  const viewer = useChild('viewer');
  const share = useChild('share');
  const loading = useSelector(viewer, (snapshot) => snapshot.context.loading && snapshot.matches('attached'));
  const orbiting = useSelector(viewer, isOrbiting);
  const suspended = useSelector(viewer, (snapshot) => snapshot.matches({ attached: 'suspended' }));
  const failure = useSelector(viewer, (snapshot) => snapshot.context.failure);
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
      {loading && !orbiting && <span className="chip">Chargement du relief</span>}
      {outcome && <span className="chip">{outcome === 'copied' ? 'Lien de la vue copié' : 'Vue partagée'}</span>}
    </div>
  );
}
