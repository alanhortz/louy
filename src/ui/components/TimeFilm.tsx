import {
  ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon, XMarkIcon,
} from '@heroicons/react/24/outline';
import { useSelector } from '@xstate/react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PROJECT } from '../../config/project.ts';
import { TIMELINE_FADE_MS, timelinePosition } from '../../domain/timeline.ts';
import { timelinePhase, timelineProgress } from '../../machines/timeline.machine.ts';
import { useChild } from '../actors.ts';
import { vintageName } from '../labels.ts';

/** Quitte le plein écran s'il est actif ; sans effet là où il n'existe pas (iPhone). */
const leaveFullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); };

/**
 * Film du temps, en plein écran : la vue courante, photo aérienne après photo
 * aérienne, en fondu enchaîné. La frise et le clavier pilotent le défilement ;
 * chaque geste est un événement de la machine `timeline`.
 */
export function TimeFilm() {
  const { t } = useTranslation();
  const timeline = useChild('timeline');
  const phase = useSelector(timeline, timelinePhase);
  const steps = useSelector(timeline, (snapshot) => snapshot.context.steps);
  const cursor = useSelector(timeline, (snapshot) => snapshot.context.cursor);
  const frames = useSelector(timeline, (snapshot) => snapshot.context.frames);
  const skipped = useSelector(timeline, (snapshot) => snapshot.context.skipped);
  const index = useSelector(timeline, (snapshot) => snapshot.context.index);
  const progress = useSelector(timeline, timelineProgress);
  const open = phase !== 'idle';
  const presenting = phase === 'playing' || phase === 'paused';
  const last = frames.length - 1;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return timeline.send({ type: 'timeline.closed', by: 'escape' });
      if (!presenting) return;
      if (event.key === 'ArrowRight') timeline.send({ type: 'timeline.stepped', delta: 1, by: 'keyboard' });
      else if (event.key === 'ArrowLeft') timeline.send({ type: 'timeline.stepped', delta: -1, by: 'keyboard' });
      else if (event.key === 'Home') timeline.send({ type: 'timeline.seeked', index: 0, by: 'keyboard' });
      else if (event.key === 'End') timeline.send({ type: 'timeline.seeked', index: last, by: 'keyboard' });
      else if (event.key === ' ') timeline.send({ type: 'timeline.playToggled' });
      else return;
      event.preventDefault();
    };
    // le navigateur garde Échap pour sortir du plein écran : cette sortie ferme aussi le film
    const onFullscreen = () => { if (!document.fullscreenElement) timeline.send({ type: 'timeline.closed', by: 'fullscreen' }); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [open, presenting, last, timeline]);

  // Le film s'ouvre en plein écran, d'où qu'il soit demandé (bouton ou marqueur) : le
  // navigateur l'accorde tant que le geste du visiteur est récent. Fermé, il le quitte.
  useEffect(() => {
    if (!open) return leaveFullscreen();
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {});
  }, [open]);

  if (!open) return null;

  const close = () => timeline.send({ type: 'timeline.closed', by: 'button' });
  const current = frames[index];
  const preparingStep = steps[Math.min(cursor, steps.length - 1)];
  // le libellé d'un millésime est traduit (saison) ; celui enregistré dans le film reste le secours
  const name = (step: { vintage: string; label: string }) => vintageName(step.vintage, step.label);

  return (
    <div className="film" role="dialog" aria-modal="true" aria-label={t('film.title')}>
      {presenting && (
        <div className="film-frames" style={{ '--film-fade': `${TIMELINE_FADE_MS}ms` } as React.CSSProperties}>
          {frames.map((frame, at) => (
            <img key={frame.vintage} src={frame.url} alt="" className={at === index ? 'film-frame shown' : 'film-frame'} />
          ))}
        </div>
      )}

      <header className="film-header">
        <span className="film-brand">{PROJECT.name}</span>
        <span className="film-title">{t('film.title')}</span>
        <button type="button" className="rail-item" title={t('film.close')} aria-label={t('film.closeFilm')} onClick={close}>
          <XMarkIcon className="rail-glyph" aria-hidden="true" />
        </button>
      </header>

      {phase === 'fetching' && (
        <div className="film-center" role="status">
          <p className="film-kicker">{t('film.loading')}</p>
          <div className="film-progress film-progress-busy" aria-hidden="true"><span /></div>
          <p className="film-note">{t('film.ready')}</p>
        </div>
      )}

      {phase === 'preparing' && (
        <div className="film-center" role="status">
          <p className="film-kicker">{t('film.preparing')}</p>
          <p className="film-big">{preparingStep && name(preparingStep)}</p>
          <div className="film-progress" aria-hidden="true"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <p className="film-note">{t('film.preparingNote', { n: Math.min(cursor + 1, steps.length), total: steps.length })}</p>
        </div>
      )}

      {phase === 'empty' && (
        <div className="film-center" role="alert">
          <p className="film-kicker">{t('film.empty')}</p>
          <p className="film-note">{t('film.emptyNote')}</p>
          <button type="button" className="scene-btn" onClick={close}>{t('film.closeButton')}</button>
        </div>
      )}

      {presenting && current && (
        <footer className="film-frise">
          <div className="film-frise-head">
            <div>
              <span className="film-year" aria-live="polite">{current.year}</span>
              <span className="film-label">{t('film.frame', { label: name(current) })}</span>
            </div>
            <div className="film-controls">
              <button
                type="button" className="rail-item" title={t('film.previousKey')} aria-label={t('film.previous')}
                disabled={index === 0}
                onClick={() => timeline.send({ type: 'timeline.stepped', delta: -1, by: 'button' })}
              >
                <ChevronLeftIcon className="rail-glyph" aria-hidden="true" />
              </button>
              <button
                type="button" className={phase === 'playing' ? 'rail-item active' : 'rail-item'}
                title={phase === 'playing' ? t('film.pauseKey') : t('film.playKey')}
                aria-label={phase === 'playing' ? t('film.pause') : t('film.play')}
                aria-pressed={phase === 'playing'}
                onClick={() => timeline.send({ type: 'timeline.playToggled' })}
              >
                {phase === 'playing'
                  ? <PauseIcon className="rail-glyph" aria-hidden="true" />
                  : <PlayIcon className="rail-glyph" aria-hidden="true" />}
              </button>
              <button
                type="button" className="rail-item" title={t('film.nextKey')} aria-label={t('film.next')}
                disabled={index === last}
                onClick={() => timeline.send({ type: 'timeline.stepped', delta: 1, by: 'button' })}
              >
                <ChevronRightIcon className="rail-glyph" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="film-track" role="group" aria-label={t('film.track')}>
            <span className="film-track-fill" style={{ width: `${timelinePosition(current.year, frames) * 100}%` }} />
            {frames.map((frame, at) => (
              <button
                key={frame.vintage}
                type="button"
                className={at === index ? 'film-tick here' : at < index ? 'film-tick past' : 'film-tick'}
                style={{ left: `${timelinePosition(frame.year, frames) * 100}%` }}
                title={name(frame)}
                aria-label={t('film.tick', { label: name(frame) })}
                aria-current={at === index}
                onClick={() => timeline.send({ type: 'timeline.seeked', index: at, by: 'frise' })}
              />
            ))}
          </div>
          <div className="film-ends">
            <span>{frames[0]?.year}</span>
            <span className="film-hint">{t('film.hint')}</span>
            <span>{frames[last]?.year}</span>
          </div>
          {skipped.length > 0 && (
            <p className="film-skipped">{t('film.skipped', { labels: skipped.map(name).join(', ') })}</p>
          )}
        </footer>
      )}
    </div>
  );
}
