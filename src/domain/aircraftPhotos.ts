/**
 * Photographies des types d'appareils, montrées dans la fiche d'un vol.
 *
 * Ce sont des photos sous licence libre de Wikimedia Commons, récoltées par
 * `npm run aircraft:photos` : pour chaque famille d'appareils, l'image qui
 * illustre son article de Wikipédia. Chacune garde son auteur, sa licence et
 * l'adresse de sa page, affichés sous la photo — c'est la condition de ces
 * licences.
 *
 * La photo montre le type de l'appareil, pas l'avion lui-même : elle peut porter
 * les couleurs d'une autre compagnie.
 */

/** Article de Wikipédia (en anglais) de chaque famille, et les types OACI qu'elle couvre. */
export const PHOTO_FAMILIES: readonly { article: string; types: readonly string[] }[] = [
  { article: 'Airbus A320 family', types: ['A318', 'A319', 'A320', 'A321'] },
  { article: 'Airbus A320neo family', types: ['A19N', 'A20N', 'A21N'] },
  { article: 'Airbus A300', types: ['A306', 'A30B'] },
  { article: 'Airbus A310', types: ['A310'] },
  { article: 'Airbus A330', types: ['A332', 'A333', 'A332M'] },
  { article: 'Airbus A330neo', types: ['A338', 'A339'] },
  { article: 'Airbus A340', types: ['A342', 'A343', 'A345', 'A346'] },
  { article: 'Airbus A350', types: ['A359', 'A35K'] },
  { article: 'Airbus A380', types: ['A388'] },
  { article: 'Airbus Beluga', types: ['A3ST'] },
  { article: 'Airbus BelugaXL', types: ['A337'] },
  { article: 'Airbus A220', types: ['BCS1', 'BCS3'] },
  { article: 'Boeing 717', types: ['B712'] },
  { article: 'Boeing 737 Classic', types: ['B733', 'B734', 'B735'] },
  { article: 'Boeing 737 Next Generation', types: ['B736', 'B737', 'B738', 'B739'] },
  { article: 'Boeing 737 MAX', types: ['B37M', 'B38M', 'B39M', 'B3XM'] },
  { article: 'Boeing 747-400', types: ['B744'] },
  { article: 'Boeing 747-8', types: ['B748'] },
  { article: 'Boeing 747', types: ['B741', 'B742'] },
  { article: 'Boeing 757', types: ['B752', 'B753'] },
  { article: 'Boeing 767', types: ['B762', 'B763', 'B764'] },
  { article: 'Boeing 777', types: ['B772', 'B77L', 'B773', 'B77W'] },
  { article: 'Boeing 787 Dreamliner', types: ['B788', 'B789', 'B78X'] },
  { article: 'McDonnell Douglas MD-11', types: ['MD11'] },
  { article: 'McDonnell Douglas DC-10', types: ['DC10'] },
  { article: 'McDonnell Douglas MD-80', types: ['MD82', 'MD83', 'MD88'] },
  { article: 'Embraer ERJ family', types: ['E135', 'E145', 'E35L'] },
  { article: 'Embraer E-Jet family', types: ['E170', 'E75L', 'E75S', 'E190', 'E195'] },
  { article: 'Embraer E-Jet E2 family', types: ['E290', 'E295'] },
  { article: 'Bombardier CRJ100/200', types: ['CRJ1', 'CRJ2'] },
  { article: 'Bombardier CRJ700 series', types: ['CRJ7', 'CRJ9', 'CRJX'] },
  { article: 'Fokker 70', types: ['F70'] },
  { article: 'Fokker 100', types: ['F100'] },
  { article: 'British Aerospace 146', types: ['B462', 'B463', 'RJ85', 'RJ1H'] },
  { article: 'ATR 42', types: ['AT43', 'AT45', 'AT46'] },
  { article: 'ATR 72', types: ['AT72', 'AT75', 'AT76'] },
  { article: 'De Havilland Canada Dash 8', types: ['DH8A', 'DH8C', 'DH8D'] },
  { article: 'Saab 340', types: ['SF34'] },
  { article: 'Saab 2000', types: ['SB20'] },
  { article: 'Fokker 50', types: ['F50', 'F27'] },
  { article: 'Lockheed C-130 Hercules', types: ['C130'] },
  { article: 'Lockheed Martin C-130J Super Hercules', types: ['C30J'] },
  { article: 'Airbus A400M Atlas', types: ['A400'] },
  { article: 'Boeing C-17 Globemaster III', types: ['C17'] },
  { article: 'Ilyushin Il-76', types: ['IL76'] },
  { article: 'Antonov An-124 Ruslan', types: ['A124'] },
  { article: 'Boeing KC-135 Stratotanker', types: ['K35R'] },
  { article: 'Boeing E-3 Sentry', types: ['E3TF'] },
  { article: 'General Dynamics F-16 Fighting Falcon', types: ['F16'] },
  { article: 'Lockheed Martin F-35 Lightning II', types: ['F35'] },
  { article: 'Eurofighter Typhoon', types: ['EUFI'] },
  { article: 'Dassault Rafale', types: ['RFAL'] },
  { article: 'Pilatus PC-21', types: ['PC21'] },
  { article: 'Cessna CitationJet/M2', types: ['C25A', 'C25B', 'C25C', 'C25M', 'C525'] },
  { article: 'Cessna Citation Mustang', types: ['C510'] },
  { article: 'Cessna Citation Excel', types: ['C56X'] },
  { article: 'Cessna Citation Sovereign', types: ['C680'] },
  { article: 'Cessna Citation Latitude', types: ['C68A'] },
  { article: 'Cessna Citation X', types: ['C750'] },
  { article: 'Bombardier Challenger 300', types: ['CL30', 'CL35'] },
  { article: 'Bombardier Challenger 600 series', types: ['CL60'] },
  { article: 'Bombardier Global Express', types: ['GLEX', 'GL5T'] },
  { article: 'Bombardier Global 7500', types: ['GL7T'] },
  { article: 'Gulfstream G550', types: ['GLF5'] },
  { article: 'Gulfstream G650', types: ['GLF6'] },
  { article: 'Gulfstream IV', types: ['GLF4'] },
  { article: 'Embraer Phenom 100', types: ['E50P'] },
  { article: 'Embraer Phenom 300', types: ['E55P'] },
  { article: 'Embraer Praetor 600', types: ['E545', 'E550'] },
  { article: 'Dassault Falcon 2000', types: ['F2TH'] },
  { article: 'Dassault Falcon 900', types: ['F900'] },
  { article: 'Dassault Falcon 7X', types: ['FA7X', 'FA8X'] },
  { article: 'Learjet 45', types: ['LJ45', 'LJ75'] },
  { article: 'Pilatus PC-24', types: ['PC24'] },
  { article: 'Pilatus PC-12', types: ['PC12'] },
  { article: 'Pilatus PC-6 Porter', types: ['PC6T'] },
  { article: 'Socata TBM', types: ['TBM7', 'TBM8', 'TBM9'] },
  { article: 'Cessna 208 Caravan', types: ['C208'] },
  { article: 'Beechcraft Super King Air', types: ['BE20', 'B350'] },
  { article: 'Cessna 152', types: ['C150', 'C152'] },
  { article: 'Cessna 172', types: ['C172'] },
  { article: 'Cessna 182 Skylane', types: ['C182'] },
  { article: 'Piper PA-28 Cherokee', types: ['P28A', 'P28R'] },
  { article: 'Diamond DA40 Diamond Star', types: ['DA40'] },
  { article: 'Diamond DA42 Twin Star', types: ['DA42'] },
  { article: 'Cirrus SR22', types: ['SR20', 'SR22'] },
  { article: 'Robin DR400', types: ['DR40'] },
  { article: 'Eurocopter EC135', types: ['EC35'] },
  { article: 'Eurocopter EC145', types: ['EC45', 'H145'] },
  { article: 'Eurocopter AS350 Écureuil', types: ['AS50'] },
  { article: 'AgustaWestland AW109', types: ['A109'] },
  { article: 'AgustaWestland AW139', types: ['A139'] },
  { article: 'NHIndustries NH90', types: ['NH90'] },
  { article: 'Robinson R44', types: ['R44'] },
  { article: 'MD Helicopters MD Explorer', types: ['EXPL'] },
];

