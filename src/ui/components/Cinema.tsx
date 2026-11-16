import { XMarkIcon } from '@heroicons/react/24/outline';
import { useSelector } from '@xstate/react';
import { useEffect } from 'react';
import { useChild } from '../actors.ts';

/**
 * Vue « cinéma » : la séquence filmée d'un lieu, en grand, sur fond noir. La carte reste
 * derrière, telle qu'on l'a laissée : fermer la séance y ramène sans rien avoir déplacé.
 */
export function Cinema() {
  const cinema = useChild('cinema');
  const clip = useSelector(cinema, (snapshot) => snapshot.context.clip);
  const credit = useSelector(cinema, (snapshot) => snapshot.context.credit);

  useEffect(() => {
    if (!clip) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cinema.send({ type: 'cinema.closed', by: 'escape' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clip, cinema]);

  if (!clip) return null;

  return (
    <div
      className="cinema"
      role="dialog"
      aria-modal="true"
      aria-label={`Séquence filmée : ${clip.name}`}
      onClick={(event) => { if (event.target === event.currentTarget) cinema.send({ type: 'cinema.closed', by: 'backdrop' }); }}
    >
      <header className="cinema-header">
        <div className="cinema-title">
          <span className="object-kicker">Séquence filmée sur place</span>
          <h2>{clip.name}</h2>
        </div>
        <button
          type="button"
          className="rail-item"
          title="Revenir à la carte"
          aria-label="Fermer la séquence et revenir à la carte"
          onClick={() => cinema.send({ type: 'cinema.closed', by: 'button' })}
        >
          <XMarkIcon className="rail-glyph" aria-hidden="true" />
        </button>
      </header>
      {/* muette et en ligne : c'est ce qui permet à un téléphone de la lancer sans geste de plus */}
      <video key={clip.src} className="cinema-screen" src={clip.src} autoPlay loop muted playsInline controls />
      {credit && (
        <footer className="cinema-footer">
          Images <a href={credit.url} target="_blank" rel="noreferrer">{credit.author}</a> · {credit.licence} · « {credit.title} »
        </footer>
      )}
    </div>
  );
}
