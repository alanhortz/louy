import { XMarkIcon } from '@heroicons/react/24/outline';
import { useSelector } from '@xstate/react';
import { useTranslation } from 'react-i18next';
import { selectedAircraft } from '../../machines/aircraft.machine.ts';
import { useChild } from '../actors.ts';

/**
 * Sortie de la vue cockpit : un bouton discret au bas de l'écran, avec l'indicatif
 * du vol dont on occupe le poste de pilotage. Le même sur grand et sur petit
 * écran ; sur petit écran, le rail et les panneaux s'effacent en plus (cockpit.css).
 */
export function CockpitExit() {
  const { t } = useTranslation();
  const actor = useChild('aircraft');
  const inCockpit = useSelector(actor, (snapshot) => snapshot.context.inCockpit);
  const callsign = useSelector(actor, (snapshot) => selectedAircraft(snapshot)?.callsign ?? null);
  if (!inCockpit) return null;

  return (
    <button
      type="button"
      className="cockpit-exit"
      aria-label={callsign ? t('cockpit.leaveFlight', { callsign }) : t('cockpit.leave')}
      onClick={() => actor.send({ type: 'aircraft.cockpitLeft' })}
    >
      <span className="cockpit-exit-flight">{callsign ?? t('cockpit.fallback')}</span>
      <span className="cockpit-exit-label">{t('cockpit.leave')}</span>
      <XMarkIcon aria-hidden="true" />
    </button>
  );
}
