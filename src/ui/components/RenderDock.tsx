import { useSelector } from '@xstate/react';
import { CAMPAIGNS, SURFACES, TINTS, VINTAGES, tintById } from '../../domain/catalog.ts';
import { useChild } from '../actors.ts';
import { Panel } from './Panel.tsx';

/** Ce que l'on regarde : habillage du relief, modèle de surface, campagne LiDAR, millésime. */
export function RenderDock() {
  const sceneActor = useChild('scene');
  const scene = useSelector(sceneActor, (snapshot) => snapshot.context.scene);
  const expanded = useSelector(useChild('chrome'), (snapshot) => snapshot.matches({ render: 'expanded' }));
  const usesVintage = tintById(scene.tint)?.usesVintage ?? false;

  return (
    <div className={`dock ${expanded ? '' : 'collapsed'}`}>
      <Panel id="render" title="Rendu">
        <div className="button-grid" role="radiogroup" aria-label="Habillage du relief">
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
              <span className="btn-label">{tint.label}</span>
            </button>
          ))}
        </div>

        <div className="dock-sections">
          <div className="dock-section">
            <span className="dock-section-title">Relief</span>
            <div className="chip-row" role="radiogroup" aria-label="Modèle de surface">
              {SURFACES.map((surface) => (
                <button
                  key={surface.id}
                  type="button"
                  role="radio"
                  aria-checked={scene.surface === surface.id}
                  title={surface.hint}
                  className={`map-stack-chip ${scene.surface === surface.id ? 'active' : ''}`}
                  onClick={() => sceneActor.send({ type: 'scene.surfaceSelected', surface: surface.id })}
                >
                  {surface.label}
                </button>
              ))}
            </div>
          </div>

          <div className="dock-section">
            <span className="dock-section-title">Campagne LiDAR</span>
            <div className="chip-row" role="radiogroup" aria-label="Campagne LiDAR">
              {CAMPAIGNS.map((campaign) => (
                <button
                  key={campaign.id}
                  type="button"
                  role="radio"
                  aria-checked={scene.campaign === campaign.id}
                  title={`Relevé ${campaign.label}, résolution ${campaign.resolution} m`}
                  className={`map-stack-chip ${scene.campaign === campaign.id ? 'active' : ''}`}
                  onClick={() => sceneActor.send({ type: 'scene.campaignSelected', campaign: campaign.id })}
                >
                  {campaign.label}
                </button>
              ))}
            </div>
          </div>

          <label className="dock-section dock-section-wide">
            <span className="dock-section-title">Orthophoto</span>
            <select
              className="glass-select"
              value={scene.vintage}
              disabled={!usesVintage}
              onChange={(event) => sceneActor.send({ type: 'scene.vintageSelected', vintage: event.target.value })}
            >
              {VINTAGES.map((vintage) => (
                <option key={vintage.id} value={vintage.id}>{vintage.label}</option>
              ))}
            </select>
          </label>
        </div>
      </Panel>
    </div>
  );
}
