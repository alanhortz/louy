import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, changeLanguage, currentLanguage, type Language } from '../../i18n/index.ts';

/** Drapeau belge : trois bandes verticales, noir, jaune, rouge. */
function BelgianFlag() {
  return (
    <svg className="lang-flag" viewBox="0 0 15 13" aria-hidden="true">
      <rect width="5" height="13" fill="#000" />
      <rect x="5" width="5" height="13" fill="#FAE042" />
      <rect x="10" width="5" height="13" fill="#ED2939" />
    </svg>
  );
}

/** Union Jack simplifié : fond bleu, sautoir blanc, sautoir rouge, croix rouge bordée de blanc. */
function UnionJack() {
  return (
    <svg className="lang-flag" viewBox="0 0 60 30" aria-hidden="true">
      <clipPath id="lang-uk-clip"><rect width="60" height="30" /></clipPath>
      <g clipPath="url(#lang-uk-clip)">
        <rect width="60" height="30" fill="#012169" />
        <path d="M0 0 60 30M60 0 0 30" stroke="#fff" strokeWidth="6" />
        <path d="M0 0 60 30M60 0 0 30" stroke="#C8102E" strokeWidth="2" />
        <path d="M30 0v30M0 15h60" stroke="#fff" strokeWidth="10" />
        <path d="M30 0v30M0 15h60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </svg>
  );
}

const FLAGS: Record<Language, () => ReactElement> = { fr: BelgianFlag, nl: BelgianFlag, en: UnionJack };

/** Trois boutons compacts, sous la signature : la langue de l'interface. Le bouton actif est enfoncé. */
export function LangSwitch() {
  const { t, i18n } = useTranslation();
  // `i18n.language` est lu pour que le composant se redessine au changement ; la langue servie en découle
  void i18n.language;
  const active = currentLanguage();
  return (
    <nav className="lang-switch" aria-label={t('brand.language')}>
      {LANGUAGES.map((language) => {
        const Flag = FLAGS[language];
        return (
          <button
            key={language}
            type="button"
            className={language === active ? 'lang-btn active' : 'lang-btn'}
            lang={language}
            aria-pressed={language === active}
            title={t('brand.switchTo', { language: t(`lang.${language}`) })}
            aria-label={t('brand.switchTo', { language: t(`lang.${language}`) })}
            onClick={() => { void changeLanguage(language); }}
          >
            <Flag />
            {language.toUpperCase()}
          </button>
        );
      })}
    </nav>
  );
}
