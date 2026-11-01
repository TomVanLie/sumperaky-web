import { bearing } from './util';

type Pos = {
  lat: number;
  lng: number;
  sv_heading?: number | null;
  sv_pitch?: number | null;
  cam_lat?: number | null;
  cam_lng?: number | null;
  pano_fov?: number | null;
};

// Odkazy fungují vždy, bez API klíče (oficiální Google Maps URLs).
export const streetViewLink = (h: Pos) => {
  const p = new URLSearchParams({ api: '1', map_action: 'pano', viewpoint: `${h.lat},${h.lng}` });
  if (h.sv_heading != null) p.set('heading', String(Math.round(h.sv_heading)));
  if (h.sv_pitch != null) p.set('pitch', String(Math.round(h.sv_pitch)));
  return `https://www.google.com/maps/@?${p}`;
};

export const mapyLink = (h: Pos) =>
  `https://mapy.cz/zakladni?x=${h.lng}&y=${h.lat}&z=19&source=coor&id=${h.lng}%2C${h.lat}`;

// Panorama z Mapy.com (jen Česko). yaw=point natočí kameru z nejbližšího panoramatu na dům.
// U rohových domů bývá nejbližší panorama v boční ulici. Pak se díváme ze zvoleného místa
// (cam_lat/cam_lng) s natočením na dům. Obrázky se podle podmínek nesmí ukládat.
export const mapyPanoStatic = (key: string, h: Pos, width = 1024, height = 640) => {
  const cam = h.cam_lat != null && h.cam_lng != null ? { lat: h.cam_lat, lng: h.cam_lng } : null;
  const p = new URLSearchParams({
    width: String(width),
    height: String(height),
    lon: String(cam?.lng ?? h.lng),
    lat: String(cam?.lat ?? h.lat),
    yaw: cam ? ((bearing(cam.lat, cam.lng, h.lat, h.lng) * Math.PI) / 180).toFixed(3) : 'point',
    fov: String(h.pano_fov ?? PANO_FOV),
    lang: 'cs',
    apikey: key,
  });
  if (cam) p.set('radius', String(CAMERA_RADIUS_M));
  return `https://api.mapy.cz/v1/static/pano?${p}`;
};

// Výchozí zorný úhel (radiány). Menší číslo = větší přiblížení, API dovolí 0,16 až 1,57.
export const PANO_FOV = 1;
export const PANO_FOV_MIN = 0.16;
export const PANO_FOV_MAX = 1.57;

// Jak daleko od zvoleného místa smí být panorama (aby natočení na dům sedělo).
export const CAMERA_RADIUS_M = 25;

// Statický náhled. Bez headingu Google sám natočí kameru z nejbližšího panoramatu na zadaný bod.
export const streetViewStatic = (key: string, h: Pos, size = '640x400') => {
  const p = new URLSearchParams({ size, location: `${h.lat},${h.lng}`, fov: '80', source: 'outdoor', key });
  if (h.sv_heading != null) p.set('heading', String(Math.round(h.sv_heading)));
  p.set('pitch', String(Math.round(h.sv_pitch ?? 5)));
  return `https://maps.googleapis.com/maps/api/streetview?${p}`;
};

export const streetViewEmbed = (key: string, h: Pos) => {
  const p = new URLSearchParams({ key, location: `${h.lat},${h.lng}`, fov: '80' });
  if (h.sv_heading != null) p.set('heading', String(Math.round(h.sv_heading)));
  p.set('pitch', String(Math.round(h.sv_pitch ?? 5)));
  return `https://www.google.com/maps/embed/v1/streetview?${p}`;
};

export type PanoMeta = { available: boolean; heading: number | null; date: string | null };

// Metadata panoramat jsou u Googlu zdarma. Z polohy panoramatu dopočítáme azimut na dům.
export const panoMeta = async (serverKey: string, lat: number, lng: number): Promise<PanoMeta> => {
  const p = new URLSearchParams({ location: `${lat},${lng}`, source: 'outdoor', key: serverKey });
  const res = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?${p}`);
  if (!res.ok) return { available: false, heading: null, date: null };
  const m = (await res.json()) as { status: string; date?: string; location?: { lat: number; lng: number } };
  if (m.status !== 'OK' || !m.location) return { available: false, heading: null, date: null };
  return { available: true, heading: bearing(m.location.lat, m.location.lng, lat, lng), date: m.date ?? null };
};
