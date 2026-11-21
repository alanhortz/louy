import { useTranslation } from 'react-i18next';
import support from '../../config/browser-support.json';
import type { SupportReport } from '../../services/capabilities.ts';

/** Identifiants connus de la table de compatibilité : chacun a sa clef de conseil et de fonctionnalité. */
type BrowserId = 'ios' | 'samsung' | 'edge' | 'firefox' | 'chrome' | 'safari';
type FeatureId = keyof typeof support.features;

/** Le navigateur ne peut pas faire tourner le viewer : on dit quelle version installer. */
export function UnsupportedNotice({ report }: { report: SupportReport }) {
  const { t } = useTranslation();
  const { browser, minimum, missing } = report;
  const required = minimum ? support.minimum.find((entry) => entry.name === minimum.name) : undefined;
  return (
    <main className="notice">
      <section className="panel notice-card">
        <div className="panel-glow" />
        <div className="panel-inner">
          <h1>{t('unsupported.title')}</h1>
          <p>{t('unsupported.intro')}</p>

          <p className="notice-detected">
            {t('unsupported.detected', { browser: `${browser.name}${browser.version ? ` ${browser.version}` : ''}` })}
          </p>

          {minimum ? (
            <div className="notice-required">
              <p>{t('unsupported.required')} <strong>{minimum.name} {minimum.version}</strong> {t('unsupported.orLater')}</p>
              <p>{required ? t(`unsupported.hint.${required.id as BrowserId}`) : minimum.hint}</p>
            </div>
          ) : (
            <div className="notice-required">
              <p>{t('unsupported.useOne')}</p>
              <ul>
                {support.minimum.map((entry) => (
                  <li key={entry.id}>{t('unsupported.orLaterItem', { name: entry.name, version: entry.version })}</li>
                ))}
              </ul>
            </div>
          )}

          <p>{t('unsupported.missing')}</p>
          <ul>
            {missing.map((feature) => <li key={feature.id}>{t(`unsupported.feature.${feature.id as FeatureId}`)}</li>)}
          </ul>
        </div>
      </section>
    </main>
  );
}
