/** Textes des données dans la langue de l'interface : le composant se redessine quand elle change. */

import { useTranslation } from 'react-i18next';
import { localized, type Translatable } from '../domain/localized.ts';
import { currentLanguage } from '../i18n/index.ts';

export function useLocalized(): <T extends Translatable, K extends keyof T & string>(item: T, field: K) => T[K] {
  const { i18n } = useTranslation();
  // `i18n.language` est lu pour que le composant se redessine au changement de langue
  void i18n.language;
  const language = currentLanguage();
  return (item, field) => localized(item, field, language);
}
