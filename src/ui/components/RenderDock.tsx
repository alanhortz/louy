import { FilmIcon } from '@heroicons/react/24/outline';
import { useSelector } from '@xstate/react';
import { useTranslation } from 'react-i18next';
import { CAMPAIGNS, SURFACES, TINTS, VINTAGES, tintById } from '../../domain/catalog.ts';
import { useApp, useChild } from '../actors.ts';
import { vintageLabel } from '../labels.ts';
import { Panel } from './Panel.tsx';

/** Ce que l'on regarde : habillage du relief, modèle de surface, campagne LiDAR, millésime. */
export function RenderDock() {
  const { t } = useTranslation();
  const app = useApp();
  const sceneActor = useChild('scene');
  const scene = useSelector(sceneActor, (snapshot) => snapshot.context.scene);
  const expanded = useSelector(useChild('chrome'), (snapshot) => snapshot.matches({ render: 'expanded' }));
  const usesVintage = tintById(scene.tint)?.usesVintage ?? false;

  return (
    <div className={`dock ${expanded ? '' : 'collapsed'}`}>
      <Panel id="render" title={t('render.title')}>
        <div className="button-grid" role="radiogroup" aria-label={t('render.tints')}>
          {TINTS.map((tint) => (
            <button
              key={tint.id}
              type="button"
              role="radio"
              aria-checked={scene.tint === tint.id}
              className={`style-btn ${scene.tint === tint.id ? 'active' : ''}`}
              onClick={() => sceneActor.send({ type: 'scene.tintSelected', tint: tint.id })}
            >
              <span className="btn-icon" aria-hidden="true">{tint.icon}</span>
              <span className="btn-label">{t(`catalog.tint.${tint.id}`)}</span>
            </button>
          ))}
        </div>

        <div className="dock-sections">
          <div className="dock-section">
            <span className="dock-section-title">{t('render.relief')}</span>
            <div className="chip-row" role="radiogroup" aria-label={t('render.surface')}>
              {SURFACES.map((surface) => (
                <button
                  key={surface.id}
                  type="button"
                  role="radio"
                  aria-checked={scene.surface === surface.id}
                  title={t(`catalog.surfaceHint.${surface.id}`)}
                  className={`map-stack-chip ${scene.surface === surface.id ? 'active' : ''}`}
                  onClick={() => sceneActor.send({ type: 'scene.surfaceSelected', surface: surface.id })}
                >
                  {t(`catalog.surface.${surface.id}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="dock-section">
            <span className="dock-section-title">{t('render.campaign')}</span>
            <div className="chip-row" role="radiogroup" aria-label={t('render.campaign')}>
              {CAMPAIGNS.map((campaign) => (
                <button
                  key={campaign.id}
                  type="button"
                  role="radio"
                  aria-checked={scene.campaign === campaign.id}
                  title={t('render.campaignHint', { campaign: campaign.label, resolution: campaign.resolution })}
                  className={`map-stack-chip ${scene.campaign === campaign.id ? 'active' : ''}`}
                  onClick={() => sceneActor.send({ type: 'scene.campaignSelected', campaign: campaign.id })}
                >
                  {campaign.label}
                </button>
              ))}
            </div>
          </div>

          <label className="dock-section dock-section-wide">
            <span className="dock-section-title">{t('render.orthophoto')}</span>
            <select
              className="glass-select"
              value={scene.vintage}
              disabled={!usesVintage}
              onChange={(event) => sceneActor.send({ type: 'scene.vintageSelected', vintage: event.target.value })}
            >
              {VINTAGES.map((vintage) => (
                <option key={vintage.id} value={vintage.id}>{vintageLabel(vintage)}</option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="scene-btn dock-film"
            title={t('render.filmHint')}
            onClick={() => app.send({ type: 'app.timelineRequested' })}
          >
            <FilmIcon aria-hidden="true" />
            {t('render.film')}
          </button>
        </div>
      </Panel>
    </div>
  );
}
