import { bearing } from './util';

type Pos = { lat: number; lng: number; sv_heading?: number | null; sv_pitch?: number | null };

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
// Obrázky se podle podmínek nesmí ukládat, prohlížeč je načítá přímo.
export const mapyPanoStatic = (key: string, h: Pos, width = 1024, height = 640) =>
  `https://api.mapy.cz/v1/static/pano?${new URLSearchParams({
    width: String(width),
    height: String(height),
    lon: String(h.lng),
    lat: String(h.lat),
    yaw: 'point',
    fov: '1',
    lang: 'cs',
    apikey: key,
  })}`;

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
