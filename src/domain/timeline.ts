/**
 * Film du temps : la même vue, photo aérienne après photo aérienne. Les étapes
 * sont les millésimes d'orthophotos du SPW, du plus ancien au plus récent.
 */

import { LATEST_VINTAGE, VINTAGES, type TintId } from './catalog.ts';

export interface TimelineStep {
  /** Identifiant du millésime (`2015`, `1994`…). */
  vintage: string;
  /** Libellé complet de la campagne (« 1994–2000 », « 2023 (été) »). */
  label: string;
  /** Première année de la campagne : sa place sur la frise. */
  year: number;
}

/** Le film se joue en photo ; il garde l'infrarouge si c'est ce que le visiteur regardait. */
export const timelineTint = (tint: TintId): TintId => (tint === 'infrared' ? 'infrared' : 'ortho');

/** Étapes du film, en ordre chronologique. En infrarouge, seules les campagnes qui en ont une version. */
export function timelineSteps(tint: TintId): TimelineStep[] {
  const infrared = timelineTint(tint) === 'infrared';
  return VINTAGES
    .filter((vintage) => vintage.id !== LATEST_VINTAGE && (!infrared || vintage.infrared))
    .map((vintage) => ({ vintage: vintage.id, label: vintage.label, year: Number.parseInt(vintage.id, 10) }))
    .filter((step) => Number.isFinite(step.year))
    .sort((a, b) => a.year - b.year);
}

/** Position d'une année sur la frise, de 0 à 1, proportionnelle au temps écoulé. */
export function timelinePosition(year: number, steps: readonly { year: number }[]): number {
  const first = steps[0]?.year ?? year;
  const last = steps.at(-1)?.year ?? year;
  return last === first ? 0 : (year - first) / (last - first);
}

/** Durée d'affichage d'une image avant de passer à la suivante, et durée du fondu. */
export const TIMELINE_STEP_MS = 2600;
export const TIMELINE_FADE_MS = 900;
