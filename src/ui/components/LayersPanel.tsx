import { ClockIcon, CubeTransparentIcon, PaperAirplaneIcon, TagIcon, VideoCameraIcon } from '@heroicons/react/24/outline';
import { useSelector } from '@xstate/react';
import type { ReactNode } from 'react';
import { SCANS_LABEL, isObjectScan, type Scan } from '../../domain/scans.ts';
import { aircraftFeed } from '../../machines/aircraft.machine.ts';
import { camerasFeed } from '../../machines/cameras.machine.ts';
import { placesStatus, type LayerFeed } from '../../machines/places.machine.ts';
import { SCANS_LAYER } from '../../machines/scans.layer.ts';
import { layerAvailable, layerFeed } from '../../machines/selectionLayer.machine.ts';
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

/** Ce que le calque contient, en quelques mots : les crédits détaillés sont dans « À propos ». */
function summary(scans: readonly Scan[]): string {
  const objects = scans.filter(isObjectScan).length;
  const places = scans.length - objects;
  return [
    places > 0 && `${places} ${places > 1 ? 'lieux' : 'lieu'}`,
    objects > 0 && `${objects} ${objects > 1 ? 'objets' : 'objet'}`,
  ].filter(Boolean).join(' · ');
}

/** Imagerie 3D (les scans) : la ligne n'existe que si le site en publie. */
function ScansRow() {
  const layers = useChild('layers');
  const scans = useLayer<Scan>(SCANS_LAYER);
  const available = useSelector(scans, layerAvailable);
  const feed = useSelector(scans, layerFeed);
  const list = useSelector(scans, (snapshot) => snapshot.context.items);
  if (!available) return null;

  return (
    <LayerRow
      icon={<CubeTransparentIcon aria-hidden="true" />}
      name={SCANS_LABEL}
      count={list.length}
      feed={feed}
      meta={summary(list)}
      onToggle={() => layers.send({ type: 'layers.toggled', layer: SCANS_LAYER })}
    />
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
        <CamerasRow />
        <AircraftRow />
        <ScansRow />
        <FilmsRow />
      </div>
    </Panel>
  );
}
