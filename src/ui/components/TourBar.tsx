import { useSelector } from '@xstate/react';
import { tourPhase } from '../../machines/tour.machine.ts';
import { useApp, useChild } from '../actors.ts';

/** Barre de la visite guidée : le lieu survolé, pause ou lecture, et la sortie. On tourne la tête, on avance ou recule — toujours sur la route du drone. */
export function TourBar() {
  const app = useApp();
  const tour = useChild('tour');
  const phase = useSelector(tour, tourPhase);
  const place = useSelector(tour, (snapshot) => snapshot.context.flight?.name ?? null);
  if (phase === 'idle') return null;
  const playing = phase === 'playing';

  return (
    // mêmes habits que la balade au sol : le reste de l'interface s'efface de la même façon
    <div className="walk-bar walk-walking tour-bar" role="status">
      <div className="walk-bar-text">
        <span className="walk-bar-lead">{place}</span>
        <span className="walk-bar-hint" aria-live="polite">
          {playing ? 'Le trajet du drone, à sa vitesse · glisser ou molette pour prendre la main' : 'En pause · glisser pour tourner la tête · molette pour avancer ou reculer'}
        </span>
      </div>
      <button
        type="button"
        className="walk-bar-exit"
        aria-label={playing ? 'Mettre la visite en pause' : 'Reprendre la visite'}
        title={playing ? 'Pause' : 'Lecture'}
        onClick={() => tour.send({ type: 'tour.toggled' })}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {playing ? <path d="M9 6v12M15 6v12" /> : <path d="M8 5.500v13l11-6.500Z" />}
        </svg>
      </button>
      <button
        type="button"
        className="walk-bar-exit"
        aria-label="Partager cette vue cockpit"
        title="Partager cette vue cockpit : le lien y fait entrer directement"
        onClick={() => app.send({ type: 'app.shareRequested' })}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 15V3.500M7.500 7.500 12 3l4.500 4.500M5 12.500V19a1.500 1.500 0 0 0 1.500 1.500h11A1.500 1.500 0 0 0 19 19v-6.500" />
        </svg>
      </button>
      <button
        type="button"
        className="walk-bar-exit"
        aria-label="Rejouer la visite depuis le début"
        title="Rejouer depuis le début"
        onClick={() => tour.send({ type: 'tour.replayed' })}
      >
        {/* une flèche qui revient sur elle-même */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4.500 12a7.500 7.500 0 1 0 2.400-5.500M4.500 4.500v4h4" />
        </svg>
      </button>
      <button
        type="button"
        className="walk-bar-exit"
        aria-label="Quitter la visite"
        title="Quitter la visite et revenir à la carte"
        onClick={() => tour.send({ type: 'tour.left' })}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}
