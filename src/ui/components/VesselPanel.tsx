import { useSelector } from '@xstate/react';
import { VESSEL_ATTRIBUTION, vesselLabel, vesselStateLabel, type Vessel } from '../../domain/vessels.ts';
import { selectedVessel, vesselsFeed } from '../../machines/vessels.machine.ts';
import { useChild } from '../actors.ts';
import { ago } from '../format.ts';
import { Panel } from './Panel.tsx';

const whole = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 });
const tenth = new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Ce qu'un bateau annonce, ligne par ligne ; ce qu'il tait n'est pas montré. */
function readings(vessel: Vessel): [string, string][] {
  const rows: [string, string][] = [];
  if (vessel.length) rows.push(['Longueur', `${whole.format(vessel.length)} m`]);
  if (vessel.beam) rows.push(['Largeur', `${tenth.format(vessel.beam)} m`]);
  rows.push(['Vitesse', vessel.moving ? `${tenth.format(vessel.speed)} km/h` : 'à l’arrêt']);
  if (vessel.moving) rows.push(['Route', `${whole.format(vessel.course)}°`]);
  rows.push(['Position relevée', ago(vessel.seenAt)]);
  return rows;
}

/** Trafic fluvial : les bateaux des voies navigables, et la fiche de celui que l'on choisit. */
export function VesselPanel() {
  const actor = useChild('vessels');
  const feed = useSelector(actor, vesselsFeed);
  const list = useSelector(actor, (snapshot) => snapshot.context.list);
  const vessel = useSelector(actor, selectedVessel);
  const enabled = feed !== 'off';
  const underway = list.filter((item) => item.moving).length;
  // les bateaux en route d'abord, puis les plus longs
  const listed = [...list].sort((a, b) => Number(b.moving) - Number(a.moving) || (b.length ?? 0) - (a.length ?? 0)).slice(0, 40);

  return (
    <Panel id="vessels" title="Bateaux" className="aircraft-panel">
      {!enabled && (
        <div className="aircraft-empty">
          <p>Les bateaux sur les voies navigables de Wallonie, en direct. Leurs positions sont anonymes : ni nom, ni numéro.</p>
          <button type="button" className="scene-btn" onClick={() => actor.send({ type: 'vessels.toggled' })}>
            AFFICHER LES BATEAUX
          </button>
        </div>
      )}

      {enabled && vessel && (
        <section className="aircraft-card" aria-label="Bateau sélectionné">
          <header className="aircraft-card-header">
            <div className="aircraft-card-title">
              <span className="aircraft-callsign">{vesselLabel(vessel)}</span>
              <span className="aircraft-identity">{vessel.place ?? 'bateau de navigation intérieure'}</span>
            </div>
            <button
              type="button"
              className="panel-collapse-btn"
              aria-label="Désélectionner ce bateau"
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
              SITUER SUR LA CARTE
            </button>
          </div>
        </section>
      )}

      {enabled && (
        <>
          <p className="search-status" role="status">
            {feed === 'loading' ? 'Relevé en cours…'
              : feed === 'unavailable' ? 'EuRIS ne répond pas — nouvel essai dans un instant'
              : list.length === 0 ? 'Aucun bateau signalé en Wallonie pour le moment'
              : `${list.length} bateau${list.length > 1 ? 'x' : ''}, dont ${underway} en route`}
          </p>
          <ul className="search-results aircraft-list" aria-label="Bateaux">
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
          <p className="vessel-attribution">{VESSEL_ATTRIBUTION}</p>
        </>
      )}
    </Panel>
  );
}
