import { useSelector } from '@xstate/react';
import { walkPhase } from '../../machines/walk.machine.ts';
import { useApp, useChild } from '../actors.ts';

/**
 * Actions rondes : chercher un site ou une rue, se poser au sol dans un lieu filmé, partager la vue,
 * revenir à la vue d'accueil, copier les coordonnées du point visé, se situer sur la carte.
 */
export function TopActions() {
  const app = useApp();
  const sites = useChild('sites');
  const streetSearch = useChild('streetSearch');
  const share = useChild('share');
  const sharing = useSelector(share, (snapshot) => snapshot.matches('delivering'));
  const walk = useChild('walk');
  const location = useChild('location');
  const located = useSelector(location, (snapshot) => snapshot.matches('shown'));
  const locating = useSelector(location, (snapshot) => snapshot.matches('locating'));
  const aiming = useSelector(walk, (snapshot) => walkPhase(snapshot) === 'aiming');

  return (
    <nav className="top-actions" aria-label="Actions">
      <button
        type="button"
        title="Chercher un site ou une rue"
        aria-label="Chercher un site ou une rue"
        onClick={() => {
          sites.send({ type: 'sites.opened' });
          streetSearch.send({ type: 'streetSearch.opened' });
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
      </button>
      <button
        type="button"
        title="Se promener au sol dans un lieu filmé"
        aria-label="Se promener au sol dans un lieu filmé"
        aria-pressed={aiming}
        onClick={() => walk.send({ type: 'walk.toggled' })}
      >
        {/* un promeneur : la tête, le buste, le pas */}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12.5" cy="4.5" r="1.8" />
          <path d="M12 8.5 9.5 14l2.5 2 .5 5M12 8.5l3 2.5 2.5.5M12 8.5 8.5 10 7.5 13M9.5 14 7 20.5" />
        </svg>
      </button>
      <button
        type="button"
        title="Partager cette vue"
        aria-label="Partager cette vue"
        disabled={sharing}
        onClick={() => app.send({ type: 'app.shareRequested' })}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 15V3.5M7.5 7.5 12 3l4.5 4.5M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5" />
        </svg>
      </button>
      <button
        type="button"
        title="Revenir à la vue d’accueil"
        aria-label="Revenir à la vue d’accueil"
        onClick={() => app.send({ type: 'app.homeRequested' })}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 4l8 7.5M6.5 9.8V20h11V9.8" /></svg>
      </button>
      <button
        type="button"
        title="Copier les coordonnées du centre de la vue"
        aria-label="Copier les coordonnées du centre de la vue"
        onClick={() => app.send({ type: 'app.coordinatesRequested' })}
      >
        {/* une épingle : le point dont on prend les coordonnées */}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 21s6.5-6.2 6.5-11.2a6.5 6.5 0 0 0-13 0C5.5 14.8 12 21 12 21Z" /><circle cx="12" cy="9.8" r="2.3" />
        </svg>
      </button>
      <button
        type="button"
        title={located ? 'Retirer le repère de ma position' : 'Me situer sur la carte'}
        aria-label={located ? 'Retirer le repère de ma position' : 'Me situer sur la carte'}
        aria-pressed={located}
        aria-busy={locating}
        onClick={() => location.send({ type: 'location.toggled' })}
      >
        {/* une mire : là où se trouve l'appareil */}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="1.8" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
        </svg>
      </button>
    </nav>
  );
}
