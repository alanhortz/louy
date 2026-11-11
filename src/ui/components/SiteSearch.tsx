import { useSelector } from '@xstate/react';
import { useEffect, useRef, useState } from 'react';
import { useChild } from '../actors.ts';

/** Recherche de sites touristiques : choisir un site y emmène la caméra, à 200 m, en orbite. */
export function SiteSearch() {
  const sites = useChild('sites');
  const stage = useSelector(sites, (snapshot) => snapshot.value);
  const query = useSelector(sites, (snapshot) => snapshot.context.query);
  const results = useSelector(sites, (snapshot) => snapshot.context.results);
  const total = useSelector(sites, (snapshot) => snapshot.context.index.length);
  const input = useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = useState(0);

  const open = stage !== 'closed';
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => setCursor(0), [results]);

  if (!open) return null;

  const close = () => sites.send({ type: 'sites.closed' });
  const pick = (id: string | undefined) => { if (id) sites.send({ type: 'sites.picked', id }); };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') close();
    if (event.key === 'Enter') pick(results[cursor]?.id);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setCursor((at) => Math.max(0, Math.min(results.length - 1, at + step)));
    }
  };

  const status = stage === 'loading' ? 'Chargement des sites…'
    : stage === 'failed' ? 'Liste indisponible — réessayez dans un instant'
    : results.length === 0 ? 'Aucun site ne correspond'
    : query ? `${results.length} résultat${results.length > 1 ? 's' : ''}`
    : `${total} sites touristiques · source OpenStreetMap`;

  return (
    <div className="search-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="panel search" role="dialog" aria-label="Chercher un site touristique" onKeyDown={onKeyDown}>
        <div className="panel-glow" />
        <div className="panel-inner">
          <header className="panel-header">
            <span className="panel-title">Sites touristiques</span>
            <span className="panel-divider" />
            <button type="button" className="panel-collapse-btn" aria-label="Fermer la recherche" onClick={close}>×</button>
          </header>
          <div className="search-field">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
            <input
              ref={input}
              type="search"
              value={query}
              placeholder="Château, musée, grotte, ville…"
              aria-label="Nom d’un site, d’une catégorie ou d’une localité"
              autoComplete="off"
              enterKeyHint="go"
              onChange={(event) => sites.send({ type: 'sites.queryChanged', query: event.target.value })}
            />
          </div>
          <p className="search-status" role="status">{status}</p>
          <div className="panel-body">
            <ul className="search-results" role="listbox" aria-label="Sites">
              {results.map((site, at) => (
                <li key={site.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={at === cursor}
                    className="search-result"
                    onClick={() => pick(site.id)}
                  >
                    <span className="search-result-name">{site.name}</span>
                    <span className="search-result-meta">{site.kind} · {site.near}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
