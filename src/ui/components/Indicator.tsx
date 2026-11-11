import { useSelector } from '@xstate/react';
import { campaignById } from '../../domain/catalog.ts';
import { useChild } from '../actors.ts';

/** Rappel de la campagne LiDAR affichée, en haut à droite. */
export function Indicator() {
  const scene = useChild('scene');
  const campaign = useSelector(scene, (snapshot) => snapshot.context.scene.campaign);
  return (
    <div className="indicator" aria-hidden="true">
      <span className="indicator-label">Campagne LiDAR</span>
      <span className="indicator-value">{campaignById(campaign)?.label}</span>
    </div>
  );
}