export interface AircraftPhoto {
  /** Adresse de l'image, à la taille de la fiche. */
  url: string;
  /** Page de l'image sur Wikimedia Commons : l'origine à citer. */
  page: string;
  author: string;
  licence: string;
  /** Ce que la photo montre, d'après son article. */
  subject: string;
}

export const AIRCRAFT_PHOTOS_PATH = '/data/aircraft-photos.json';

/** Licences sous lesquelles une photo peut être reprise avec une simple mention. */
export const isFreeLicence = (licence: string): boolean => /^(cc[ -]?by|cc[ -]?0|public domain|pd)/i.test(licence.trim());

/** Retire le balisage d'un nom d'auteur venu de Commons, et le borne. */
export const plainAuthor = (html: string): string =>
  html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Auteur inconnu';

/** Lecture tolérante de la table des photos : une entrée incomplète ou hors Commons est écartée. */
/** Les deux hôtes d'où Wikimedia sert ses vignettes ; les mêmes que dans la politique de sécurité du site. */
export const PHOTO_HOSTS = ['https://upload.wikimedia.org/', 'https://thumb.wikimedia.org/'];

export function parseAircraftPhotos(payload: unknown): Record<string, AircraftPhoto> {
  const photos: Record<string, AircraftPhoto> = {};
  if (typeof payload !== 'object' || payload === null) return photos;
  for (const [type, value] of Object.entries(payload as Record<string, Partial<AircraftPhoto>>)) {
    const fields = [value?.url, value?.page, value?.author, value?.licence, value?.subject];
    if (!/^[A-Z0-9]{2,5}$/.test(type) || !fields.every((field) => typeof field === 'string')) continue;
    if (!PHOTO_HOSTS.some((host) => value.url!.startsWith(host)) || !value.page!.startsWith('https://commons.wikimedia.org/')) continue;
    photos[type] = value as AircraftPhoto;
  }
  return photos;
}
