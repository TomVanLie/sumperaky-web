// Číselníky sdílené mezi serverem a klientem (klient je dostane přes window.SUMP).

export const STATES = {
  original: { label: 'Původní stav', color: '#8a8f98' },
  partial: { label: 'Po částečné rekonstrukci', color: '#d9822b' },
  in_progress: { label: 'Probíhá rekonstrukce', color: '#e2b93b' },
  renovated: { label: 'Po rekonstrukci', color: '#2f9e5b' },
  // Když přispěvatel stav nezvolí ("Nevím").
  unknown: { label: 'Neurčeno', color: '#4a6fa5' },
} as const;

export const DESIGNS = {
  original: 'Blízký původnímu návrhu (Vaněk)',
  atypical: 'Atypicky upravený',
} as const;

// Barvy fasád. Barva vybraná kliknutím do panoramatu se zaokrouhlí na nejbližší z nich.
export const FACADE_COLORS = {
  white: { label: 'Bílá', hex: '#f3f2ec' },
  cream: { label: 'Krémová', hex: '#ece0c2' },
  beige: { label: 'Béžová, pískovcová', hex: '#c9b38d' },
  yellow: { label: 'Žlutá', hex: '#e7c34a' },
  orange: { label: 'Oranžová', hex: '#df8a3e' },
  pink: { label: 'Růžová, lososová', hex: '#e2a396' },
  red: { label: 'Červená, cihlová', hex: '#b04a3c' },
  brown: { label: 'Hnědá', hex: '#7a5a42' },
  green: { label: 'Zelená', hex: '#8eab79' },
  blue: { label: 'Modrá', hex: '#7c9cc3' },
  light_gray: { label: 'Světle šedá', hex: '#b8bbbc' },
  dark_gray: { label: 'Tmavě šedá, antracit', hex: '#50555a' },
} as const;

export const MODIFICATIONS = {
  both_floors_living: 'Obytné horní i dolní patro',
  insulation: 'Zateplení a nová fasáda',
  windows: 'Nová okna',
  roof: 'Nová střešní krytina',
  dormers: 'Vikýře nebo střešní okna',
  extension: 'Přístavba',
  superstructure: 'Nástavba nebo změna střechy',
  garage: 'Garáž nebo přestavba garáže',
  balcony: 'Zasklený nebo zastřešený balkon',
  solar: 'Fotovoltaika nebo solární panely',
} as const;

// Další znaky domu, u každého ano / ne / nevím.
export const FEATURES = {
  shutters: 'Předokenní rolety',
  garage_integrated: 'Garáž součástí domu',
  original_terrace: 'Původní terasa před domem',
} as const;
export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

export const ROOFS = {
  eternit: 'Eternit (osinkocement)',
  metal: 'Plech',
  tiles: 'Pálené nebo betonové tašky',
  shingle: 'Šindel',
  other: 'Jiná',
} as const;

export const PHOTO_PHASES = {
  before: 'Před rekonstrukcí',
  during: 'Během rekonstrukce',
  after: 'Po rekonstrukci',
  current: 'Aktuální stav',
} as const;

export const REPORT_KINDS = {
  wrong: 'Chybné údaje',
  duplicate: 'Duplicitní záznam',
  not_sumperak: 'Není to šumperák',
  owner_removal: 'Jsem majitel a žádám o skrytí',
  other: 'Jiné',
} as const;

export type StateKey = keyof typeof STATES;
export type ModificationKey = keyof typeof MODIFICATIONS;
export type RoofKey = keyof typeof ROOFS;
export type PhotoPhase = keyof typeof PHOTO_PHASES;
export type ReportKind = keyof typeof REPORT_KINDS;

export const isKey = <T extends object>(obj: T, key: unknown): key is keyof T =>
  typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);

// Hrubý obdélník ČR a SR, přesná země se ověřuje reverzním geokódováním.
export const BOUNDS = { minLat: 47.7, maxLat: 51.1, minLng: 12.0, maxLng: 22.6 };

// Přiblížení pohledu z ulice: zorný úhel panoramatu v radiánech (výchozí 1).
export const PANO_ZOOMS = [
  { label: 'Širší', fov: 1.4 },
  { label: '1×', fov: 1 },
  { label: '1,5×', fov: 0.67 },
  { label: '2×', fov: 0.5 },
  { label: '3×', fov: 0.33 },
  { label: '5×', fov: 0.2 },
] as const;

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_PHOTOS_PER_SUBMIT = 6;
export const PHOTO_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const clientConfig = () => ({
  states: STATES,
  modifications: MODIFICATIONS,
  roofs: ROOFS,
  features: FEATURES,
  designs: DESIGNS,
  facadeColors: FACADE_COLORS,
  photoPhases: PHOTO_PHASES,
  bounds: BOUNDS,
  panoZooms: PANO_ZOOMS,
  maxPhotos: MAX_PHOTOS_PER_SUBMIT,
});
