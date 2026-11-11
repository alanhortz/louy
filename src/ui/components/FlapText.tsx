import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { FLAP_MAX_TOTAL_MS, planSplitFlap, type FlapPlan } from '../../domain/splitFlap.ts';

/** Marge après la dernière palette avant de figer l'affichage. */
const SETTLE_SLACK_MS = 60;

/**
 * Texte à palettes : chaque changement de `text` fait basculer les caractères
 * modifiés, en cascade. Le vrai texte reste présent pour les lecteurs d'écran ;
 * les palettes, purement visuelles, n'en sont que le dessin.
 */
export function FlapText({ text }: { text: string }) {
  const shown = useRef(text);
  // à l'apparition, le libellé se compose depuis le vide
  const [plan, setPlan] = useState<FlapPlan>(() => planSplitFlap('', text));

  useEffect(() => {
    if (shown.current !== text) {
      setPlan(planSplitFlap(shown.current, text));
      shown.current = text;
    }
    // une fois la cascade passée, l'affichage se fige et les colonnes libérées sont retirées
    const settle = setTimeout(() => setPlan(planSplitFlap(text, text)), FLAP_MAX_TOTAL_MS + SETTLE_SLACK_MS);
    return () => clearTimeout(settle);
  }, [text]);

  return (
    <span className="flap">
      <span className="visually-hidden">{text}</span>
      <span className="flap-cells" aria-hidden="true">
        {plan.cells.map((cell, column) => (
          <span
            key={column}
            className={cell.changed ? 'flap-cell is-flapping' : 'flap-cell'}
            data-flap-prev={cell.from || ' '}
            data-flap-next={cell.to || ' '}
            style={{ '--flap-delay': `${cell.delayMs}ms` } as CSSProperties}
          />
        ))}
      </span>
    </span>
  );
}
