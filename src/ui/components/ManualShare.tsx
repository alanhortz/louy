import { useSelector } from '@xstate/react';
import { useTranslation } from 'react-i18next';
import { useChild } from '../actors.ts';

/** Dernier recours du partage : le lien est affiché, sélectionné, à copier à la main. */
export function ManualShare() {
  const { t } = useTranslation();
  const share = useChild('share');
  const url = useSelector(share, (snapshot) => (snapshot.matches('manual') ? snapshot.context.request?.url : null));
  if (!url) return null;

  return (
    <section className="panel manual-share" role="dialog" aria-label={t('share.link')}>
      <div className="panel-glow" />
      <div className="panel-inner">
        <header className="panel-header">
          <span className="panel-title">{t('share.title')}</span>
          <span className="panel-divider" />
          <button
            type="button"
            className="panel-collapse-btn"
            aria-label={t('share.close')}
            onClick={() => share.send({ type: 'share.acknowledged' })}
          >
            ×
          </button>
        </header>
        <input readOnly value={url} aria-label={t('share.link')} autoFocus onFocus={(event) => event.target.select()} />
      </div>
    </section>
  );
}
