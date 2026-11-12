import { CubeTransparentIcon, TagIcon, VideoCameraIcon } from '@heroicons/react/24/outline';
import { useSelector } from '@xstate/react';
import type { ReactNode } from 'react';
import { SCANS_LABEL } from '../../domain/scans.ts';
import { camerasFeed } from '../../machines/cameras.machine.ts';
import { placesStatus, type LayerFeed } from '../../machines/places.machine.ts';
import { hasScans, scansFeed } from '../../machines/scans.machine.ts';
import { CAMERA_SOURCE } from '../../services/cameras.ts';
import { useChild } from '../actors.ts';
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

/** Imagerie 3D (les scans) : la ligne n'existe que si le site en publie. */
function ScansRow() {
  const scans = useChild('scans');
  const available = useSelector(scans, hasScans);
  const feed = useSelector(scans, scansFeed);
  const list = useSelector(scans, (snapshot) => snapshot.context.scans);
  if (!available) return null;

  return (
    <LayerRow
      icon={<CubeTransparentIcon aria-hidden="true" />}
      name={SCANS_LABEL}
      count={list.length}
      feed={feed}
      meta={list.map((scan) => `${scan.name} · images ${scan.credit.author}, ${scan.credit.licence}`).join(' — ')}
      onToggle={() => scans.send({ type: 'scans.toggled' })}
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
        <ScansRow />
      </div>
    </Panel>
  );
}
