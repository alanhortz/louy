import { useSelector } from '@xstate/react';
import { useEffect, useRef, useState } from 'react';
import { matchRecentSearches, recentKey } from '../../domain/recentSearches.ts';
import { STREET_SOURCE } from '../../domain/streets.ts';
import { streetSearchStage } from '../../machines/streetSearch.machine.ts';
import { useChild } from '../actors.ts';

/** Sites montrés quand la saisie trouve aussi des rues : la liste reste lisible d'un coup d'œil. */
const SITES_BESIDE_STREETS = 8;

/**
 * Recherche : un seul champ pour les sites touristiques et pour les rues.
 * Choisir un site y emmène la caméra en orbite ; choisir une rue la survole.
 * Ce que le visiteur a déjà choisi lui est proposé en premier.
 * Chaque liste a sa machine, cette palette ne fait que leur parler à toutes.
 */
export function SiteSearch() {
  const sites = useChild('sites');
  const streetSearch = useChild('streetSearch');
  const recents = useChild('recents');
  const stage = useSelector(sites, (snapshot) => snapshot.value);
  const query = useSelector(sites, (snapshot) => snapshot.context.query);
  const allSites = useSelector(sites, (snapshot) => snapshot.context.results);
  const total = useSelector(sites, (snapshot) => snapshot.context.index.length);
  const streetStage = useSelector(streetSearch, streetSearchStage);
  const foundStreets = useSelector(streetSearch, (snapshot) => snapshot.context.results);
  const remembered = useSelector(recents, (snapshot) => snapshot.context.list);
  const input = useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = useState(0);

  const open = stage !== 'closed';
  // les recherches récentes qui répondent à la saisie passent d'abord, et ne se répètent pas plus bas
  const recent = matchRecentSearches(remembered, query);
  const isRecent = (kind: 'site' | 'street', id: string) => recent.some((entry) => recentKey(entry) === recentKey({ kind, id }));
  const streets = foundStreets.filter((street) => !isRecent('street', street.id));
  const freshSites = allSites.filter((site) => !isRecent('site', site.id));
  const siteResults = streets.length > 0 || recent.length > 0 ? freshSites.slice(0, SITES_BESIDE_STREETS) : freshSites;
  const options = [
    ...recent.map((entry) => ({ kind: 'recent' as const, id: recentKey(entry) })),
    ...siteResults.map((site) => ({ kind: 'site' as const, id: site.id })),
    ...streets.map((street) => ({ kind: 'street' as const, id: street.id })),
  ];

  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => setCursor(0), [allSites, foundStreets, query]);

  if (!open) return null;

  const close = () => {
    sites.send({ type: 'sites.closed' });
    streetSearch.send({ type: 'streetSearch.closed' });
  };
  const pick = (option: (typeof options)[number] | undefined) => {
    if (!option) return;
    // la liste choisie annonce son choix et se ferme ; les autres sont simplement refermées
    // un choix fait, la saisie a servi : la palette rouvrira sur les recherches récentes
    if (option.kind === 'recent') {
      recents.send({ type: 'recents.picked', key: option.id });
      sites.send({ type: 'sites.queryChanged', query: '' });
      close();
    } else if (option.kind === 'site') {
      sites.send({ type: 'sites.picked', id: option.id });
      streetSearch.send({ type: 'streetSearch.closed' });
    } else {
      streetSearch.send({ type: 'streetSearch.picked', id: option.id });
      sites.send({ type: 'sites.queryChanged', query: '' });
      sites.send({ type: 'sites.closed' });
    }
  };
  const type = (value: string) => {
    sites.send({ type: 'sites.queryChanged', query: value });
    streetSearch.send({ type: 'streetSearch.queryChanged', query: value });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') close();
    if (event.key === 'Enter') pick(options[cursor]);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setCursor((at) => Math.max(0, Math.min(options.length - 1, at + step)));
    }
  };

  const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`;
  const streetStatus = streetStage === 'loading' ? 'recherche des rues…'
    : streetStage === 'failed' ? 'rues indisponibles'
    : streets.length > 0 ? plural(streets.length, 'rue')
    : null;
  const status = stage === 'loading' ? 'Chargement des sites…'
    : stage === 'failed' ? 'Liste indisponible — réessayez dans un instant'
    : !query ? `${total} sites touristiques (OpenStreetMap) et toutes les rues de Wallonie (${STREET_SOURCE})`
    : options.length === 0 && !streetStatus ? 'Aucun site ni aucune rue ne correspond'
    : [recent.length > 0 ? plural(recent.length, 'récente') : null, freshSites.length > 0 ? plural(freshSites.length, 'site') : null, streetStatus].filter(Boolean).join(' · ');

  return (
    <div className="search-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="panel search" role="dialog" aria-label="Chercher un site ou une rue" onKeyDown={onKeyDown}>
        <div className="panel-glow" />
        <div className="panel-inner">
          <header className="panel-header">
            <span className="panel-title">Sites et rues</span>
            <span className="panel-divider" />
            <button type="button" className="panel-collapse-btn" aria-label="Fermer la recherche" onClick={close}>×</button>
          </header>
          <div className="search-field">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
            <input
              ref={input}
              type="search"
              value={query}
              placeholder="Rue, château, musée, ville…"
              aria-label="Nom d’une rue, d’un site, d’une catégorie ou d’une localité"
              autoComplete="off"
              enterKeyHint="go"
              onChange={(event) => type(event.target.value)}
            />
          </div>
          <p className="search-status" role="status">{status}</p>
          <div className="panel-body">
            <ul className="search-results" role="listbox" aria-label="Sites et rues">
              {recent.length > 0 && (
                <li className="search-section" role="presentation">
                  Récentes
                  <button type="button" className="search-section-action" onClick={() => recents.send({ type: 'recents.cleared' })}>
                    Effacer
                  </button>
                </li>
              )}
              {recent.map((entry, at) => (
                <li key={`recent:${recentKey(entry)}`} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={at === cursor}
                    className="search-result"
                    onClick={() => pick({ kind: 'recent', id: recentKey(entry) })}
                  >
                    <span className="search-result-name">{entry.name}</span>
                    <span className="search-result-meta">{entry.kind === 'street' ? `Rue · ${entry.meta}` : entry.meta}</span>
                  </button>
                </li>
              ))}
              {recent.length > 0 && siteResults.length > 0 && <li className="search-section" role="presentation">Sites</li>}
              {siteResults.map((site, at) => (
                <li key={`site:${site.id}`} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={recent.length + at === cursor}
                    className="search-result"
                    onClick={() => pick({ kind: 'site', id: site.id })}
                  >
                    <span className="search-result-name">{site.name}</span>
                    <span className="search-result-meta">{site.kind} · {site.near}</span>
                  </button>
                </li>
              ))}
              {streets.length > 0 && <li className="search-section" role="presentation">Rues</li>}
              {streets.map((street, at) => (
                <li key={`street:${street.id}`} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={recent.length + siteResults.length + at === cursor}
                    className="search-result"
                    onClick={() => pick({ kind: 'street', id: street.id })}
                  >
                    <span className="search-result-name">{street.name}</span>
                    <span className="search-result-meta">Rue · {street.near}</span>
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
