import { useSelector } from '@xstate/react';
import { AERIAL_LABEL, CLOUD_LABEL, ORTHO_LABEL, isWalkable, walkStart, type Scan } from '../../domain/scans.ts';
import { AERIAL_LAYER, CLOUD_LAYER, ORTHO_LAYER } from '../../machines/scans.layer.ts';
import { layerFeed, layerKept, layerSelection } from '../../machines/selectionLayer.machine.ts';
import { useApp, useChild, useLayer } from '../actors.ts';
import type { PanelId } from '../../machines/chrome.machine.ts';
import { Panel } from './Panel.tsx';

/**
 * Imagerie aérienne : la fiche du lieu sélectionné — ce que c'est, d'où viennent
 * les images — et le choix de le garder affiché dans la carte pendant que l'on
 * en regarde un autre. Sans sélection, la liste des lieux disponibles.
 *
 * Les orthophotos de drone et les nuages de points se dessinent de même : chacun
 * a son panneau, bâti sur ce même gabarit.
 */
const KINDS: Record<string, { panel: PanelId; title: string; label: string; pitch: string; show: string; note: string }> = {
  [AERIAL_LAYER]: {
    panel: 'imagery',
    title: 'Imagerie',
    label: AERIAL_LABEL,
    pitch: 'Des lieux filmés au drone et reconstruits en volume, posés sur le relief.',
    show: 'AFFICHER L’IMAGERIE AÉRIENNE',
    note: 'Vue reconstruite en volume à partir de la vidéo, puis calée sur le relief LiDAR.',
  },
  [ORTHO_LAYER]: {
    panel: 'orthophoto',
    title: 'Ortho drone',
    label: ORTHO_LABEL,
    pitch: 'Des prises de vue faites à la verticale, redressées et posées sur le relief.',
    show: 'AFFICHER LES ORTHOPHOTOS DE DRONE',
    note: 'Prise de vue à la verticale, redressée sur la surface LiDAR et posée sur le relief.',
  },
  [CLOUD_LAYER]: {
    panel: 'clouds',
    title: 'Nuages de points',
    label: CLOUD_LABEL,
    pitch: 'Les points retrouvés dans les images, avant d’en faire des gaussian splats.',
    show: 'AFFICHER LES NUAGES DE POINTS',
    note: 'Les points que la reconstruction a retrouvés dans les images, calés sur le relief LiDAR : c’est d’eux que partent les gaussian splats.',
  },
};

export const ImageryPanel = () => <DrawnPanel name={AERIAL_LAYER} />;
/** Orthophotos de drone : leur panneau à elles, comme les avions ont le leur. */
export const OrthophotoPanel = () => <DrawnPanel name={ORTHO_LAYER} />;
/** Nuages de points : de même. */
export const CloudPanel = () => <DrawnPanel name={CLOUD_LAYER} />;

function DrawnPanel({ name }: { name: string }) {
  const app = useApp();
  const layers = useChild('layers');
  const walk = useChild('walk');
  const kind = KINDS[name]!;
  const layer = useLayer<Scan>(name);
  const feed = useSelector(layer, layerFeed);
  const scans = useSelector(layer, (snapshot) => snapshot.context.items);
  const scan = useSelector(layer, layerSelection);
  const kept = useSelector(layer, layerKept);
  const enabled = feed !== 'off';
  const send = (event: { type: 'layers.toggled' } | { type: 'layers.dismissed' } | { type: 'layers.picked' | 'layers.keepToggled'; id: string }) =>
    layers.send({ ...event, layer: name });

  return (
    <Panel id={kind.panel} title={kind.title} className="imagery-panel">
      {!enabled && (
        <div className="aircraft-empty">
          <p>{kind.pitch}</p>
          <button type="button" className="scene-btn" onClick={() => send({ type: 'layers.toggled' })}>
            {kind.show}
          </button>
        </div>
      )}

      {enabled && scan && (
        <section className="aircraft-card" aria-label={`${kind.label} : ${scan.name}`}>
          <header className="aircraft-card-header">
            <div className="aircraft-card-title">
              <span className="imagery-kicker">{kind.label}</span>
              <span className="imagery-name">{scan.name}</span>
            </div>
            <button
              type="button"
              className="panel-collapse-btn"
              aria-label="Désélectionner cette imagerie"
              onClick={() => send({ type: 'layers.dismissed' })}
            >
              ×
            </button>
          </header>
          <dl className="aircraft-telemetry imagery-details">
            <div><dt>{scan.trace ? 'Données' : 'Images'}</dt><dd>{scan.credit.author}</dd></div>
            <div><dt>Licence</dt><dd>{scan.credit.licence}</dd></div>
            <div className="imagery-source">
              <dt>Source</dt>
              <dd><a href={scan.credit.url} target="_blank" rel="noreferrer">{scan.credit.title}</a></dd>
            </div>
          </dl>
          <p className="imagery-note">{scan.note ?? kind.note}</p>
          <div className="cctv-controls">
            <button
              type="button"
              className={kept.includes(scan.id) ? 'scene-btn active' : 'scene-btn'}
              aria-pressed={kept.includes(scan.id)}
              title={kept.includes(scan.id)
                ? 'Affichée en permanence dans la carte — toucher pour ne plus la garder'
                : 'La laisser affichée dans la carte tant que le calque est allumé, même en sélectionnant autre chose'}
              onClick={() => send({ type: 'layers.keepToggled', id: scan.id })}
            >
              {/* libellés courts : trois boutons se partagent la largeur du panneau, l'infobulle dit le reste */}
              {kept.includes(scan.id) ? 'ÉPINGLÉE' : 'ÉPINGLER'}
            </button>
            <button
              type="button"
              className="scene-btn"
              title="Ramener la caméra au-dessus de ce lieu"
              onClick={() => send({ type: 'layers.picked', id: scan.id })}
            >
              RETOUR
            </button>
            {isWalkable(scan) && <button
              type="button"
              className="scene-btn"
              title="Se poser au sol dans ce lieu et s'y promener"
              onClick={() => walk.send({ type: 'walk.placed', scan, ...walkStart(scan) })}
            >
              VISITER
            </button>}
          </div>
          {scan.legend && scan.legend.length > 0 && (
            <ul className="imagery-legend" aria-label="Couleurs du tracé">
              {scan.legend.map((entry) => (
                <li key={entry.label}>
                  <span className="imagery-swatch" style={{ background: entry.colour }} aria-hidden="true" />
                  {entry.label}
                </li>
              ))}
            </ul>
          )}
          {scan.clips && scan.clips.length > 0 && (
            <div className="imagery-clips">
              <span className="imagery-kicker">Séquences filmées sur place</span>
              {scan.clips.map((clip) => (
                <button
                  key={clip.id}
                  type="button"
                  className="scene-btn"
                  title="Voir la séquence là où la caméra l’a tournée"
                  onClick={() => app.send({ type: 'app.clipRequested', clip })}
                >
                  {clip.name}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {enabled && (
        <ul className="search-results aircraft-list" aria-label={`Lieux — ${kind.label}`}>
          {scans.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="search-result"
                aria-current={item.id === scan?.id}
                onClick={() => send({ type: 'layers.picked', id: item.id })}
              >
                <span className="search-result-name">{item.name}</span>
                <span className="search-result-meta">{kept.includes(item.id) ? 'affichée' : item.credit.author}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
