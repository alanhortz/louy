/**
 * Internationalisation : i18next, trois langues, détection de la langue du visiteur.
 *
 * La langue est choisie dans cet ordre : paramètre `lang` de l'adresse (dans le fragment
 * `#…&lang=nl`, comme le reste de la vue partagée, ou en paramètre de requête), puis le
 * choix mémorisé (`localStorage`, clef `louy:lang`), puis la langue du navigateur.
 * `nl-BE` et `en-GB` retombent sur `nl` et `en` ; tout le reste, sur le français.
 *
 * Le module s'initialise de façon synchrone : les dictionnaires sont dans le code, et les
 * machines comme le moteur peuvent appeler `t` dès leur chargement, hors de React.
 */
import i18next, { type TFunction } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { en } from './en.ts';
import { fr } from './fr.ts';
import { nl } from './nl.ts';

export const LANGUAGES = ['fr', 'nl', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'fr';
/** Clef du choix mémorisé dans le navigateur. */
export const LANG_STORAGE_KEY = 'louy:lang';
/** Paramètre d'adresse qui impose la langue. */
export const LANG_PARAM = 'lang';

export const isLanguage = (value: unknown): value is Language => LANGUAGES.includes(value as Language);

/** Code à deux lettres d'une étiquette BCP 47 (`nl-BE` → `nl`), si c'est une langue servie. */
export function languageOf(tag: string | null | undefined): Language | null {
  const base = (tag ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return isLanguage(base) ? base : null;
}

/** Langue imposée par l'adresse : dans le fragment d'abord, en paramètre de requête sinon. */
export function languageFromUrl(hash: string, search: string): Language | null {
  return languageOf(new URLSearchParams(hash.replace(/^#/, '')).get(LANG_PARAM))
    ?? languageOf(new URLSearchParams(search).get(LANG_PARAM));
}

/** La langue du visiteur, d'après ses préférences de navigateur : la première que l'on sert, sinon le français. */
export function languageFromNavigator(languages: readonly string[]): Language {
  for (const tag of languages) {
    const language = languageOf(tag);
    if (language) return language;
  }
  return DEFAULT_LANGUAGE;
}

/** Détecteur i18next : le paramètre `lang`, dans le fragment ou la requête. */
const urlDetector = {
  name: 'louyUrl',
  lookup: () => (typeof location === 'undefined' ? undefined : languageFromUrl(location.hash, location.search) ?? undefined),
};

const detector = new LanguageDetector();
detector.addDetector(urlDetector);

void i18next
  .use(detector)
  .use(initReactI18next)
  .init({
    resources: { fr: { translation: fr }, en: { translation: en }, nl: { translation: nl } },
    // hors navigateur (tests), rien à détecter : la langue de référence
    ...(typeof window === 'undefined' ? { lng: DEFAULT_LANGUAGE } : {}),
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...LANGUAGES],
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    // ce que le visiteur a demandé l'emporte sur ce qu'il a choisi avant, qui l'emporte sur son navigateur
    detection: {
      order: ['louyUrl', 'localStorage', 'navigator'],
      lookupLocalStorage: LANG_STORAGE_KEY,
      caches: ['localStorage'],
      convertDetectedLanguage: (language: string) => languageOf(language) ?? language,
    },
    interpolation: { escapeValue: false },
    returnEmptyString: false,
    // dictionnaires en mémoire : prêt dès le retour de `init`, sans attendre
    initAsync: false,
  });

/** Traduction hors de React : machines, moteur, mise en forme. */
export const t: TFunction = i18next.t.bind(i18next);

/** Langue courante, parmi celles servies. */
export const currentLanguage = (): Language => languageOf(i18next.language) ?? DEFAULT_LANGUAGE;

/** Étiquette BCP 47 de la langue courante, pour `Intl`. */
export const locale = (): string => t('meta.locale');

/** Change la langue : i18next la mémorise, et le document suit. */
export const changeLanguage = (language: Language): Promise<TFunction> => i18next.changeLanguage(language);

/** L'attribut `lang`, le titre et la description du document suivent la langue. */
function reflectLanguage(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale();
  document.title = t('meta.title');
  const set = (selector: string, content: string) => document.querySelector(selector)?.setAttribute('content', content);
  set('meta[name="description"]', t('meta.description'));
  set('meta[property="og:title"]', t('meta.title'));
  set('meta[property="og:description"]', t('meta.ogDescription'));
  set('meta[property="og:locale"]', locale().replace('-', '_'));
}

i18next.on('languageChanged', reflectLanguage);
reflectLanguage();

export default i18next;
