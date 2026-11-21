import { useSelector } from '@xstate/react';
import { useTranslation } from 'react-i18next';
import { DEFINITIONS, hasHighDefinition } from '../../domain/definition.ts';
import { chosenDefinition } from '../../machines/settings.machine.ts';
import { AERIAL_LAYER, CLOUD_LAYER, ORTHO_LAYER } from '../../machines/scans.layer.ts';
import type { Scan } from '../../domain/scans.ts';
import { useChild, useLayer } from '../actors.ts';
import { Panel } from './Panel.tsx';

/** Réglages de l'application : ce qui vaut partout, comme dans un lecteur vidéo. */
export function SettingsPanel() {
  const { t } = useTranslation();
  const settings = useChild('settings');
  const definition = useSelector(settings, chosenDefinition);
  // combien de relevés existent dans les deux définitions : ce que le réglage change vraiment
  const count = (layer: string) => useSelector(useLayer<Scan>(layer), (snapshot) => snapshot.context.items.filter(hasHighDefinition).length);
  const available = count(AERIAL_LAYER) + count(ORTHO_LAYER) + count(CLOUD_LAYER);

  return (
    <Panel id="settings" title={t('settings.title')} className="settings-panel">
      <div className="cctv-summary-label">{t('settings.definition')}</div>
      <div className="cctv-controls" role="radiogroup" aria-label={t('settings.definitionLabel')}>
        {DEFINITIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="radio"
            aria-checked={entry.id === definition}
            className={entry.id === definition ? 'scene-btn active' : 'scene-btn'}
            title={t(`settings.${entry.id}Hint`)}
            onClick={() => settings.send({ type: 'settings.definitionChosen', definition: entry.id })}
          >
            {t(`settings.${entry.id}`).toUpperCase()}
          </button>
        ))}
      </div>
      <p className="imagery-note">{t(`settings.${definition}Hint`)}</p>
      <p className="imagery-note">
        {available > 0 ? t('settings.available', { count: available }) : t('settings.none')}
      </p>
    </Panel>
  );
}
