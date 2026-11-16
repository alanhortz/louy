import {
  ClockIcon, CubeTransparentIcon, HeartIcon, LifebuoyIcon, MapIcon, PaintBrushIcon, PaperAirplaneIcon, PhotoIcon, PuzzlePieceIcon, TagIcon, VideoCameraIcon, ViewColumnsIcon,
} from '@heroicons/react/24/outline';
import { useSelector } from '@xstate/react';
import type { ReactNode } from 'react';
import { AERIAL_LABEL, ART_LABEL, FUN_LABEL, OBJECTS_LABEL, SURVIVAL_LABEL, type Scan } from '../../domain/scans.ts';
import { STREET_SOURCE } from '../../domain/streets.ts';
import { VESSEL_SOURCE } from '../../domain/vessels.ts';
import { aircraftFeed } from '../../machines/aircraft.machine.ts';
import { camerasFeed } from '../../machines/cameras.machine.ts';
import { placesStatus, type LayerFeed } from '../../machines/places.machine.ts';
import { motorwaysAvailable, motorwaysFeed } from '../../machines/motorways.machine.ts';
import { AERIAL_LAYER, ART_LAYER, FUN_LAYER, OBJECTS_LAYER, SURVIVAL_LAYER } from '../../machines/scans.layer.ts';
import { layerAvailable, layerFeed } from '../../machines/selectionLayer.machine.ts';
import { streetsCount, streetsFeed, streetsOutOfRange } from '../../machines/streets.machine.ts';
import { vesselsFeed } from '../../machines/vessels.machine.ts';
import { AIRCRAFT_SOURCE } from '../../services/aircraft.ts';
import { FILMS_LABEL } from '../../domain/timeline.ts';
import { filmsFeed } from '../../machines/films.machine.ts';
import { CAMERA_SOURCE } from '../../services/cameras.ts';
import { useChild, useLayer } from '../actors.ts';
import { ago, count } from '../format.ts';
import { Panel } from './Panel.tsx';

const FEED_LABEL: Record<LayerFeed, string> = {
  off: 'OFF',
  nominal: 'ON',
  loading: 'CHARGEMENT',
  degraded: 'PARTIEL',
  unavailable: 'INDISPONIBLE',
};

interface LayerRowProps {
  icon: ReactNode;
  name: string;
  count: number;
  feed: LayerFeed;
  meta: string;
  onToggle: () => void;
}

/** Une ligne de calque : la pastille dit l'état en toutes lettres, sans icône ni curseur. */
function LayerRow({ icon, name, count: total, feed, meta, onToggle }: LayerRowProps) {
  const active = feed !== 'off';
  return (
    <div className="data-toggle-row">
      <div className="data-toggle-top">
        <div className="data-toggle-left">
          <span className="data-icon">{icon}</span>
          <span className="data-name">{name}</span>
        </div>
        <div className="data-toggle-right">
          <span className="data-count">{count(active ? total : 0)}</span>
          <button
            type="button"
            className={`data-toggle-btn ${active ? `active feed-${feed}` : ''}`}
            aria-pressed={active}
            aria-label={`${name} : ${FEED_LABEL[feed]}`}
            onClick={onToggle}
          >
            {FEED_LABEL[feed]}
          </button>
        </div>
      </div>
      <div className="data-toggle-meta">{meta}</div>
    </div>
  );
}

function PlacesRow() {
  const places = useChild('places');
  const status = useSelector(places, placesStatus, (a, b) =>
    a.feed === b.feed && a.count === b.count && a.origin === b.origin && a.refreshing === b.refreshing);

  const provenance = status.origin === null
    ? (status.feed === 'loading' ? 'chargement…' : 'jamais chargé')
    : status.origin === 'snapshot'
      ? (status.refreshing ? 'instantané · mise à jour…' : 'instantané')
      : `${status.origin === 'cache' ? 'cache du navigateur' : 'en direct'} · ${ago(status.storedAt ?? Date.now())}`;

  return (
    <LayerRow
      icon={<TagIcon aria-hidden="true" />}
      name="Noms de lieux"
      count={status.count}
      feed={status.feed}
      meta={`OpenStreetMap · ${provenance}`}
      onToggle={() => places.send({ type: 'places.toggled' })}
    />
  );
}

/** Noms de rues : demandés dalle par dalle autour de la vue, lisibles seulement de près. */
function StreetsRow() {
  const streets = useChild('streets');
  const feed = useSelector(streets, streetsFeed);
  const total = useSelector(streets, streetsCount);
  const tooFar = useSelector(streets, streetsOutOfRange);

  return (
    <LayerRow
      icon={<MapIcon aria-hidden="true" />}
      name="Noms de rues"
      count={total}
      feed={feed}
      meta={`${STREET_SOURCE} · ${tooFar ? 'rapprochez-vous pour les lire' : 'visibles de près'}`}
      onToggle={() => streets.send({ type: 'streets.toggled' })}
    />
  );
}

function CamerasRow() {
  const cameras = useChild('cameras');
  const feed = useSelector(cameras, camerasFeed);
  const total = useSelector(cameras, (snapshot) => snapshot.context.cameras.length);
  const loadedAt = useSelector(cameras, (snapshot) => snapshot.context.loadedAt);

  return (
    <LayerRow
      icon={<VideoCameraIcon aria-hidden="true" />}
      name="Caméras routières"
      count={total}
      feed={feed}
      meta={`${CAMERA_SOURCE} · ${loadedAt === null ? 'jamais chargé' : ago(loadedAt)}`}
      onToggle={() => cameras.send({ type: 'cameras.toggled' })}
    />
  );
}

