/** Libellés du catalogue d'imagerie, résolus dans la langue courante. */

import { LATEST_VINTAGE, vintageById, type Vintage } from '../domain/catalog.ts';
import { t } from '../i18n/index.ts';

/** « La plus récente », « 2026 (printemps) », « 2024 »… */
export function vintageLabel(vintage: Vintage): string {
  if (vintage.id === LATEST_VINTAGE) return t('catalog.vintage.last');
  if (vintage.season) return t(`catalog.vintage.${vintage.season}`, { year: vintage.label });
  return vintage.label;
}

/** Le même libellé, pour un millésime désigné par son identifiant ; à défaut, le libellé fourni. */
export const vintageName = (id: string, fallback: string): string => {
  const vintage = vintageById(id);
  return vintage ? vintageLabel(vintage) : fallback;
};
