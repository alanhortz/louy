import support from '../../config/browser-support.json';
import type { SupportReport } from '../../services/capabilities.ts';

/** Le navigateur ne peut pas faire tourner le viewer : on dit quelle version installer. */
export function UnsupportedNotice({ report }: { report: SupportReport }) {
  const { browser, minimum, missing } = report;
  return (
    <main className="notice">
      <section className="panel notice-card">
        <div className="panel-glow" />
        <div className="panel-inner">
          <h1>{support.title}</h1>
          <p>{support.intro}</p>

          <p className="notice-detected">
            Détecté : {browser.name}{browser.version ? ` ${browser.version}` : ''}
          </p>

          {minimum ? (
            <div className="notice-required">
              <p>Version requise : <strong>{minimum.name} {minimum.version}</strong> ou ultérieure.</p>
              <p>{minimum.hint}</p>
            </div>
          ) : (
            <div className="notice-required">
              <p>Utilisez l’un de ces navigateurs, à jour :</p>
              <ul>
                {support.minimum.map((entry) => (
                  <li key={entry.id}>{entry.name} {entry.version} ou ultérieur</li>
                ))}
              </ul>
            </div>
          )}

          <p>Il manque à ce navigateur :</p>
          <ul>
            {missing.map((feature) => <li key={feature.id}>{feature.label}</li>)}
          </ul>
        </div>
      </section>
    </main>
  );
}
