/**
 * Affichage à palettes (« split-flap ») : quand le libellé d'une pastille
 * change, ses caractères basculent un à un, de gauche à droite, comme sur un
 * tableau des départs.
 *
 * Planification reprise de God's Eye View (`src/splitFlap.js`) — © 2026 Bilawal
 * Sidhu, licence MIT. Fonction pure : ni DOM, ni horloge.
 */

/** Durée de bascule d'un caractère. */
export const FLAP_CHAR_MS = 190;
/** Écart nominal entre deux caractères consécutifs. */
export const FLAP_STAGGER_MS = 26;
/** Plafond d'une cascade : un long libellé resserre son écart plutôt que de traîner. */
export const FLAP_MAX_TOTAL_MS = 620;

export interface FlapCell {
  /** Caractère qui s'efface ; chaîne vide pour une colonne qui apparaît. */
  from: string;
  /** Caractère qui s'installe ; chaîne vide pour une colonne qui se libère. */
  to: string;
  changed: boolean;
  delayMs: number;
}

export interface FlapPlan {
  cells: FlapCell[];
  /** Durée totale de la cascade, en millisecondes ; 0 si rien ne change. */
  durationMs: number;
}

/**
 * Compare deux textes colonne par colonne. Un caractère inchangé ne bouge pas —
 * comme une palette qui affiche déjà le bon signe — et l'écart est compté à
 * partir de la première colonne modifiée : la cascade démarre aussitôt.
 */
export function planSplitFlap(fromText: string, toText: string): FlapPlan {
  const from = Array.from(fromText);
  const to = Array.from(toText);
  const width = Math.max(from.length, to.length);
  const changed = Array.from({ length: width }, (_, k) => (from[k] ?? '') !== (to[k] ?? ''));
  const first = changed.indexOf(true);
  const last = changed.lastIndexOf(true);

  // l'écart est resserré pour que toute la cascade tienne dans le plafond
  const span = last - first;
  const stagger = span > 0 ? Math.min(FLAP_STAGGER_MS, (FLAP_MAX_TOTAL_MS - FLAP_CHAR_MS) / span) : 0;

  return {
    cells: changed.map((isChanged, k) => ({
      from: from[k] ?? '',
      to: to[k] ?? '',
      changed: isChanged,
      delayMs: isChanged ? Math.round((k - first) * stagger) : 0,
    })),
    durationMs: first < 0 ? 0 : Math.round(span * stagger + FLAP_CHAR_MS),
  };
}
