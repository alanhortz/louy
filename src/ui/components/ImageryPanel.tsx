import { useSelector } from '@xstate/react';
import { AERIAL_LABEL, type Scan } from '../../domain/scans.ts';
import { AERIAL_LAYER } from '../../machines/scans.layer.ts';
import { layerFeed, layerKept, layerSelection } from '../../machines/selectionLayer.machine.ts';
import { useChild, useLayer } from '../actors.ts';
import { Panel } from './Panel.tsx';

/**
 * Imagerie aérienne : la fiche du lieu sélectionné — ce que c'est, d'où viennent
 * les images — et le choix de le garder affiché dans la carte pendant que l'on
 * en regarde un autre. Sans sélection, la liste des lieux disponibles.
 */
export function ImageryPanel() {
  const layers = useChild('layers');
  const layer = useLayer<Scan>(AERIAL_LAYER);
  const feed = useSelector(layer, layerFeed);
  const scans = useSelector(layer, (snapshot) => snapshot.context.items);
  const scan = useSelector(layer, layerSelection);
  const kept = useSelector(layer, layerKept);
  const enabled = feed !== 'off';
  const send = (event: { type: 'layers.toggled' } | { type: 'layers.dismissed' } | { type: 'layers.picked' | 'layers.keepToggled'; id: string }) =>
    layers.send({ ...event, layer: AERIAL_LAYER });

  return (
    <Panel id="imagery" title="Imagerie" className="imagery-panel">
      {!enabled && (
        <div className="aircraft-empty">
          <p>Des lieux filmés au drone et reconstruits en volume, posés sur le relief.</p>
          <button type="button" className="scene-btn" onClick={() => send({ type: 'layers.toggled' })}>
            AFFICHER L’IMAGERIE AÉRIENNE
          </button>
        </div>
      )}

      {enabled && scan && (
        <section className="aircraft-card" aria-label={`${AERIAL_LABEL} : ${scan.name}`}>
          <header className="aircraft-card-header">
            <div className="aircraft-card-title">
              <span className="imagery-kicker">{AERIAL_LABEL}</span>
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
            <div><dt>Images</dt><dd>{scan.credit.author}</dd></div>
            <div><dt>Licence</dt><dd>{scan.credit.licence}</dd></div>
            <div className="imagery-source">
              <dt>Source</dt>
              <dd><a href={scan.credit.url} target="_blank" rel="noreferrer">{scan.credit.title}</a></dd>
            </div>
          </dl>
          <p className="imagery-note">Vue reconstruite en volume à partir de la vidéo, puis calée sur le relief LiDAR.</p>
          <div className="cctv-controls">
            <button
              type="button"
              className={kept.includes(scan.id) ? 'scene-btn active' : 'scene-btn'}
              aria-pressed={kept.includes(scan.id)}
              title="La garder dessinée dans la carte tant que le calque est allumé, même en sélectionnant autre chose"
              onClick={() => send({ type: 'layers.keepToggled', id: scan.id })}
            >
              {kept.includes(scan.id) ? 'AFFICHÉE EN PERMANENCE' : 'LAISSER AFFICHÉE'}
            </button>
            <button type="button" className="scene-btn" onClick={() => send({ type: 'layers.picked', id: scan.id })}>
              Y RETOURNER
            </button>
          </div>
        </section>
      )}

      {enabled && (
        <ul className="search-results aircraft-list" aria-label="Lieux en imagerie aérienne">
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
