import { useSelector } from '@xstate/react';
import { DEFINITIONS, hasHighDefinition } from '../../domain/definition.ts';
import { chosenDefinition } from '../../machines/settings.machine.ts';
import { AERIAL_LAYER, CLOUD_LAYER, ORTHO_LAYER } from '../../machines/scans.layer.ts';
import type { Scan } from '../../domain/scans.ts';
import { useChild, useLayer } from '../actors.ts';
import { Panel } from './Panel.tsx';

/** Réglages de l'application : ce qui vaut partout, comme dans un lecteur vidéo. */
export function SettingsPanel() {
  const settings = useChild('settings');
  const definition = useSelector(settings, chosenDefinition);
  const hint = DEFINITIONS.find((entry) => entry.id === definition)!.hint;
  // combien de relevés existent dans les deux définitions : ce que le réglage change vraiment
  const count = (layer: string) => useSelector(useLayer<Scan>(layer), (snapshot) => snapshot.context.items.filter(hasHighDefinition).length);
  const available = count(AERIAL_LAYER) + count(ORTHO_LAYER) + count(CLOUD_LAYER);

  return (
    <Panel id="settings" title="Réglages" className="settings-panel">
      <div className="cctv-summary-label">DÉFINITION DES RELEVÉS</div>
      <div className="cctv-controls" role="radiogroup" aria-label="Définition des relevés">
        {DEFINITIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="radio"
            aria-checked={entry.id === definition}
            className={entry.id === definition ? 'scene-btn active' : 'scene-btn'}
            title={entry.hint}
            onClick={() => settings.send({ type: 'settings.definitionChosen', definition: entry.id })}
          >
            {entry.label.toUpperCase()}
          </button>
        ))}
      </div>
      <p className="imagery-note">{hint}</p>
      <p className="imagery-note">
        {available > 0
          ? `${available} relevé${available > 1 ? 's existent' : ' existe'} dans les deux définitions : passez de l’une à l’autre pour comparer. Les autres restent en standard.`
          : 'Aucun relevé n’existe encore en haute définition : tout reste affiché en standard.'}
      </p>
    </Panel>
  );
}
