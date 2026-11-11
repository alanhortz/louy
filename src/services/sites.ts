/**
 * Sites touristiques de Wallonie : châteaux, musées, points de vue, grottes,
 * abbayes… extraits d'OpenStreetMap (© contributeurs OpenStreetMap, ODbL) par
 * `npm run sites:harvest`, et servis comme un fichier statique.
 */

export interface TouristSite {
  id: string;
  name: string;
  /** Catégorie lisible (« Château », « Musée »…). */
  kind: string;
  /** Localité la plus proche. */
  near: string;
  x: number;
  y: number;
  /** Notoriété : le site possède une fiche Wikidata ou Wikipédia. */
  notable: boolean;
}

export interface SiteIndexEntry {
  site: TouristSite;
  /** Nom, catégorie et localité, sans accents ni majuscules. */
  haystack: string;
  name: string;
}

export const MAX_RESULTS = 40;

/** Minuscules sans accents : « Château » et « chateau » doivent se trouver. */
export const fold = (text: string): string =>
  text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export async function loadSites(signal: AbortSignal): Promise<SiteIndexEntry[]> {
  const response = await fetch('/data/sites.json', { signal });
  if (!response.ok) throw new Error(`Liste des sites indisponible (${response.status})`);
  const sites = (await response.json()) as TouristSite[];
  return sites.map((site) => ({
    site,
    name: fold(site.name),
    haystack: fold(`${site.name} ${site.kind} ${site.near}`),
  }));
}

/**
 * Recherche par mots : chaque mot saisi doit apparaître. Les sites dont le nom
 * commence par la saisie passent d'abord, puis les sites notoires.
 */
export function searchSites(index: readonly SiteIndexEntry[], input: string): TouristSite[] {
  const words = fold(input).split(/\s+/).filter(Boolean);
  const needle = words.join(' ');
  const score = (entry: SiteIndexEntry) =>
    (needle && entry.name.startsWith(needle) ? 4 : 0)
    + (needle && entry.name.includes(needle) ? 2 : 0)
    + (entry.site.notable ? 1 : 0);

  return index
    .filter((entry) => words.every((word) => entry.haystack.includes(word)))
    .map((entry) => ({ entry, score: score(entry) }))
    .sort((a, b) => b.score - a.score || a.entry.site.name.localeCompare(b.entry.site.name, 'fr'))
    .slice(0, MAX_RESULTS)
    .map(({ entry }) => entry.site);
}
