import { useSelector } from '@xstate/react';
import { useEffect, useRef } from 'react';
import { DRONES_LABEL, flightDuration, flightSummary, flightTime, type DroneFlight } from '../../domain/droneFlights.ts';
import { DRONES_LAYER } from '../../machines/scans.layer.ts';
import { layerFeed, layerSelection } from '../../machines/selectionLayer.machine.ts';
import { tourPhase, tourSight } from '../../machines/tour.machine.ts';
import { useChild, useLayer } from '../actors.ts';
import { Panel } from './Panel.tsx';

/**
 * Ce que la caméra du drone a filmé, en petit, calé sur le vol tel qu'il se rejoue dans la carte :
 * les deux lisent la même horloge.
 */
function CameraFeed({ flight }: { flight: DroneFlight }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const element = video.current;
      if (element && element.readyState >= 1) {
        const t = flightTime(flight, performance.now() / 1000);
        // Au bout du vol, la carte marque un temps de repos : la vidéo s'arrête sur sa dernière image au lieu
        // de repartir du début puis d'y être ramenée — c'est ce qui la faisait sauter.
        const last = Math.max(0, Math.min(flightDuration(flight), element.duration || Infinity) - 0.08);
        if (t >= last) {
          if (!element.paused) element.pause();
          if (Math.abs(element.currentTime - last) > 0.05) element.currentTime = last;
        } else {
          // en vol : on la laisse jouer, et on ne la recale que si elle s'écarte vraiment
          if (Math.abs(element.currentTime - t) > 0.35) element.currentTime = t;
          if (element.paused && !element.seeking) void element.play().catch(() => {});
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [flight]);
  return <video ref={video} className="drone-feed" src={flight.video} muted playsInline preload="auto" aria-label="Ce que voit la caméra du drone" />;
}

/** Le champ de la caméra : un cône qui part du drone et découpe son emprise sur le territoire. */
function SightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="4.200" r="1.700" fill="currentColor" stroke="none" />
      <path d="M12 5.500 4.500 17.500M12 5.500l7.500 12" />
      <path d="M4.500 17.500 8 15h8l3.500 2.500L16 20.500H8z" fill="currentColor" fillOpacity="0.22" />
    </svg>
  );
}

/** Vols de drone : la fiche du vol actif, ce que voit sa caméra, et l'entrée dans cette caméra. */
export function DronePanel() {
  const layers = useChild('layers');
  const tour = useChild('tour');
  const layer = useLayer<DroneFlight>(DRONES_LAYER);
  const feed = useSelector(layer, layerFeed);
  const flights = useSelector(layer, (snapshot) => snapshot.context.items);
  const flight = useSelector(layer, layerSelection);
  const inCockpit = useSelector(tour, (snapshot) => tourPhase(snapshot) !== 'idle');
  const sight = useSelector(tour, tourSight);
  const enabled = feed !== 'off';
  const send = (event: { type: 'layers.toggled' } | { type: 'layers.dismissed' } | { type: 'layers.picked'; id: string }) =>
    layers.send({ ...event, layer: DRONES_LAYER });
  const summary = flight ? flightSummary(flight) : null;

  return (
    <Panel id="drones" title={DRONES_LABEL} className="imagery-panel drone-panel">
      {!enabled && (
        <div className="aircraft-empty">
          <p>Le trajet d’un drone dans l’espace, et ce que sa caméra voit.</p>
          <button type="button" className="scene-btn" onClick={() => send({ type: 'layers.toggled' })}>AFFICHER LES VOLS DE DRONE</button>
        </div>
      )}

      {enabled && flight && summary && (
        <section className="aircraft-card" aria-label={`${DRONES_LABEL} : ${flight.name}`}>
          <header className="aircraft-card-header">
            <div className="aircraft-card-title">
              <span className="imagery-kicker">{flight.drone}</span>
              <span className="imagery-name">{flight.name}</span>
            </div>
            <button
              type="button"
              className={sight ? 'drone-tool active' : 'drone-tool'}
              aria-pressed={sight}
              aria-label="Champ de la caméra sur la carte"
              title={sight ? 'Cacher le champ de la caméra' : 'Montrer le champ de la caméra'}
              onClick={() => tour.send({ type: 'tour.sightToggled' })}
            >
              <SightIcon />
            </button>
            <button type="button" className="panel-collapse-btn" aria-label="Désélectionner ce vol" onClick={() => send({ type: 'layers.dismissed' })}>×</button>
          </header>
          {flight.video && <CameraFeed flight={flight} />}
          <dl className="aircraft-telemetry imagery-details">
            <div><dt>Trajet</dt><dd>{Math.round(summary.metres)} m · {Math.round(summary.seconds)} s</dd></div>
            <div><dt>Vitesse</dt><dd>{Math.round(summary.kmh)} km/h</dd></div>
            <div><dt>Date</dt><dd>{flight.date ?? 'inconnue'}</dd></div>
            <div><dt>Images</dt><dd>{flight.credit.author} · {flight.credit.licence}</dd></div>
          </dl>
          <div className="cctv-controls">
            <button
              type="button"
              className={inCockpit ? 'scene-btn active' : 'scene-btn'}
              aria-pressed={inCockpit}
              title="Voir par la caméra du drone : refaire son vol, à sa vitesse"
              onClick={() => tour.send(inCockpit ? { type: 'tour.left' } : { type: 'tour.requested', flight })}
            >
              {inCockpit ? 'QUITTER LE COCKPIT' : 'VUE COCKPIT'}
            </button>
            <button type="button" className="scene-btn" onClick={() => send({ type: 'layers.picked', id: flight.id })}>SITUER SUR LA CARTE</button>
          </div>
        </section>
      )}

      {enabled && (
        <ul className="search-results aircraft-list" aria-label="Vols de drone">
          {flights.map((item) => (
            <li key={item.id}>
              <button type="button" className="search-result" aria-current={item.id === flight?.id} onClick={() => send({ type: 'layers.picked', id: item.id })}>
                <span className="search-result-name">{item.name}</span>
                <span className="search-result-meta">{item.drone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
