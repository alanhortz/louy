/**
 * Typage des clés de traduction : i18next lit ici la forme des ressources, dérivée du
 * dictionnaire français. `t('une.clé.inconnue')` est alors une erreur de compilation.
 */
import type { fr } from './fr.ts';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof fr };
  }
}