/** Avions en direct : positions relevées toutes les quelques secondes. */
function AircraftRow() {
  const aircraft = useChild('aircraft');
  const feed = useSelector(aircraft, aircraftFeed);
  const total = useSelector(aircraft, (snapshot) => snapshot.context.list.length);
  const updatedAt = useSelector(aircraft, (snapshot) => snapshot.context.updatedAt);

  return (
    <LayerRow
      icon={<PaperAirplaneIcon aria-hidden="true" />}
      name="Avions en direct"
      count={total}
      feed={feed}
      meta={`${AIRCRAFT_SOURCE} · ${updatedAt === null ? 'jamais relevé' : 'en direct'}`}
      onToggle={() => aircraft.send({ type: 'aircraft.toggled' })}
    />
  );
}

function VesselsRow() {
  const vessels = useChild('vessels');
  const feed = useSelector(vessels, vesselsFeed);
  const total = useSelector(vessels, (snapshot) => snapshot.context.list.length);
  const updatedAt = useSelector(vessels, (snapshot) => snapshot.context.updatedAt);

  return (
    <LayerRow
      icon={<LifebuoyIcon aria-hidden="true" />}
      name="Trafic fluvial"
      count={total}
      feed={feed}
      meta={`${VESSEL_SOURCE} · ${updatedAt === null ? 'jamais relevé' : 'en direct, positions anonymes'}`}
      onToggle={() => vessels.send({ type: 'vessels.toggled' })}
    />
  );
}

/** Un calque tiré des scans : sa ligne n'existe que si le site en publie. */
function ScanLayerRow({ layer, name, icon, meta }: { layer: string; name: string; icon: ReactNode; meta: string }) {
  const layers = useChild('layers');
  const actor = useLayer<Scan>(layer);
  const available = useSelector(actor, layerAvailable);
  const feed = useSelector(actor, layerFeed);
  const total = useSelector(actor, (snapshot) => snapshot.context.items.length);
  if (!available) return null;

  return (
    <LayerRow
      icon={icon}
      name={name}
      count={total}
      feed={feed}
      meta={meta}
      onToggle={() => layers.send({ type: 'layers.toggled', layer })}
    />
  );
}

/** Autoroutes : le tracé posé sur le relief, et ce que disent ses couleurs. */
function MotorwaysRow() {
  const motorways = useChild('motorways');
  const available = useSelector(motorways, motorwaysAvailable);
  const feed = useSelector(motorways, motorwaysFeed);
  const trace = useSelector(motorways, (snapshot) => snapshot.context.traces[0] ?? null);
  if (!available || !trace) return null;
  const legend = trace.legend ?? [];

  return (
    <>
      <LayerRow
        icon={<ViewColumnsIcon aria-hidden="true" />}
        name="Autoroutes"
        count={new Set((trace.labels ?? []).map((label) => label.text)).size}
        feed={feed}
        meta={`${trace.credit.author} · tracé posé sur le relief, numéros le long des routes`}
        onToggle={() => motorways.send({ type: 'motorways.toggled' })}
      />
      {feed !== 'off' && legend.length > 0 && (
        <ul className="imagery-legend layers-legend" aria-label="Couleurs des autoroutes">
          {legend.map((entry) => (
            <li key={entry.label}>
              <span className="imagery-swatch" style={{ background: entry.colour }} aria-hidden="true" />
              {entry.label}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Films du temps : les lieux dont l'évolution, d'une photo aérienne à l'autre, vaut d'être regardée. */
function FilmsRow() {
  const films = useChild('films');
  const feed = useSelector(films, filmsFeed);
  const places = useSelector(films, (snapshot) => snapshot.context.places);

  return (
    <LayerRow
      icon={<ClockIcon aria-hidden="true" />}
      name={FILMS_LABEL}
      count={places.length}
      feed={feed}
      meta={`${places.map((place) => place.name).join(' — ')} · orthophotos SPW, toucher un marqueur lance le film`}
      onToggle={() => films.send({ type: 'films.toggled' })}
    />
  );
}

/** Calques en superposition. */
export function LayersPanel() {
  return (
    <Panel id="layers" title="Calques">
      <div className="data-toggle-list">
        <PlacesRow />
        <StreetsRow />
        <CamerasRow />
        <AircraftRow />
        <VesselsRow />
        <MotorwaysRow />
        <ScanLayerRow layer={AERIAL_LAYER} name={AERIAL_LABEL} icon={<PhotoIcon aria-hidden="true" />} meta="Lieux filmés au drone, reconstruits en volume" />
        <ScanLayerRow layer={OBJECTS_LAYER} name={OBJECTS_LABEL} icon={<CubeTransparentIcon aria-hidden="true" />} meta="Relevés sur place, au téléphone" />
        <ScanLayerRow layer={ART_LAYER} name={ART_LABEL} icon={<PaintBrushIcon aria-hidden="true" />} meta="Fresques, lettrages et détails peints, relevés dans la rue" />
        <ScanLayerRow layer={SURVIVAL_LAYER} name={SURVIVAL_LABEL} icon={<HeartIcon aria-hidden="true" />} meta="Défibrillateurs relevés sur place" />
        <ScanLayerRow layer={FUN_LAYER} name={FUN_LABEL} icon={<PuzzlePieceIcon aria-hidden="true" />} meta="Jeux et curiosités relevés sur place" />
        <FilmsRow />
      </div>
    </Panel>
  );
}
