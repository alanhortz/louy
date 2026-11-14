import { useSelector } from '@xstate/react';
import { aircraftPhase, phaseLabel, type Aircraft } from '../../domain/aircraft.ts';
import { aircraftFeed, listedAircraft, selectedAircraft } from '../../machines/aircraft.machine.ts';
import { AIRCRAFT_SOURCE } from '../../services/aircraft.ts';
import { useChild } from '../actors.ts';
import { Panel } from './Panel.tsx';

const whole = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 });
const hundredth = new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });

const FOOT = 0.3048;
const KNOT = 0.514444;
const heading = (degrees: number) => `${String(Math.round(degrees) % 360).padStart(3, '0')}°`;

/** Télémétrie d'un appareil : ce que son transpondeur diffuse, converti en unités métriques (et aéronautiques). */
function telemetry(aircraft: Aircraft): [string, string][] {
  const rows: [string, string][] = [
    ['Altitude', aircraft.altitude === null ? 'au sol' : `${whole.format(aircraft.altitude)} m · ${whole.format(aircraft.altitude / FOOT)} ft`],
    ['Vitesse sol', `${whole.format(aircraft.speed * 3.6)} km/h · ${whole.format(aircraft.speed / KNOT)} kt`],
    ['Route', heading(aircraft.track)],
    ['Vitesse verticale', aircraft.onGround ? '—' : `${signed.format(aircraft.verticalRate)} m/s`],
  ];
  if (aircraft.selectedAltitude !== null) rows.push(['Altitude sélectionnée', `${whole.format(aircraft.selectedAltitude)} m`]);
  if (aircraft.indicatedSpeed !== null) rows.push(['Vitesse indiquée', `${whole.format(aircraft.indicatedSpeed * 3.6)} km/h`]);
  if (aircraft.mach !== null) rows.push(['Mach', hundredth.format(aircraft.mach)]);
  if (aircraft.wind) rows.push(['Vent', `${heading(aircraft.wind.from)} · ${whole.format(aircraft.wind.speed * 3.6)} km/h`]);
  if (aircraft.temperature !== null) rows.push(['Température extérieure', `${whole.format(aircraft.temperature)} °C`]);
  if (aircraft.squawk) rows.push(['Code transpondeur', aircraft.squawk]);
  return rows;
}

/** Avions en direct : chercher un vol, lire sa télémétrie, prendre place au poste de pilotage. */
export function AircraftPanel() {
  const actor = useChild('aircraft');
  const feed = useSelector(actor, aircraftFeed);
  const query = useSelector(actor, (snapshot) => snapshot.context.query);
  const total = useSelector(actor, (snapshot) => snapshot.context.list.length);
  const listed = useSelector(actor, listedAircraft, (a, b) => a.length === b.length && a.every((item, at) => item === b[at]));
  const aircraft = useSelector(actor, selectedAircraft);
  const inCockpit = useSelector(actor, (snapshot) => snapshot.context.inCockpit);
  const enabled = feed !== 'off';

  return (
    <Panel id="aircraft" title="Avions" className="aircraft-panel">
      {!enabled && (
        <div className="aircraft-empty">
          <p>Les avions qui survolent la Wallonie, en direct, avec leur altitude et leur route.</p>
          <button type="button" className="scene-btn" onClick={() => actor.send({ type: 'aircraft.toggled' })}>
            AFFICHER LES AVIONS
          </button>
        </div>
      )}

      {enabled && aircraft && (
        <section className="aircraft-card" aria-label={`Vol ${aircraft.callsign}`}>
          <header className="aircraft-card-header">
            <div>
              <span className="aircraft-callsign">{aircraft.callsign}</span>
              <span className="aircraft-identity">
                {[aircraft.type, aircraft.registration].filter(Boolean).join(' · ') || 'appareil non identifié'}
              </span>
            </div>
            <button
              type="button"
              className="panel-collapse-btn"
              aria-label="Désélectionner ce vol"
              onClick={() => actor.send({ type: 'aircraft.dismissed' })}
            >
              ×
            </button>
          </header>
          <p className="aircraft-phase">{phaseLabel(aircraftPhase(aircraft))}</p>
          <dl className="aircraft-telemetry">
            {telemetry(aircraft).map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
          <div className="cctv-controls">
            <button
              type="button"
              className={inCockpit ? 'scene-btn active' : 'scene-btn'}
              aria-pressed={inCockpit}
              onClick={() => actor.send({ type: inCockpit ? 'aircraft.cockpitLeft' : 'aircraft.cockpitRequested' })}
            >
              {inCockpit ? 'QUITTER LE COCKPIT' : 'VUE COCKPIT'}
            </button>
            <button type="button" className="scene-btn" onClick={() => actor.send({ type: 'aircraft.locateRequested' })}>
              SITUER SUR LA CARTE
            </button>
          </div>
        </section>
      )}

      {enabled && (
        <>
          <div className="search-field aircraft-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
            <input
              type="search"
              value={query}
              placeholder="Vol, immatriculation, type…"
              aria-label="Chercher un vol par indicatif, immatriculation ou type d’appareil"
              autoComplete="off"
              onChange={(event) => actor.send({ type: 'aircraft.queryChanged', query: event.target.value })}
            />
          </div>
          <p className="search-status" role="status">
            {feed === 'loading' ? 'Relevé en cours…'
              : feed === 'unavailable' ? 'Positions indisponibles — nouvel essai dans un instant'
              : query ? `${listed.length} vol${listed.length > 1 ? 's' : ''} sur ${total}`
              : `${total} appareil${total > 1 ? 's' : ''} au-dessus de la Wallonie · ${AIRCRAFT_SOURCE}`}
          </p>
          <ul className="search-results aircraft-list" aria-label="Vols">
            {listed.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="search-result"
                  aria-current={item.id === aircraft?.id}
                  onClick={() => actor.send({ type: 'aircraft.picked', id: item.id })}
                >
                  <span className="search-result-name">{item.callsign}</span>
                  <span className="search-result-meta">
                    {[item.type, item.altitude === null ? 'au sol' : `${whole.format(item.altitude)} m`].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
