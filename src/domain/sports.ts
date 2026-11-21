/**
 * Calque « Sports » : des séquences filmées d'une activité sportive, replacées
 * là où elles ont été tournées. Chacune a son marqueur ; la toucher emmène la vue
 * devant l'écran qui la joue, dressé à la place de la caméra.
 */

import { isClip, type ScanClip } from './clips.ts';
import type { ScanCredit } from './scans.ts';

/** Clef de traduction du nom du calque. */
export const SPORTS_LABEL = 'layer.sports';

export interface SportSequence {
  id: string;
  name: string;
  /** Où le marqueur se pose : Lambert 2008. */
  x: number;
  y: number;
  credit: ScanCredit;
  clip: ScanClip;
}

export function isSportSequence(value: unknown): value is SportSequence {
  const item = value as Partial<SportSequence> | null;
  return typeof item === 'object' && item !== null
    && typeof item.id === 'string' && typeof item.name === 'string'
    && Number.isFinite(item.x) && Number.isFinite(item.y)
    && typeof item.credit?.author === 'string' && typeof item.credit?.title === 'string'
    && typeof item.credit?.url === 'string' && typeof item.credit?.licence === 'string'
    && isClip(item.clip);
}
