import { BOUNDS } from '../domain';

type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

// Geokódování přes Photon (OpenStreetMap, bez API klíče). Odpovědi cachujeme na hraně.
const PHOTON = 'https://photon.komoot.io';
const UA = 'sumperaky.cz (https://sumperaky.cz)';

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined>;
};

export type Place = {
  lat: number;
  lng: number;
  label: string;
  street: string | null;
  houseNumber: string | null;
  municipality: string | null;
  district: string | null;
  region: string | null;
  country: 'cz' | 'sk' | null;
};

const toPlace = (f: PhotonFeature): Place => {
  const p = f.properties;
  const cc = p.countrycode?.toLowerCase();
  const municipality =
    p.city ?? p.town ?? p.village ?? (p.type === 'city' ? p.name : undefined) ?? p.locality ?? p.district ?? null;
  const street = p.street ?? (p.osm_key === 'highway' ? p.name : undefined) ?? null;
  const houseNumber = p.housenumber ?? null;
  const parts = [
    [street, houseNumber].filter(Boolean).join(' ') || (p.name && p.name !== municipality ? p.name : ''),
    municipality,
    p.county,
  ].filter(Boolean);
  return {
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    label: parts.join(', '),
    street,
    houseNumber,
    municipality,
    district: p.county ?? null,
    region: p.state ?? null,
    country: cc === 'cz' || cc === 'sk' ? cc : null,
  };
};

const cachedJson = async (url: string, ctx: WaitUntil) => {
  const cache = caches.default;
  const key = new Request(url);
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const data = await res.json();
  ctx.waitUntil(
    cache.put(key, new Response(JSON.stringify(data), { headers: { 'Cache-Control': 'public, max-age=604800' } })),
  );
  return data;
};

export const searchPlaces = async (q: string, ctx: WaitUntil): Promise<Place[]> => {
  const bbox = `${BOUNDS.minLng},${BOUNDS.minLat},${BOUNDS.maxLng},${BOUNDS.maxLat}`;
  const url = `${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=8&bbox=${bbox}`;
  const data = (await cachedJson(url, ctx)) as { features: PhotonFeature[] };
  return data.features.map(toPlace).filter((p) => p.country);
};

export const reversePlace = async (lat: number, lng: number, ctx: WaitUntil): Promise<Place | null> => {
  const url = `${PHOTON}/reverse?lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}&limit=1`;
  const data = (await cachedJson(url, ctx)) as { features: PhotonFeature[] };
  return data.features[0] ? toPlace(data.features[0]) : null;
};
