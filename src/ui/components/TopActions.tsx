import { useSelector } from '@xstate/react';
import { useApp, useChild } from '../actors.ts';

/** Actions rondes : chercher un site, partager la vue, revenir à la vue d'accueil. */
export function TopActions() {
  const app = useApp();
  const sites = useChild('sites');
  const share = useChild('share');
  const sharing = useSelector(share, (snapshot) => snapshot.matches('delivering'));

  return (
    <nav className="top-actions" aria-label="Actions">
      <button
        type="button"
        title="Chercher un site touristique"
        aria-label="Chercher un site touristique"
        onClick={() => sites.send({ type: 'sites.opened' })}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
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
    </nav>
  );
}
