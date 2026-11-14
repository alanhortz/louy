import {
  ArrowPathIcon, ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon, XMarkIcon,
} from '@heroicons/react/24/outline';
import { useSelector } from '@xstate/react';
import { useEffect, useRef } from 'react';
import { OBJECTS_LABEL } from '../../domain/scans.ts';
import { objectPage, objectPhase } from '../../machines/object.machine.ts';
import { useApp, useChild } from '../actors.ts';
import { count } from '../format.ts';

/**
 * Visionneuse d'objet : un scan maillé, que le visiteur fait tourner et
 * approche. Elle ne décide de rien : chaque bouton, chaque fermeture envoie un
 * événement à la machine `object`, qui en garde la trace.
 */
export function ObjectViewer() {
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
  const canvas = useRef<HTMLCanvasElement>(null);
  const open = phase !== 'closed';

  // la machine attend un canvas à l'ouverture, et de nouveau après un « Réessayer »
  useEffect(() => {
    if (awaitsCanvas && canvas.current) object.send({ type: 'object.canvasAttached', canvas: canvas.current });
  }, [awaitsCanvas, object]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') object.send({ type: 'object.closed', by: 'escape' });
      // dans un groupe, les flèches feuillettent les objets ; la machine ignore les bouts
      else if (event.key === 'ArrowRight') object.send({ type: 'object.paged', delta: 1, by: 'keyboard' });
      else if (event.key === 'ArrowLeft') object.send({ type: 'object.paged', delta: -1, by: 'keyboard' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, object]);

  if (!open || !scan) return null;

  return (
    <div
      className="object-backdrop"
      onClick={(event) => { if (event.target === event.currentTarget) object.send({ type: 'object.closed', by: 'backdrop' }); }}
    >
      <section className="object-viewer" role="dialog" aria-modal="true" aria-label={`${OBJECTS_LABEL} : ${scan.name}`}>
        <header className="object-header">
          <div className="object-title">
            <span className="object-kicker">{OBJECTS_LABEL}</span>
            <h2>{scan.name}</h2>
          </div>
          <div className="object-actions">
            <button
              type="button"
              className="rail-item"
              title="Recadrer la vue"
              aria-label="Recadrer la vue"
              disabled={phase !== 'ready'}
              onClick={() => object.send({ type: 'object.resetRequested' })}
            >
              <ArrowPathIcon className="rail-glyph" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={autoRotate ? 'rail-item active' : 'rail-item'}
              title={autoRotate ? 'Arrêter la rotation' : 'Faire tourner l’objet'}
              aria-label={autoRotate ? 'Arrêter la rotation' : 'Faire tourner l’objet'}
              aria-pressed={autoRotate}
              disabled={phase !== 'ready'}
              onClick={() => object.send({ type: 'object.autoRotateToggled' })}
            >
              {autoRotate
                ? <PauseIcon className="rail-glyph" aria-hidden="true" />
                : <PlayIcon className="rail-glyph" aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="rail-item"
              title="Fermer"
              aria-label="Fermer la visionneuse"
              onClick={() => object.send({ type: 'object.closed', by: 'button' })}
            >
              <XMarkIcon className="rail-glyph" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="object-stage" data-phase={phase}>
          <canvas ref={canvas} tabIndex={0} aria-label={`${scan.name}, objet en 3D`} />
          {phase === 'loading' && (
            <p className="object-status" role="status">Chargement de l’objet… {Math.round(progress * 100)} %</p>
          )}
          {phase === 'suspended' && (
            <p className="object-status" role="status">Affichage interrompu par le système, reprise en cours…</p>
          )}
          {phase === 'failed' && (
            <div className="object-status" role="alert">
              <p>L’objet n’a pas pu être affiché.</p>
              {failure && <p className="object-reason">{failure}</p>}
              <button type="button" className="scene-btn" onClick={() => object.send({ type: 'object.retryRequested' })}>
                RÉESSAYER
              </button>
            </div>
          )}
        </div>

        {page.total > 1 && (
          <nav className="object-pager" aria-label="Objets de ce lieu">
            <button
              type="button" className="rail-item" title="Objet précédent (←)" aria-label="Objet précédent"
              disabled={page.index <= 1}
              onClick={() => object.send({ type: 'object.paged', delta: -1, by: 'button' })}
            >
              <ChevronLeftIcon className="rail-glyph" aria-hidden="true" />
            </button>
            <span className="object-page" aria-live="polite">
              <b>{page.index}</b> / {page.total}
            </span>
            <button
              type="button" className="rail-item" title="Objet suivant (→)" aria-label="Objet suivant"
              disabled={page.index >= page.total}
              onClick={() => object.send({ type: 'object.paged', delta: 1, by: 'button' })}
            >
              <ChevronRightIcon className="rail-glyph" aria-hidden="true" />
            </button>
          </nav>
        )}

        <footer className="object-footer">
          <span>{touch ? 'Un doigt pour tourner · deux doigts pour zoomer' : 'Glisser pour tourner · molette pour zoomer'}</span>
          <span>
            {stats && `${count(stats.triangles)} triangles · `}
            <a href={scan.credit.url} target="_blank" rel="noreferrer">{scan.credit.author}</a> {scan.credit.licence}
          </span>
        </footer>
      </section>
    </div>
  );
}
