import { BOUNDS, DESIGNS, FACADE_COLORS, FEATURES, MODIFICATIONS, ROOFS, STATES, isKey } from './domain';
import { PANO_FOV_MAX, PANO_FOV_MIN } from './lib/streetview';
import { distance, int, num, slugify, str, url } from './lib/util';

// Místo pohledu smí být nejvýš takhle daleko od domu.
export const CAMERA_MAX_M = 150;

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
  cam_lat: number | null;
  cam_lng: number | null;
  pano_fov: number | null;
  shutters: 0 | 1 | null;
  garage_integrated: 0 | 1 | null;
  original_terrace: 0 | 1 | null;
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
  'cam_lat',
  'cam_lng',
  'pano_fov',
  'shutters',
  'garage_integrated',
  'original_terrace',
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


  const camera = parseCamera(form.cam_lat, form.cam_lng, lat, lng);
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
      sv_heading: parseHeading(form.sv_heading),
      sv_pitch: parsePitch(form.sv_pitch),
      cam_lat: camera?.lat ?? null,
      cam_lng: camera?.lng ?? null,
      pano_fov: parseFov(form.pano_fov),
      shutters: yesNo(form.shutters),
      garage_integrated: yesNo(form.garage_integrated),
      original_terrace: yesNo(form.original_terrace),
    },
  };
};

// Ano / ne / nevím (NULL).
const yesNo = (raw: unknown) => (raw === '1' ? 1 : raw === '0' ? 0 : null);

// Místo pohledu z ulice: platné jen blízko domu, jinak se ignoruje.
export const parseCamera = (rawLat: unknown, rawLng: unknown, lat: number, lng: number) => {
  const camLat = num(rawLat, BOUNDS.minLat, BOUNDS.maxLat);
  const camLng = num(rawLng, BOUNDS.minLng, BOUNDS.maxLng);
  if (camLat === null || camLng === null || distance(lat, lng, camLat, camLng) > CAMERA_MAX_M) return null;
  return { lat: camLat, lng: camLng };
};

// Přiblížení pohledu z ulice. Prázdné nebo výchozí = NULL.
export const parseFov = (raw: unknown) => {
  const fov = num(raw, PANO_FOV_MIN, PANO_FOV_MAX);
  return fov === null || Math.abs(fov - 1) < 1e-3 ? null : Math.round(fov * 1000) / 1000;
};

// Ručně natočený pohled z ulice ve stupních (sklon kladný nahoru), zaokrouhlený na desetiny.
export const parseHeading = (raw: unknown) => {
  const deg = num(raw, -360, 720);
  return deg === null ? null : Math.round((((deg % 360) + 360) % 360) * 10) / 10;
};
export const parsePitch = (raw: unknown) => {
  const deg = num(raw, -90, 90);
  return deg === null || Math.abs(deg) < 0.05 ? null : Math.round(deg * 10) / 10;
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
  sv_heading: 'Natočení pohledu z ulice',
  sv_pitch: 'Sklon pohledu z ulice',
  cam_lat: 'Místo pohledu z ulice (šířka)',
  cam_lng: 'Místo pohledu z ulice (délka)',
  pano_fov: 'Přiblížení pohledu z ulice',
  ...FEATURES,
};
