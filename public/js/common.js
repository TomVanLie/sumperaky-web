import * as maplibregl from '/vendor/maplibre/maplibre-gl.mjs';

export { maplibregl };
export const SUMP = window.SUMP;

export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
export const CZSK_CENTER = [17.0, 49.4];

// Popisky v mapě česky, kde je český název k dispozici.
const czechLabels = (map) => {
  for (const layer of map.getStyle().layers) {
    const field = layer.type === 'symbol' && JSON.stringify(map.getLayoutProperty(layer.id, 'text-field') ?? '');
    // Jen vrstvy s názvy, ne čísla domů nebo silnic.
    if (field && /name/.test(field)) {
      map.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:cs'], ['get', 'name']]);
    }
  }
};

export const createMap = (container, options = {}) => {
  const map = new maplibregl.Map({
    container,
    style: MAP_STYLE,
    center: CZSK_CENTER,
    zoom: 6.3,
    maxBounds: [
      [SUMP.bounds.minLng - 3, SUMP.bounds.minLat - 1.5],
      [SUMP.bounds.maxLng + 3, SUMP.bounds.maxLat + 1.5],
    ],
    attributionControl: { compact: true },
    ...options,
  });
  map.once('style.load', () => czechLabels(map));
  return map;
};

// Výraz pro barvu bodu podle stavu domu.
export const stateColorExpr = (prop) => [
  'match',
  ['get', prop],
  ...Object.entries(SUMP.states).flatMap(([k, s]) => [k, s.color]),
  '#555',
];

export const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

export const getJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

export const streetViewLink = (lat, lng, heading) => {
  const p = new URLSearchParams({ api: '1', map_action: 'pano', viewpoint: `${lat},${lng}` });
  if (heading != null) p.set('heading', String(Math.round(heading)));
  return `https://www.google.com/maps/@?${p}`;
};

export const mapyLink = (lat, lng) => `https://mapy.cz/zakladni?x=${lng}&y=${lat}&z=19&source=coor&id=${lng}%2C${lat}`;

// Panorama z Mapy.com natočené na zadaný bod (jen Česko).
export const mapyPano = (lat, lng) =>
  `https://api.mapy.cz/v1/static/pano?${new URLSearchParams({
    width: '1024',
    height: '640',
    lon: String(lng),
    lat: String(lat),
    yaw: 'point',
    fov: '1',
    lang: 'cs',
    apikey: SUMP.mapyKey,
  })}`;

// ---------- Barvy fasád ----------

const toLab = ([r, g, b]) => {
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Nejbližší barva ze vzorníku (vzdálenost v prostoru Lab odpovídá vnímání lépe než RGB).
// Fasády na panoramatech bývají ve stínu: tmavý vzorek mírně zesvětlíme a jas vážíme méně než odstín.
export const nearestFacadeColor = (rgb) => {
  const max = Math.max(...rgb, 1);
  const boost = max < 180 ? Math.min(1.35, 235 / max) : 1;
  const lab = toLab(rgb.map((c) => Math.min(255, c * boost)));
  let best = null;
  let bestDist = Infinity;
  for (const [key, c] of Object.entries(SUMP.facadeColors)) {
    const [l, a, b] = toLab(hexToRgb(c.hex));
    const d = 0.5 * (l - lab[0]) ** 2 + (a - lab[1]) ** 2 + (b - lab[2]) ** 2;
    if (d < bestDist) [best, bestDist] = [key, d];
  }
  return best;
};

// Medián barev v okolí bodu, aby nevadil šum, okno nebo stín jednoho pixelu.
export const sampleColor = (img, x, y, radius = 6) => {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const x0 = Math.max(0, Math.round(x - radius));
  const y0 = Math.max(0, Math.round(y - radius));
  const size = radius * 2 + 1;
  const { data } = ctx.getImageData(x0, y0, Math.min(size, canvas.width - x0), Math.min(size, canvas.height - y0));
  const channels = [[], [], []];
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) channels[c].push(data[i + c]);
  return channels.map((ch) => ch.sort((a, b) => a - b)[Math.floor(ch.length / 2)]);
};
