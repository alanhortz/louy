import { useSelector } from '@xstate/react';
import { useTranslation } from 'react-i18next';
import { AERIAL_LABEL, CLOUD_LABEL, ORTHO_LABEL, isWalkable, walkStart, type Scan } from '../../domain/scans.ts';
import { AERIAL_LAYER, CLOUD_LAYER, ORTHO_LAYER } from '../../machines/scans.layer.ts';
import { layerFeed, layerKept, layerSelection } from '../../machines/selectionLayer.machine.ts';
import { useApp, useChild, useLayer } from '../actors.ts';
import type { PanelId } from '../../machines/chrome.machine.ts';
import { Panel } from './Panel.tsx';
import { useLocalized } from '../localized.ts';

/**
 * Imagerie aérienne : la fiche du lieu sélectionné — ce que c'est, d'où viennent
 * les images — et le choix de le garder affiché dans la carte pendant que l'on
 * en regarde un autre. Sans sélection, la liste des lieux disponibles.
 *
 * Les orthophotos de drone et les nuages de points se dessinent de même : chacun
 * a son panneau, bâti sur ce même gabarit. Les textes de chaque sorte sont sous
 * `imagery.<kind>` dans le dictionnaire.
 */
const KINDS: Record<string, { panel: PanelId; title: `rail.${PanelId}`; label: typeof AERIAL_LABEL | typeof ORTHO_LABEL | typeof CLOUD_LABEL; kind: 'aerial' | 'ortho' | 'clouds' }> = {
  [AERIAL_LAYER]: { panel: 'imagery', title: 'rail.imagery', label: AERIAL_LABEL, kind: 'aerial' },
  [ORTHO_LAYER]: { panel: 'orthophoto', title: 'rail.orthophoto', label: ORTHO_LABEL, kind: 'ortho' },
  [CLOUD_LAYER]: { panel: 'clouds', title: 'rail.clouds', label: CLOUD_LABEL, kind: 'clouds' },
};

export const ImageryPanel = () => <DrawnPanel name={AERIAL_LAYER} />;
/** Orthophotos de drone : leur panneau à elles, comme les avions ont le leur. */
export const OrthophotoPanel = () => <DrawnPanel name={ORTHO_LAYER} />;
/** Nuages de points : de même. */
export const CloudPanel = () => <DrawnPanel name={CLOUD_LAYER} />;

function DrawnPanel({ name }: { name: string }) {
  const { t } = useTranslation();
  const l = useLocalized();
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
    <Panel id={kind.panel} title={t(kind.title)} className="imagery-panel">
      {!enabled && (
        <div className="aircraft-empty">
          <p>{t(`imagery.${kind.kind}.pitch`)}</p>
          <button type="button" className="scene-btn" onClick={() => send({ type: 'layers.toggled' })}>
            {t(`imagery.${kind.kind}.show`)}
          </button>
        </div>
      )}

      {enabled && scan && (
        <section className="aircraft-card" aria-label={`${t(kind.label)} : ${l(scan, 'name')}`}>
          <header className="aircraft-card-header">
            <div className="aircraft-card-title">
              <span className="imagery-kicker">{t(kind.label)}</span>
              <span className="imagery-name">{l(scan, 'name')}</span>
            </div>
            <button
              type="button"
              className="panel-collapse-btn"
              aria-label={t('imagery.deselect')}
              onClick={() => send({ type: 'layers.dismissed' })}
            >
              ×
            </button>
          </header>
          <dl className="aircraft-telemetry imagery-details">
            <div>
              <dt>{scan.trace ? t('imagery.data') : t('imagery.images')}</dt>
              <dd>
                {scan.credit.author}
                {scan.credit.instagram && (
                  <a
                    className="credit-instagram" href={scan.credit.instagram} target="_blank" rel="noopener noreferrer"
                    title={t('imagery.instagram', { author: scan.credit.author })} aria-label={t('imagery.instagram', { author: scan.credit.author })}
                  >
                    {/* l'appareil photo d'Instagram, dessiné ici : rien n'est chargé d'Instagram */}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                      <rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4.2" /><circle cx="17.4" cy="6.6" r="0.9" fill="currentColor" stroke="none" />
                    </svg>
                  </a>
                )}
              </dd>
            </div>
            <div><dt>{t('imagery.licence')}</dt><dd>{l(scan.credit, 'licence')}</dd></div>
            <div className="imagery-source">
              <dt>{t('imagery.source')}</dt>
              <dd><a href={scan.credit.url} target="_blank" rel="noreferrer">{l(scan.credit, 'title')}</a></dd>
            </div>
          </dl>
          <p className="imagery-note">
            {l(scan, 'note') ?? t(`imagery.${kind.kind}.note`)}
            {scan.link && <> <a href={scan.link.url} target="_blank" rel="noopener noreferrer">{scan.link.label}</a></>}
          </p>
          <div className="cctv-controls">
            <button
              type="button"
              className={kept.includes(scan.id) ? 'scene-btn active' : 'scene-btn'}
              aria-pressed={kept.includes(scan.id)}
              title={kept.includes(scan.id) ? t('imagery.pinnedHint') : t('imagery.pinHint')}
              onClick={() => send({ type: 'layers.keepToggled', id: scan.id })}
            >
              {/* libellés courts : trois boutons se partagent la largeur du panneau, l'infobulle dit le reste */}
              {kept.includes(scan.id) ? t('imagery.pinned') : t('imagery.pin')}
            </button>
            <button
              type="button"
              className="scene-btn"
              title={t('imagery.backHint')}
              onClick={() => send({ type: 'layers.picked', id: scan.id })}
            >
              {t('imagery.back')}
            </button>
            {isWalkable(scan) && <button
              type="button"
              className="scene-btn"
              title={t('imagery.visitHint')}
              onClick={() => walk.send({ type: 'walk.placed', scan, ...walkStart(scan) })}
            >
              {t('imagery.visit')}
            </button>}
          </div>
          {scan.legend && scan.legend.length > 0 && (
            <ul className="imagery-legend" aria-label={t('imagery.legend')}>
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
              <span className="imagery-kicker">{t('imagery.clips')}</span>
              {scan.clips.map((clip) => (
                <button
                  key={clip.id}
                  type="button"
                  className="scene-btn"
                  title={t('imagery.clipHint')}
                  onClick={() => app.send({ type: 'app.clipRequested', clip })}
                >
                  {l(clip, 'name')}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {enabled && (
        <ul className="search-results aircraft-list" aria-label={t('imagery.places', { kind: t(kind.label) })}>
          {scans.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="search-result"
                aria-current={item.id === scan?.id}
                onClick={() => send({ type: 'layers.picked', id: item.id })}
              >
                <span className="search-result-name">{l(item, 'name')}</span>
                <span className="search-result-meta">{kept.includes(item.id) ? t('imagery.shown') : item.credit.author}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
