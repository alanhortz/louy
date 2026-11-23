/**
 * Les textes des données publiées — nom d'un lieu, sa description, une légende, une mention de licence — sont
 * écrits en français. Chaque objet peut porter, à côté, ses traductions : `i18n.en` et `i18n.nl` reprennent les
 * champs qui changent, et seulement ceux-là.
 *
 *   { "name": "Citadelle de Namur", "i18n": { "en": { "name": "Namur Citadel" }, "nl": { "name": "Citadel van Namen" } } }
 *
 * Un champ sans traduction reste en français : un nom propre (CrossFit Hawks Nest), le titre original d'une vidéo.
 */

export type TranslatedLanguage = 'en' | 'nl';

/** Par langue, les champs traduits d'un objet. */
export type Translations = Partial<Record<TranslatedLanguage, Partial<Record<string, string>>>>;

export interface Translatable {
  i18n?: Translations;
}

/** Des traductions bien formées, ou rien : une langue inconnue, un champ qui n'est pas du texte écartent l'objet. */
export const isTranslations = (value: unknown): value is Translations | undefined =>
  value === undefined || (typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.entries(value).every(([language, fields]) => (language === 'en' || language === 'nl')
      && typeof fields === 'object' && fields !== null && !Array.isArray(fields)
      && Object.values(fields).every((text) => typeof text === 'string')));

/** Le champ `field` de l'objet dans la langue demandée ; à défaut de traduction, le texte d'origine. */
export function localized<T extends Translatable, K extends keyof T & string>(item: T, field: K, language: string): T[K] {
  const translated = (item.i18n as Partial<Record<string, Partial<Record<string, string>>>> | undefined)?.[language]?.[field];
  return (typeof translated === 'string' ? translated : item[field]) as T[K];
}
