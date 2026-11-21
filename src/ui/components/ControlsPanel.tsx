import { useSelector } from '@xstate/react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../actors.ts';
import { Panel } from './Panel.tsx';

/** Gestes tactiles et gestes au pointeur : chacun a sa clef de geste et sa clef d'effet. */
const TOUCH = ['drag', 'pinch', 'rotate', 'tilt'] as const;
const POINTER = ['drag', 'wheel', 'right', 'shift', 'arrows', 'zoom'] as const;

/** Mode d'emploi de la navigation, selon que l'on a une souris ou ses doigts. */
export function ControlsPanel() {
  const { t } = useTranslation();
  const touch = useSelector(useApp(), (snapshot) => snapshot.context.support?.touch ?? false);
  const rows: [string, string][] = touch
    ? TOUCH.map((gesture) => [t(`controls.touch.${gesture}`), t(`controls.touch.${gesture}Effect`)])
    : POINTER.map((gesture) => [t(`controls.pointer.${gesture}`), t(`controls.pointer.${gesture}Effect`)]);
  return (
    <Panel id="controls" title={t('controls.title')}>
      <dl className="controls">
        {rows.map(([gesture, effect]) => (
          <div key={gesture} className="control-row">
            <dt><kbd>{gesture}</kbd></dt>
            <dd>{effect}</dd>
          </div>
        ))}
      </dl>
      <p className="controls-note">{t('controls.note')}</p>
    </Panel>
  );
}
