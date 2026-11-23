import { XMarkIcon } from '@heroicons/react/24/outline';
import { useSelector } from '@xstate/react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useChild } from '../actors.ts';
import { useLocalized } from '../localized.ts';

/**
 * Vue « cinéma » : la séquence filmée d'un lieu, en grand, sur fond noir. La carte reste
 * derrière, telle qu'on l'a laissée : fermer la séance y ramène sans rien avoir déplacé.
 */
export function Cinema() {
  const { t } = useTranslation();
  const l = useLocalized();
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
      aria-label={t('cinema.label', { name: l(clip, 'name') })}
      onClick={(event) => { if (event.target === event.currentTarget) cinema.send({ type: 'cinema.closed', by: 'backdrop' }); }}
    >
      <header className="cinema-header">
        <div className="cinema-title">
          <span className="object-kicker">{t('cinema.kicker')}</span>
          <h2>{l(clip, 'name')}</h2>
        </div>
        <button
          type="button"
          className="rail-item"
          title={t('cinema.back')}
          aria-label={t('cinema.close')}
          onClick={() => cinema.send({ type: 'cinema.closed', by: 'button' })}
        >
          <XMarkIcon className="rail-glyph" aria-hidden="true" />
        </button>
      </header>
      {/* muette et en ligne : c'est ce qui permet à un téléphone de la lancer sans geste de plus */}
      <video key={clip.src} className="cinema-screen" src={clip.src} autoPlay loop muted playsInline controls />
      {credit && (
        <footer className="cinema-footer">
          {t('cinema.images')} <a href={credit.url} target="_blank" rel="noreferrer">{credit.author}</a> · {l(credit, 'licence')} · « {l(credit, 'title')} »
        </footer>
      )}
    </div>
  );
}
