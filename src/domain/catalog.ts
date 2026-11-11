/**
 * Catalogue de ce que le viewer sait montrer : campagnes LiDAR, modèles de
 * surface, habillages et millésimes d'orthophotos.
 *
 * Toutes les données proviennent du Géoportail de la Wallonie (Service public
 * de Wallonie, licence CC-BY 4.0).
 */

export type CampaignId = '2021-2022' | '2013-2014';
export type SurfaceId = 'mnt' | 'mns';
export type TintId = 'ortho' | 'infrared' | 'hillshade' | 'elevation' | 'slope';

export interface Campaign {
  id: CampaignId;
  label: string;
  /** Fragment du nom de service ArcGIS (`WALLONIE_MNT_<token>`). */
  token: string;
  /** Résolution native du modèle, en mètres. */
  resolution: number;
  /** Niveau de quadtree au-delà duquel la donnée n'apporte plus rien. */
  maxLevel: number;
  /** Les mailles de vol (dates d'acquisition par dalle) sont-elles publiées ? */
  hasFlightDates: boolean;
}

export const CAMPAIGNS: readonly Campaign[] = [
  { id: '2021-2022', label: '2021–2022', token: '2021_2022', resolution: 0.5, maxLevel: 11, hasFlightDates: true },
  { id: '2013-2014', label: '2013–2014', token: '2013_2014', resolution: 1, maxLevel: 10, hasFlightDates: false },
];

export interface Surface {
  id: SurfaceId;
  label: string;
  hint: string;
}

export const SURFACES: readonly Surface[] = [
  { id: 'mnt', label: 'Terrain', hint: 'Modèle numérique de terrain : le sol nu, sans bâti ni végétation' },
  { id: 'mns', label: 'Surface', hint: 'Modèle numérique de surface : bâtiments et canopée compris' },
];

export interface Tint {
  id: TintId;
  label: string;
  icon: string;
  /** `service` : image drapée sur le relief ; `derived` : calculé depuis l'altitude. */
  kind: 'service' | 'derived';
  /** L'habillage dépend-il du millésime d'orthophoto choisi ? */
  usesVintage: boolean;
}

export const TINTS: readonly Tint[] = [
  { id: 'ortho', label: 'Photo', icon: '◯', kind: 'service', usesVintage: true },
  { id: 'infrared', label: 'Infrarouge', icon: '🌡️', kind: 'service', usesVintage: true },
  { id: 'hillshade', label: 'Ombrage', icon: '◐', kind: 'service', usesVintage: false },
  { id: 'elevation', label: 'Altitude', icon: '▲', kind: 'derived', usesVintage: false },
  { id: 'slope', label: 'Pente', icon: '◭', kind: 'derived', usesVintage: false },
];

export interface Vintage {
  id: string;
  label: string;
  /** Suffixe du service `IMAGERIE/ORTHO_<suffix>`. */
  suffix: string;
  /** Une version infrarouge de cette campagne existe-t-elle ? */
  infrared: boolean;
}

export const LATEST_VINTAGE = 'last';

export const VINTAGES: readonly Vintage[] = [
  { id: LATEST_VINTAGE, label: 'La plus récente', suffix: 'LAST', infrared: true },
  { id: '2026', label: '2026 (printemps)', suffix: '2026_PRINTEMPS', infrared: true },
  { id: '2025', label: '2025 (été)', suffix: '2025_ETE', infrared: true },
  { id: '2024', label: '2024', suffix: '2024', infrared: true },
  { id: '2023', label: '2023 (été)', suffix: '2023_ETE', infrared: true },
  { id: '2022', label: '2022 (été)', suffix: '2022_ETE', infrared: true },
  { id: '2021', label: '2021', suffix: '2021', infrared: true },
  { id: '2020', label: '2020', suffix: '2020', infrared: true },
  { id: '2019', label: '2019', suffix: '2019', infrared: true },
  { id: '2018', label: '2018', suffix: '2018', infrared: true },
  { id: '2017', label: '2017', suffix: '2017', infrared: true },
  { id: '2016', label: '2016', suffix: '2016', infrared: true },
  { id: '2015', label: '2015', suffix: '2015', infrared: true },
  { id: '2012', label: '2012–2013', suffix: '2012_2013', infrared: true },
  { id: '2009', label: '2009–2010', suffix: '2009_2010', infrared: true },
  { id: '2006', label: '2006–2007', suffix: '2006_2007', infrared: true },
  { id: '2001', label: '2001–2003', suffix: '2001_2003', infrared: false },
  { id: '1994', label: '1994–2000', suffix: '1994_2000', infrared: false },
  { id: '1978', label: '1978–1990', suffix: '1978_1990', infrared: false },
  { id: '1971', label: '1971', suffix: '1971', infrared: false },
];

const byId = <T extends { id: string }>(list: readonly T[], id: string): T | undefined =>
  list.find((item) => item.id === id);

export const campaignById = (id: string) => byId(CAMPAIGNS, id);
export const surfaceById = (id: string) => byId(SURFACES, id);
export const tintById = (id: string) => byId(TINTS, id);
export const vintageById = (id: string) => byId(VINTAGES, id);
