import { describe, expect, it } from 'vitest';
import i18next, {
  DEFAULT_LANGUAGE, LANGUAGES, changeLanguage, currentLanguage, languageFromNavigator, languageFromUrl, languageOf, locale, t,
} from '../src/i18n/index.ts';
import { en } from '../src/i18n/en.ts';
import { fr } from '../src/i18n/fr.ts';
import { nl } from '../src/i18n/nl.ts';
import { walkNoticeText } from '../src/ui/components/WalkBar.tsx';

/** Toutes les clefs d'un dictionnaire, à plat (`a.b.c`). */
function leaves(tree: unknown, prefix = ''): string[] {
  if (typeof tree === 'string') return [prefix];
  return Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));
}

/** Les paramètres `{{x}}` d'un texte. */
const params = (text: string): string[] => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]!).sort();

const dictionaries = { fr, en, nl } as const;

describe('dictionnaires', () => {
  const reference = leaves(fr);

  it('ont tous exactement les clefs du français', () => {
    for (const language of LANGUAGES) {
      expect(leaves(dictionaries[language]).sort(), language).toEqual([...reference].sort());
    }
  });

  it('n’ont aucun texte vide', () => {
    for (const language of LANGUAGES) {
      const empty = leaves(dictionaries[language]).filter((key) => (t(key as never, { lng: language }) as string).trim() === '');
      expect(empty, language).toEqual([]);
    }
  });

  it('interpolent les mêmes paramètres dans chaque langue', () => {
    for (const key of reference) {
      const expected = params(i18next.getResource('fr', 'translation', key) as string);
      for (const language of ['en', 'nl'] as const) {
        expect(params(i18next.getResource(language, 'translation', key) as string), `${language} ${key}`).toEqual(expected);
      }
    }
  });

  it('comptent leurs clefs', () => {
    expect(reference.length).toBeGreaterThan(400);
    expect(leaves(en).length).toBe(reference.length);
    expect(leaves(nl).length).toBe(reference.length);
  });
});

describe('détection de la langue', () => {
  it('reconnaît une étiquette BCP 47 et ses variantes régionales', () => {
    expect(languageOf('nl-BE')).toBe('nl');
    expect(languageOf('en-GB')).toBe('en');
    expect(languageOf('fr')).toBe('fr');
    expect(languageOf('NL')).toBe('nl');
    expect(languageOf('de-DE')).toBeNull();
    expect(languageOf(null)).toBeNull();
  });

  it('lit `lang` dans le fragment d’abord, puis dans la requête', () => {
    expect(languageFromUrl('#c=685070,627918,1400,12,55&s=2021-2022.mns.ortho.last&o=pc&lang=nl', '')).toBe('nl');
    expect(languageFromUrl('#c=1,2,3&lang=en', '?lang=nl')).toBe('en');
    expect(languageFromUrl('#c=1,2,3', '?lang=en')).toBe('en');
    expect(languageFromUrl('#c=1,2,3&lang=de', '')).toBeNull();
    expect(languageFromUrl('', '')).toBeNull();
  });

  it('prend la première langue servie parmi celles du navigateur, sinon le français', () => {
    expect(languageFromNavigator(['nl-BE', 'fr-BE'])).toBe('nl');
    expect(languageFromNavigator(['de-DE', 'en-US'])).toBe('en');
    expect(languageFromNavigator(['de-DE', 'it'])).toBe(DEFAULT_LANGUAGE);
    expect(languageFromNavigator([])).toBe(DEFAULT_LANGUAGE);
  });

  it('démarre en français hors navigateur et suit `changeLanguage`', async () => {
    expect(currentLanguage()).toBe('fr');
    expect(locale()).toBe('fr-BE');
    await changeLanguage('nl');
    expect(currentLanguage()).toBe('nl');
    expect(locale()).toBe('nl-BE');
    expect(t('rail.layers')).toBe('Lagen');
    await changeLanguage('fr');
    expect(t('rail.layers')).toBe('Calques');
  });
});

describe('traduction', () => {
  it('interpole les paramètres', () => {
    expect(t('brand.sponsored', { name: 'Sorcery Systems' })).toBe('Sponsorisé par Sorcery Systems');
    expect(t('aircraft.phase.approach', { airfield: 'Charleroi' })).toBe('En approche de Charleroi');
    expect(t('aircraft.phase.approach', { airfield: 'Charleroi', lng: 'en' })).toBe('Approaching Charleroi');
  });

  it('accorde les pluriels', () => {
    expect(t('aircraft.found', { count: 1, total: 12 })).toBe('1 vol sur 12');
    expect(t('aircraft.found', { count: 3, total: 12 })).toBe('3 vols sur 12');
    expect(t('marker.places', { count: 1 })).toBe('1 lieu');
    expect(t('marker.places', { count: 4, lng: 'nl' })).toBe('4 plaatsen');
    expect(t('object.photoCount', { count: 2, lng: 'en' })).toBe('2 photos');
  });

  it('retombe sur le français pour une clef manquante dans une autre langue', () => {
    expect(t('brand.tagline', { lng: 'en' })).toBe('See Wallonia up close, from above, as it was');
    expect(t('brand.tagline', { lng: 'de' })).toBe('Voir la Wallonie de près, de haut, d’avant');
  });

  it('met en mots l’avis de la balade, distance comprise', () => {
    expect(walkNoticeText({ kind: 'nearest', name: 'Esplanade', distance: 3200 })).toBe('Aucun lieu filmé ici — le plus proche : Esplanade, à 3,2 km');
    expect(walkNoticeText({ kind: 'nearest', name: 'Esplanade', distance: 320 })).toBe('Aucun lieu filmé ici — le plus proche : Esplanade, à 320 m');
    expect(walkNoticeText({ kind: 'notWalkable' })).toBe('Ce lieu ne se visite pas à pied');
  });
});
