import { useSelector } from '@xstate/react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
  return <video ref={video} className="drone-feed" src={flight.video} muted playsInline preload="auto" aria-label={t('drones.feed')} />;
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
  const { t } = useTranslation();
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
    <Panel id="drones" title={t(DRONES_LABEL)} className="imagery-panel drone-panel">
      {!enabled && (
        <div className="aircraft-empty">
          <p>{t('drones.pitch')}</p>
          <button type="button" className="scene-btn" onClick={() => send({ type: 'layers.toggled' })}>{t('drones.show')}</button>
        </div>
      )}

      {enabled && flight && summary && (
        <section className="aircraft-card" aria-label={`${t(DRONES_LABEL)} : ${flight.name}`}>
          <header className="aircraft-card-header">
            <div className="aircraft-card-title">
              <span className="imagery-kicker">{flight.drone}</span>
              <span className="imagery-name">{flight.name}</span>
            </div>
            <button
              type="button"
              className={sight ? 'drone-tool active' : 'drone-tool'}
              aria-pressed={sight}
              aria-label={t('drones.sight')}
              title={sight ? t('drones.sightHide') : t('drones.sightShow')}
              onClick={() => tour.send({ type: 'tour.sightToggled' })}
            >
              <SightIcon />
            </button>
            <button type="button" className="panel-collapse-btn" aria-label={t('drones.deselect')} onClick={() => send({ type: 'layers.dismissed' })}>×</button>
          </header>
          {flight.video && <CameraFeed flight={flight} />}
          <dl className="aircraft-telemetry imagery-details">
            <div><dt>{t('drones.path')}</dt><dd>{Math.round(summary.metres)} m · {Math.round(summary.seconds)} s</dd></div>
            <div><dt>{t('drones.speed')}</dt><dd>{Math.round(summary.kmh)} km/h</dd></div>
            <div><dt>{t('drones.date')}</dt><dd>{flight.date ?? t('drones.unknownDate')}</dd></div>
            <div><dt>{t('drones.images')}</dt><dd>{flight.credit.author} · {flight.credit.licence}</dd></div>
          </dl>
          <div className="cctv-controls">
            <button
              type="button"
              className={inCockpit ? 'scene-btn active' : 'scene-btn'}
              aria-pressed={inCockpit}
              title={t('drones.cockpitHint')}
              onClick={() => tour.send(inCockpit ? { type: 'tour.left' } : { type: 'tour.requested', flight })}
            >
              {inCockpit ? t('drones.leaveCockpit') : t('drones.cockpit')}
            </button>
            <button type="button" className="scene-btn" onClick={() => send({ type: 'layers.picked', id: flight.id })}>{t('drones.locate')}</button>
          </div>
        </section>
      )}

      {enabled && (
        <ul className="search-results aircraft-list" aria-label={t('drones.list')}>
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
