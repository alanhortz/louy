import { useSelector } from '@xstate/react';
import { useChild } from '../actors.ts';

/** Dernier recours du partage : le lien est affiché, sélectionné, à copier à la main. */
export function ManualShare() {
  const share = useChild('share');
  const url = useSelector(share, (snapshot) => (snapshot.matches('manual') ? snapshot.context.request?.url : null));
  if (!url) return null;

  return (
    <section className="panel manual-share" role="dialog" aria-label="Lien de la vue">
      <div className="panel-glow" />
      <div className="panel-inner">
        <header className="panel-header">
          <span className="panel-title">Copiez ce lien</span>
          <span className="panel-divider" />
          <button
            type="button"
            className="panel-collapse-btn"
            aria-label="Fermer"
            onClick={() => share.send({ type: 'share.acknowledged' })}
          >
            ×
          </button>
        </header>
        <input readOnly value={url} aria-label="Lien de la vue" autoFocus onFocus={(event) => event.target.select()} />
      </div>
    </section>
  );
}
