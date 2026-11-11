import { useSelector } from '@xstate/react';
import { useApp } from '../actors.ts';
import { Panel } from './Panel.tsx';

type Control = readonly [gesture: string, effect: string];

const TOUCH: readonly Control[] = [
  ['1 doigt', 'Glisser pour déplacer la carte'],
  ['Pincer', 'Écarter ou rapprocher deux doigts pour zoomer'],
  ['Tourner', 'Faire pivoter deux doigts pour changer de cap'],
  ['2 doigts ↕', 'Glisser deux doigts vers le haut ou le bas pour incliner la vue'],
];

const POINTER: readonly Control[] = [
  ['Glisser', 'Déplacer la carte'],
  ['Molette', 'Zoomer vers le curseur'],
  ['Clic droit', 'Glisser pour pivoter et incliner la vue'],
  ['Maj + glisser', 'Pivoter et incliner, sans clic droit'],
  ['← ↑ ↓ →', 'Déplacer la carte au clavier'],
  ['+ −', 'Zoomer au clavier'],
];

/** Mode d'emploi de la navigation, selon que l'on a une souris ou ses doigts. */
export function ControlsPanel() {
  const touch = useSelector(useApp(), (snapshot) => snapshot.context.support?.touch ?? false);
  return (
    <Panel id="controls" title="Navigation">
      <dl className="controls">
        {(touch ? TOUCH : POINTER).map(([gesture, effect]) => (
          <div key={gesture} className="control-row">
            <dt><kbd>{gesture}</kbd></dt>
            <dd>{effect}</dd>
          </div>
        ))}
      </dl>
      <p className="controls-note">
        La loupe, en haut, emmène directement au-dessus d’un site touristique.
      </p>
    </Panel>
  );
}
