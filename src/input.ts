import { BOUNDS, DESIGNS, FACADE_COLORS, MODIFICATIONS, ROOFS, STATES, isKey } from './domain';
import { int, num, slugify, str, url } from './lib/util';

export type HouseInput = {
  lat: number;
  lng: number;
  country: 'cz' | 'sk';
  street: string | null;
  house_number: string | null;
  hide_number: number;
  municipality: string;
  municipality_slug: string;
  district: string | null;
  region: string | null;
  state: string;
  design: string;
  modifications: string[];
  roof: string | null;
  facade_color: string | null;
  year_built: number | null;
  year_renovated: number | null;
  note: string | null;
  link: string | null;
  sv_heading: number | null;
  sv_pitch: number | null;
};

// Pole, která smí měnit návrh úprav (poloha a adresa včetně).
export const EDITABLE_FIELDS = [
  'lat',
  'lng',
  'street',
  'house_number',
  'hide_number',
  'municipality',
  'state',
  'design',
  'modifications',
  'roof',
  'facade_color',
  'year_built',
  'year_renovated',
  'note',
  'link',
  'sv_heading',
  'sv_pitch',
] as const;

type Form = Record<string, string | File | (string | File)[]>;

const all = (form: Form, key: string) => {
  const v = form[key] ?? form[`${key}[]`];
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string');
};

export const parseHouseInput = (form: Form): { data?: HouseInput; error?: string } => {
  const lat = num(form.lat, BOUNDS.minLat, BOUNDS.maxLat);
  const lng = num(form.lng, BOUNDS.minLng, BOUNDS.maxLng);
  if (lat === null || lng === null) return { error: 'Poloha musí být na území Česka nebo Slovenska.' };

  const country = form.country === 'sk' ? 'sk' : form.country === 'cz' ? 'cz' : null;
  if (!country) return { error: 'Dům se nachází mimo Česko a Slovensko.' };

  const municipality = str(form.municipality, 120);
  if (!municipality) return { error: 'Nepodařilo se zjistit obec. Doplň ji v části Opravit adresu.' };


  const modifications = [...new Set(all(form, 'modifications').filter((m) => isKey(MODIFICATIONS, m)))];
  const thisYear = new Date().getFullYear();

  return {
    data: {
      lat,
      lng,
      country,
      street: str(form.street, 120),
      house_number: str(form.house_number, 20),
      hide_number: form.hide_number === '1' || form.hide_number === 'on' ? 1 : 0,
      municipality,
      municipality_slug: slugify(municipality),
      district: str(form.district, 120),
      region: str(form.region, 120),
      state: isKey(STATES, form.state) ? form.state : 'unknown',
      design: isKey(DESIGNS, form.design) ? form.design : 'original',
      modifications,
      roof: isKey(ROOFS, form.roof) ? form.roof : null,
      facade_color: isKey(FACADE_COLORS, form.facade_color) ? form.facade_color : null,
      year_built: int(form.year_built, 1950, thisYear),
      year_renovated: int(form.year_renovated, 1960, thisYear + 2),
      note: str(form.note, 2000),
      link: url(form.link),
      sv_heading: num(form.sv_heading, 0, 360),
      sv_pitch: num(form.sv_pitch, -90, 90),
    },
  };
};

// Rozdíl mezi současným stavem a návrhem, jen u povolených polí.
export const diffHouse = (current: Record<string, unknown>, proposed: HouseInput) => {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of EDITABLE_FIELDS) {
    const from = current[f] ?? null;
    const to = proposed[f] ?? null;
    const same =
      f === 'modifications'
        ? JSON.stringify([...((from as string[]) ?? [])].sort()) === JSON.stringify([...((to as string[]) ?? [])].sort())
        : typeof from === 'number' && typeof to === 'number'
          ? Math.abs(from - to) < 1e-6
          : from === to;
    if (!same) changes[f] = { from, to };
  }
  return changes;
};

export const FIELD_LABELS: Record<string, string> = {
  lat: 'Poloha (šířka)',
  lng: 'Poloha (délka)',
  street: 'Ulice',
  house_number: 'Číslo domu',
  hide_number: 'Skrýt číslo domu',
  municipality: 'Obec',
  state: 'Stav',
  design: 'Návrh',
  modifications: 'Úpravy',
  roof: 'Střešní krytina',
  facade_color: 'Barva fasády',
  year_built: 'Rok stavby',
  year_renovated: 'Rok rekonstrukce',
  note: 'Poznámka',
  link: 'Odkaz',
  sv_heading: 'Natočení Street View',
  sv_pitch: 'Sklon Street View',
};
