import { useSelector } from '@xstate/react';
import { RAIL_ITEMS } from '../rail.ts';
import { useChild } from '../actors.ts';

/**
 * Rail : chaque icône déplie son panneau, ou le replie s'il est déjà ouvert.
 * Il sert de sommaire à toutes les tailles d'écran.
 */
export function Rail() {
  const chrome = useChild('chrome');
  const expanded = useSelector(chrome, (snapshot) =>
    RAIL_ITEMS.filter(({ panel }) => snapshot.matches({ [panel]: 'expanded' })).map(({ panel }) => panel).join());

  return (
    <nav className="rail" aria-label="Panneaux">
      {RAIL_ITEMS.map(({ panel, label, Icon }) => {
        const active = expanded.split(',').includes(panel);
        return (
          <button
            key={panel}
            type="button"
            className={active ? 'rail-item active' : 'rail-item'}
            title={label}
            aria-label={label}
            aria-pressed={active}
            onClick={() => chrome.send({ type: 'chrome.toggled', panel })}
          >
            <Icon className="rail-glyph" aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
}
