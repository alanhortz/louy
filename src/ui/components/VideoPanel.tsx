import { useSelector } from '@xstate/react';
import { useTranslation } from 'react-i18next';
import { VIDEOS_LABEL, videoPageUrl, type WebVideo } from '../../domain/videos.ts';
import { VIDEOS_LAYER } from '../../machines/scans.layer.ts';
import { layerFeed, layerSelection } from '../../machines/selectionLayer.machine.ts';
import { useChild, useLayer } from '../actors.ts';
import { Panel } from './Panel.tsx';
import { useLocalized } from '../localized.ts';

/**
 * Vidéos : la fiche de la vidéo signalée, et le lien vers sa page. Le site n'intègre pas le lecteur : la vidéo
 * s'ouvre chez son hébergeur, dans un autre onglet, et rien ne lui est demandé avant.
 */
export function VideoPanel() {
  const { t } = useTranslation();
  const l = useLocalized();
  const layers = useChild('layers');
  const layer = useLayer<WebVideo>(VIDEOS_LAYER);
  const feed = useSelector(layer, layerFeed);
  const videos = useSelector(layer, (snapshot) => snapshot.context.items);
  const video = useSelector(layer, layerSelection);
  const enabled = feed !== 'off';
  const send = (event: { type: 'layers.toggled' } | { type: 'layers.dismissed' } | { type: 'layers.picked'; id: string }) =>
    layers.send({ ...event, layer: VIDEOS_LAYER });

  return (
    <Panel id="videos" title={t(VIDEOS_LABEL)} className="imagery-panel video-panel">
      {!enabled && (
        <div className="aircraft-empty">
          <p>{t('videos.pitch')}</p>
          <button type="button" className="scene-btn" onClick={() => send({ type: 'layers.toggled' })}>{t('videos.show')}</button>
        </div>
      )}

      {enabled && video && (
        <section className="aircraft-card" aria-label={`${t(VIDEOS_LABEL)} : ${l(video, 'name')}`}>
          <header className="aircraft-card-header">
            <div className="aircraft-card-title">
              <span className="imagery-kicker">YouTube</span>
              <span className="imagery-name">{l(video, 'name')}</span>
            </div>
            <button type="button" className="panel-collapse-btn" aria-label={t('videos.deselect')} onClick={() => send({ type: 'layers.dismissed' })}>×</button>
          </header>
          <dl className="aircraft-telemetry imagery-details">
            <div><dt>{t('videos.author')}</dt><dd>{video.credit.author}</dd></div>
            <div><dt>{t('videos.rights')}</dt><dd>{l(video.credit, 'licence')}</dd></div>
          </dl>
          <p className="imagery-note">{video.credit.title}</p>
          <div className="cctv-controls">
            <a className="scene-btn video-link" href={videoPageUrl(video)} target="_blank" rel="noopener noreferrer">{t('videos.open')}</a>
            <button type="button" className="scene-btn" onClick={() => send({ type: 'layers.picked', id: video.id })}>{t('videos.locate')}</button>
          </div>
          <p className="imagery-note">{t('videos.note')}</p>
        </section>
      )}

      {enabled && (
        <ul className="search-results aircraft-list" aria-label={t(VIDEOS_LABEL)}>
          {videos.map((item) => (
            <li key={item.id}>
              <button type="button" className="search-result" aria-current={item.id === video?.id} onClick={() => send({ type: 'layers.picked', id: item.id })}>
                <span className="search-result-name">{l(item, 'name')}</span>
                <span className="search-result-meta">{item.credit.author}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
