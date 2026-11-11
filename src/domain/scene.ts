/**
 * La « scène » : ce que le visiteur a choisi de regarder, et sa traduction en
 * services concrets du Géoportail.
 */

import {
  CAMPAIGNS, LATEST_VINTAGE, campaignById, surfaceById, tintById, vintageById,
  type CampaignId, type SurfaceId, type TintId,
} from './catalog.ts';

export interface Scene {
  campaign: CampaignId;
  surface: SurfaceId;
  tint: TintId;
  vintage: string;
}

export const DEFAULT_SCENE: Scene = {
  campaign: '2021-2022',
  surface: 'mns',
  tint: 'ortho',
  vintage: LATEST_VINTAGE,
};

/** Ce dont le moteur de rendu a besoin pour charger une tuile de cette scène. */
export interface SceneSource {
  /** Identité de contenu : deux scènes de même clef partagent leurs tuiles. */
  key: string;
  lutKey: SurfaceId;
  maxLevel: number;
  elevationService: string;
  colorMode: 'service' | 'elevation' | 'slope';
  colorService: string | null;
  colorFormat: 'jpg';
}

/** Ramène une scène quelconque (lien partagé, saisie) à une scène valide. */
export function normalizeScene(candidate: Partial<Scene>): Scene {
  return {
    campaign: campaignById(candidate.campaign ?? '')?.id ?? DEFAULT_SCENE.campaign,
    surface: surfaceById(candidate.surface ?? '')?.id ?? DEFAULT_SCENE.surface,
    tint: tintById(candidate.tint ?? '')?.id ?? DEFAULT_SCENE.tint,
    vintage: vintageById(candidate.vintage ?? '')?.id ?? DEFAULT_SCENE.vintage,
  };
}

function colorService(scene: Scene, elevationService: string): string | null {
  switch (scene.tint) {
    case 'ortho':
      return `IMAGERIE/ORTHO_${vintageById(scene.vintage)!.suffix}`;
    case 'infrared': {
      // toutes les campagnes n'ont pas d'infrarouge : repli sur la plus récente
      const vintage = vintageById(scene.vintage)!;
      return `IMAGERIE/ORTHO_${vintage.infrared ? vintage.suffix : 'LAST'}_IR`;
    }
    case 'hillshade':
      return `${elevationService}_HILLSHADE`;
    default:
      return null;
  }
}

export function resolveScene(scene: Scene): SceneSource {
  const campaign = campaignById(scene.campaign) ?? CAMPAIGNS[0]!;
  const elevationService = `RELIEF/WALLONIE_${scene.surface.toUpperCase()}_${campaign.token}`;
  const service = colorService(scene, elevationService);
  return {
    key: [scene.campaign, scene.surface, service ?? scene.tint].join('|'),
    lutKey: scene.surface,
    maxLevel: campaign.maxLevel,
    elevationService,
    colorMode: service ? 'service' : (scene.tint as 'elevation' | 'slope'),
    colorService: service,
    colorFormat: 'jpg',
  };
}
