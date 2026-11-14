import { useSelector } from '@xstate/react';
import { aircraftPhase, militaryLabel, phaseLabel, type Aircraft } from '../../domain/aircraft.ts';
import { aircraftFeed, listedAircraft, selectedAircraft } from '../../machines/aircraft.machine.ts';
import { AIRCRAFT_SOURCE } from '../../services/aircraft.ts';
import { useChild } from '../actors.ts';
import { ROUTE_SOURCE } from '../../domain/flightRoute.ts';
import { trajectoryCursor, trajectoryRoute } from '../../machines/trajectory.machine.ts';
import { AircraftPhoto } from './AircraftPhoto.tsx';
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

const minutes = (seconds: number) => (seconds < 60 ? `${Math.round(seconds)} s` : seconds < 3600 ? `${Math.round(seconds / 60)} min` : `${Math.floor(seconds / 3600)} h ${String(Math.round((seconds % 3600) / 60)).padStart(2, '0')}`);

/** Ce que le curseur désigne : à quel moment, à quelle altitude, à quelle vitesse. */
function timeLabel(offset: number, point: { altitude: number | null; speed: number }): string {
  const when = offset < 0 ? `Il y a ${minutes(-offset)}` : `Dans ${minutes(offset)} (estimé)`;
  return `${when} · ${point.altitude === null ? 'au sol' : `${whole.format(point.altitude)} m`} · ${whole.format(point.speed * 3.6)} km/h`;
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
  const trajectory = useChild('trajectory');
  const route = useSelector(trajectory, trajectoryRoute);
  const cursor = useSelector(trajectory, trajectoryCursor, (a, b) =>
    a.earliest === b.earliest && a.latest === b.latest && a.offset === b.offset && a.point?.altitude === b.point?.altitude);
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
            <div className="aircraft-card-title">
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
          <AircraftPhoto type={aircraft.type} category={aircraft.category} />
          {route && (
            <p className="aircraft-route" title={`Liaison habituelle de ce vol, d’après son indicatif (source : ${ROUTE_SOURCE})`}>
              <span className="aircraft-route-end">
                <strong>{route.origin.city}</strong>
                <small>{route.origin.code}</small>
              </span>
              <span className="aircraft-route-arrow" aria-label="vers">→</span>
              <span className="aircraft-route-end">
                <strong>{route.destination.city}</strong>
                <small>{route.destination.code}</small>
              </span>
              <span className="aircraft-route-note">
                {[route.airline, `liaison habituelle · ${ROUTE_SOURCE}`].filter(Boolean).join(' · ')}
              </span>
            </p>
          )}
          <p className="aircraft-phase">
            {phaseLabel(aircraftPhase(aircraft))}
            {militaryLabel(aircraft) && <span className="aircraft-military" data-military={aircraft.military}>{militaryLabel(aircraft)}</span>}
          </p>
          <dl className="aircraft-telemetry">
            {telemetry(aircraft).map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
          <label className="aircraft-time">
            <span>Trajectoire</span>
            <output>{cursor.point ? timeLabel(cursor.offset, cursor.point) : 'Maintenant'}</output>
            <input
              type="range"
              // arrondi au pas du curseur : sans cela, « maintenant » tomberait entre deux crans
              min={Math.floor(cursor.earliest / 10) * 10}
              max={cursor.latest}
              step={10}
              value={cursor.offset}
              disabled={cursor.earliest === 0 && cursor.latest === 0}
              aria-label="Instant du vol : du premier relevé aux prochaines minutes"
              onChange={(event) => trajectory.send({ type: 'trajectory.scrubbed', offset: Number(event.target.value) })}
            />
            <span className="aircraft-time-ends">
              <span>{cursor.earliest < 0 ? `il y a ${minutes(-cursor.earliest)}` : 'vu à l’instant'}</span>
              <span>{cursor.latest > 0 ? `estimation +${minutes(cursor.latest)}` : ''}</span>
            </span>
          </label>
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
