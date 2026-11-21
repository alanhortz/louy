import { useSelector } from '@xstate/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { PanelId } from '../../machines/chrome.machine.ts';
import { useChild } from '../actors.ts';

interface PanelProps {
  id: PanelId;
  /** Titre déjà traduit. */
  title: string;
  className?: string;
  onExpand?: () => void;
  children: ReactNode;
}

/** Pictogramme du bouton de repli, le même pour tous les panneaux : replié, puis déplié. */
const GLYPHS = ['+', '−'] as const;

/** Panneau « verre » repliable ; son état vit dans la machine `chrome`. */
export function Panel({ id, title, className = '', onExpand, children }: PanelProps) {
  const { t } = useTranslation();
  const chrome = useChild('chrome');
  const expanded = useSelector(chrome, (snapshot) => snapshot.matches({ [id]: 'expanded' }));

  const toggle = () => {
    chrome.send({ type: 'chrome.toggled', panel: id });
    if (!expanded) onExpand?.();
  };

  return (
    <section className={`panel ${expanded ? '' : 'collapsed'} ${className}`} aria-label={title}>
      <div className="panel-glow" />
      <div className="panel-inner">
        <header className="panel-header">
          <span className="panel-title">{title}</span>
          <span className="panel-divider" />
          <button
            type="button"
            className="panel-collapse-btn"
            aria-expanded={expanded}
            aria-label={t(expanded ? 'panel.collapse' : 'panel.expand', { title })}
            onClick={toggle}
          >
            {GLYPHS[expanded ? 1 : 0]}
          </button>
        </header>
        {expanded && <div className="panel-body">{children}</div>}
      </div>
    </section>
  );
}
