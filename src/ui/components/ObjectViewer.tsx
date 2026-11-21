import {
  ArrowPathIcon, ChevronLeftIcon, ChevronRightIcon, CubeIcon, PauseIcon, PlayIcon, XMarkIcon,
} from '@heroicons/react/24/outline';
import { useSelector } from '@xstate/react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { objectLabel, scanPhotos } from '../../domain/scans.ts';
import { objectPage, objectPhase } from '../../machines/object.machine.ts';
import { useApp, useChild } from '../actors.ts';
import { count } from '../format.ts';

/**
 * Visionneuse d'objet : un scan maillé, que le visiteur fait tourner et
 * approche, et les photos qui l'accompagnent — une rangée de vignettes sous la
 * scène, la première étant l'objet en 3D lui-même. Elle ne décide de rien : chaque bouton, chaque fermeture envoie un
 * événement à la machine `object`, qui en garde la trace.
 */
export function ObjectViewer() {
  const { t } = useTranslation();
  const object = useChild('object');
  const phase = useSelector(object, objectPhase);
  const scan = useSelector(object, (snapshot) => snapshot.context.scan);
  const progress = useSelector(object, (snapshot) => snapshot.context.progress);
  const stats = useSelector(object, (snapshot) => snapshot.context.stats);
  const autoRotate = useSelector(object, (snapshot) => snapshot.context.autoRotate);
  const failure = useSelector(object, (snapshot) => snapshot.context.failure);
  const page = useSelector(object, objectPage, (a, b) => a.index === b.index && a.total === b.total);
  const awaitsCanvas = useSelector(object, (snapshot) => snapshot.matches({ open: 'mounting' }));
  const touch = useSelector(useApp(), (snapshot) => snapshot.context.support?.touch ?? false);
  const photoIndex = useSelector(object, (snapshot) => snapshot.context.photo);
  const canvas = useRef<HTMLCanvasElement>(null);
  /** Départ d'un glissement sur la photo : sur un téléphone, on feuillette du doigt. */
  const swipe = useRef<number | null>(null);
  const open = phase !== 'closed';
  const photos = scan ? scanPhotos(scan) : [];
  const photo = photoIndex === null ? null : photos[photoIndex] ?? null;
  const viewingPhoto = photo !== null;

  // la machine attend un canvas à l'ouverture, et de nouveau après un « Réessayer »
  useEffect(() => {
    if (awaitsCanvas && canvas.current) object.send({ type: 'object.canvasAttached', canvas: canvas.current });
  }, [awaitsCanvas, object]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      // devant une photo, les touches lui reviennent : Échap ramène à l'objet, les flèches feuillettent les photos
      if (event.key === 'Escape') object.send(viewingPhoto ? { type: 'object.photoClosed', by: 'escape' } : { type: 'object.closed', by: 'escape' });
      // dans un groupe, les flèches feuillettent les objets ; la machine ignore les bouts
      else if (event.key === 'ArrowRight') object.send({ type: viewingPhoto ? 'object.photoPaged' : 'object.paged', delta: 1, by: 'keyboard' });
      else if (event.key === 'ArrowLeft') object.send({ type: viewingPhoto ? 'object.photoPaged' : 'object.paged', delta: -1, by: 'keyboard' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, object, viewingPhoto]);

  if (!open || !scan) return null;
  const kicker = t(objectLabel(scan));

  return (
    <div
      className="object-backdrop"
      onClick={(event) => { if (event.target === event.currentTarget) object.send({ type: 'object.closed', by: 'backdrop' }); }}
    >
      <section className="object-viewer" role="dialog" aria-modal="true" aria-label={`${kicker} : ${scan.name}`}>
        <header className="object-header">
          <div className="object-title">
            <span className="object-kicker">{kicker}</span>
            <h2>{scan.name}</h2>
          </div>
          <div className="object-actions">
            <button
              type="button"
              className="rail-item"
              title={t('object.reset')}
              aria-label={t('object.reset')}
              disabled={phase !== 'ready' || viewingPhoto}
              onClick={() => object.send({ type: 'object.resetRequested' })}
            >
              <ArrowPathIcon className="rail-glyph" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={autoRotate ? 'rail-item active' : 'rail-item'}
              title={autoRotate ? t('object.stopRotation') : t('object.rotate')}
              aria-label={autoRotate ? t('object.stopRotation') : t('object.rotate')}
              aria-pressed={autoRotate}
              disabled={phase !== 'ready' || viewingPhoto}
              onClick={() => object.send({ type: 'object.autoRotateToggled' })}
            >
              {autoRotate
                ? <PauseIcon className="rail-glyph" aria-hidden="true" />
                : <PlayIcon className="rail-glyph" aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="rail-item"
              title={t('object.close')}
              aria-label={t('object.closeViewer')}
              onClick={() => object.send({ type: 'object.closed', by: 'button' })}
            >
              <XMarkIcon className="rail-glyph" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="object-stage" data-phase={phase}>
          <canvas ref={canvas} tabIndex={0} aria-label={t('object.canvas', { name: scan.name })} />
          {photo && (
            <figure
              className="object-photo"
              onPointerDown={(event) => { swipe.current = event.clientX; }}
              onPointerUp={(event) => {
                const travelled = swipe.current === null ? 0 : event.clientX - swipe.current;
                swipe.current = null;
                if (Math.abs(travelled) > 48) object.send({ type: 'object.photoPaged', delta: travelled < 0 ? 1 : -1, by: 'swipe' });
              }}
              onPointerCancel={() => { swipe.current = null; }}
            >
              <img src={photo.src} alt={photo.caption ?? t('object.photoOf', { name: scan.name })} draggable={false} />
              {photo.caption && <figcaption>{photo.caption}</figcaption>}
            </figure>
          )}
          {!viewingPhoto && phase === 'loading' && (
            <p className="object-status" role="status">{t('object.loading', { percent: Math.round(progress * 100) })}</p>
          )}
          {!viewingPhoto && phase === 'suspended' && (
            <p className="object-status" role="status">{t('object.suspended')}</p>
          )}
          {!viewingPhoto && phase === 'failed' && (
            <div className="object-status" role="alert">
              <p>{t('object.failed')}</p>
              {failure && <p className="object-reason">{failure}</p>}
              <button type="button" className="scene-btn" onClick={() => object.send({ type: 'object.retryRequested' })}>
                {t('object.retry')}
              </button>
            </div>
          )}
        </div>

        {(scan.note || scan.link) && (
          <p className="object-note">
            {scan.note}
            {scan.link && <> <a href={scan.link.url} target="_blank" rel="noopener noreferrer">{scan.link.label}</a></>}
          </p>
        )}

        {photos.length > 0 && (
          <nav className="object-photos" aria-label={t('object.photos')}>
            <button
              type="button"
              className="object-thumb object-thumb-3d"
              aria-pressed={!viewingPhoto}
              title={t('object.in3d')}
              aria-label={t('object.see3d')}
              onClick={() => object.send({ type: 'object.photoClosed', by: 'button' })}
            >
              <CubeIcon aria-hidden="true" />
              <span>3D</span>
            </button>
            {photos.map((item, index) => (
              <button
                key={item.src}
                type="button"
                className="object-thumb"
                aria-pressed={photoIndex === index}
                title={item.caption ?? t('object.photo', { n: index + 1 })}
                aria-label={`${t('object.seePhoto', { n: index + 1, total: photos.length })}${item.caption ? ` : ${item.caption}` : ''}`}
                onClick={() => object.send({ type: 'object.photoOpened', index })}
              >
                <img src={item.thumb ?? item.src} alt="" loading="lazy" draggable={false} />
              </button>
            ))}
            <span className="object-photos-count">{t('object.photoCount', { count: photos.length })}</span>
          </nav>
        )}

        {page.total > 1 && (
          <nav className="object-pager" aria-label={t('object.pager')}>
            <button
              type="button" className="rail-item" title={t('object.previousKey')} aria-label={t('object.previous')}
              disabled={page.index <= 1}
              onClick={() => object.send({ type: 'object.paged', delta: -1, by: 'button' })}
            >
              <ChevronLeftIcon className="rail-glyph" aria-hidden="true" />
            </button>
            <span className="object-page" aria-live="polite">
              <b>{page.index}</b> / {page.total}
            </span>
            <button
              type="button" className="rail-item" title={t('object.nextKey')} aria-label={t('object.next')}
              disabled={page.index >= page.total}
              onClick={() => object.send({ type: 'object.paged', delta: 1, by: 'button' })}
            >
              <ChevronRightIcon className="rail-glyph" aria-hidden="true" />
            </button>
          </nav>
        )}

        <footer className="object-footer">
          <span>
            {viewingPhoto
              ? (photos.length > 1 ? (touch ? t('object.swipe') : t('object.arrows')) : t('object.onSite'))
              : touch ? t('object.touchHint') : t('object.pointerHint')}
          </span>
          <span>
            {stats && `${t('object.triangles', { n: count(stats.triangles) })} · `}
            <a href={scan.credit.url} target="_blank" rel="noreferrer">{scan.credit.author}</a> {scan.credit.licence}
          </span>
        </footer>
      </section>
    </div>
  );
}
