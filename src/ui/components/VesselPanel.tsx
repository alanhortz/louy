import { useSelector } from '@xstate/react';
import { useTranslation } from 'react-i18next';
import { VESSEL_ATTRIBUTION, vesselLabel, vesselStateLabel, type Vessel } from '../../domain/vessels.ts';
import { selectedVessel, vesselsFeed } from '../../machines/vessels.machine.ts';
import { t } from '../../i18n/index.ts';
import { useChild } from '../actors.ts';
import { ago, tenth, whole } from '../format.ts';
import { Panel } from './Panel.tsx';

/** Ce qu'un bateau annonce, ligne par ligne ; ce qu'il tait n'est pas montré. */
function readings(vessel: Vessel): [string, string][] {
  const rows: [string, string][] = [];
  if (vessel.length) rows.push([t('vessels.length'), `${whole().format(vessel.length)} m`]);
  if (vessel.beam) rows.push([t('vessels.beam'), `${tenth().format(vessel.beam)} m`]);
  rows.push([t('vessels.speed'), vessel.moving ? `${tenth().format(vessel.speed)} km/h` : t('vessels.stopped')]);
  if (vessel.moving) rows.push([t('vessels.course'), `${whole().format(vessel.course)}°`]);
  rows.push([t('vessels.seenAt'), ago(vessel.seenAt)]);
  return rows;
}

/** Trafic fluvial : les bateaux des voies navigables, et la fiche de celui que l'on choisit. */
export function VesselPanel() {
  const { t } = useTranslation();
  const actor = useChild('vessels');
  const feed = useSelector(actor, vesselsFeed);
  const list = useSelector(actor, (snapshot) => snapshot.context.list);
  const vessel = useSelector(actor, selectedVessel);
  const enabled = feed !== 'off';
  const underway = list.filter((item) => item.moving).length;
  // les bateaux en route d'abord, puis les plus longs
  const listed = [...list].sort((a, b) => Number(b.moving) - Number(a.moving) || (b.length ?? 0) - (a.length ?? 0)).slice(0, 40);

  return (
    <Panel id="vessels" title={t('vessels.title')} className="aircraft-panel">
      {!enabled && (
        <div className="aircraft-empty">
          <p>{t('vessels.pitch')}</p>
          <button type="button" className="scene-btn" onClick={() => actor.send({ type: 'vessels.toggled' })}>
            {t('vessels.show')}
          </button>
        </div>
      )}

      {enabled && vessel && (
        <section className="aircraft-card" aria-label={t('vessels.selected')}>
          <header className="aircraft-card-header">
            <div className="aircraft-card-title">
              <span className="aircraft-callsign">{vesselLabel(vessel)}</span>
              <span className="aircraft-identity">{vessel.place ?? t('vessels.inland')}</span>
            </div>
            <button
              type="button"
              className="panel-collapse-btn"
              aria-label={t('vessels.deselect')}
              onClick={() => actor.send({ type: 'vessels.dismissed' })}
            >
              ×
            </button>
          </header>
          <p className="aircraft-phase">{vesselStateLabel(vessel)}</p>
          <dl className="aircraft-telemetry">
            {readings(vessel).map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
          <div className="cctv-controls">
            <button type="button" className="scene-btn" onClick={() => actor.send({ type: 'vessels.locateRequested' })}>
              {t('vessels.locate')}
            </button>
          </div>
        </section>
      )}

      {enabled && (
        <>
          <p className="search-status" role="status">
            {feed === 'loading' ? t('vessels.polling')
              : feed === 'unavailable' ? t('vessels.unavailable')
              : list.length === 0 ? t('vessels.none')
              : t('vessels.count', { count: list.length, underway })}
          </p>
          <ul className="search-results aircraft-list" aria-label={t('vessels.list')}>
            {listed.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="search-result"
                  aria-current={item.id === vessel?.id}
                  onClick={() => actor.send({ type: 'vessels.picked', id: item.id })}
                >
                  <span className="search-result-name">{vesselLabel(item)}</span>
                  <span className="search-result-meta">{[vesselStateLabel(item), item.place].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="vessel-attribution">{t(VESSEL_ATTRIBUTION)}</p>
        </>
      )}
    </Panel>
  );
}
