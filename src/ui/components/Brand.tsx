import { PROJECT } from '../../config/project.ts';

const GITHUB_MARK = 'M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.93-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.33.66.07-.52.28-.87.5-1.07-1.77-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.52.56.83 1.28.83 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0z';

/** Nom du projet, sa devise et le lien vers le dépôt. */
export function Brand() {
  const repositoryLabel = PROJECT.repository.replace('https://', '');
  return (
    <header className="brand">
      <h1 className="brand-name" title={`${PROJECT.name} — ${PROJECT.meaning}`}>
        L’<em>Oûy</em>
      </h1>
      <p className="brand-tagline">{PROJECT.tagline}</p>
      <a className="brand-repo" href={PROJECT.repository} target="_blank" rel="noreferrer">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d={GITHUB_MARK} /></svg>
        {repositoryLabel}
      </a>
    </header>
  );
}
