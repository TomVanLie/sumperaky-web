import { SUMP, createMap, getJson, mapyPano, maplibregl, stateColorExpr } from './common.js';

const map = createMap('map', { hash: true });
map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.GeolocateControl({ fitBoundsOptions: { maxZoom: 14 } }), 'top-right');

const form = document.getElementById('filters');
const counter = document.getElementById('result-count');
const layout = document.querySelector('.map-layout');
const panel = document.getElementById('results');
const panelTitle = document.getElementById('results-title');
const panelList = document.getElementById('results-list');
let all = { type: 'FeatureCollection', features: [] };

const NEARBY_MAX = 20;
const NEARBY_KM = 20;
const CLUSTER_MAX = 100;

const filtered = () => {
  const states = new Set(new FormData(form).getAll('state'));
  const mod = form.mod.value;
  const color = form.color.value;
  const design = form.design.value;
  const photoOnly = form.photo.checked;
  return {
    type: 'FeatureCollection',
    features: all.features.filter((f) => {
      const p = f.properties;
      return (
        states.has(p.s) &&
        (!mod || p.m.split(',').includes(mod)) &&
        (!color || p.c === color) &&
        (!design || p.d === design) &&
        (!photoOnly || p.p)
      );
    }),
  };
};

const refresh = () => {
  const data = filtered();
  map.getSource('houses')?.setData(data);
  counter.textContent = `Zobrazeno ${data.features.length} z ${all.features.length} domů`;
};

// ---------- Pomocníci pro DOM (texty od uživatelů jen přes textContent) ----------

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'style') node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
};

const houses = (n) => `${n} ${n === 1 ? 'dům' : n >= 2 && n <= 4 ? 'domy' : 'domů'}`;

const km = (a, b) => {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const x = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot(x, lat2 - lat1) * 111.32;
};
const formatKm = (d) => (d < 1 ? `${Math.max(10, Math.round((d * 1000) / 10) * 10)} m` : `${d.toFixed(1).replace('.', ',')} km`);

// Náhled: vlastní fotka, jinak panorama z Mapy.com (jen Česko). Když se nenačte, zůstane zástupný text.
const thumb = (f, width, height) => {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  const src = p.p ? `/foto/${p.p}` : p.k !== 'sk' && SUMP.mapyKey ? mapyPano(lat, lng, width, height, p.cam || null) : null;
  const box = el('div', { class: 'thumb' }, el('span', { class: 'thumb-empty' }, 'Bez náhledu'));
  if (src) {
    const img = el('img', { src, alt: '', loading: 'lazy' });
    img.addEventListener('error', () => img.remove());
    box.append(img);
  }
  return box;
};

const badge = (state) => {
  const s = SUMP.states[state];
  return el('span', { class: 'badge', style: `--c:${s?.color ?? '#555'}` }, s?.label ?? state);
};

const swatch = (color) => {
  const c = SUMP.facadeColors[color];
  return c ? el('span', { class: 'swatch-inline' }, el('span', { class: 'swatch-dot', style: `background:${c.hex}` }), c.label) : null;
};

const votes = (p) =>
  p.v1 + p.v0 > 0 || p.cc > 0
    ? el(
        'span',
        { class: 'popup-votes' },
        p.v1 + p.v0 > 0 ? `Je to šumperák? 👍 ${p.v1} · 👎 ${p.v0}` : null,
        p.v1 + p.v0 > 0 && p.cc > 0 ? ' · ' : null,
        p.cc > 0 ? `💬 ${p.cc}` : null,
      )
    : null;

// ---------- Bublina ----------

let popup = null;

const popupContent = (f) => {
  const p = f.properties;
  const mods = p.m ? p.m.split(',').map((m) => SUMP.modifications[m]).filter(Boolean) : [];
  const facts = [
    ['Návrh', SUMP.designs[p.d]],
    ['Fasáda', p.c ? swatch(p.c) : null],
    ['Postaven', p.yb || null],
    ['Rekonstrukce', p.yr || null],
    ['Úpravy', mods.length ? mods.join(', ') : null],
  ].filter(([, v]) => v);
  return el(
    'div',
    { class: 'popup' },
    el('a', { href: `/dum/${p.id}`, class: 'popup-img' }, thumb(f, 600, 380)),
    el('a', { href: `/dum/${p.id}`, class: 'popup-title' }, p.a),
    badge(p.s),
    el('dl', { class: 'popup-facts' }, facts.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])),
    votes(p),
    el('a', { href: `/dum/${p.id}`, class: 'popup-more' }, 'Detail domu, fotky a komentáře ›'),
  );
};

// Bublina je vysoká, proto se otevírá nad bodem a mapa bod posune do spodní části.
const popupOffset = () => [0, Math.min(220, map.getContainer().clientHeight * 0.3)];

const openPopup = (f) => {
  popup?.remove();
  popup = new maplibregl.Popup({ anchor: 'bottom', offset: 12, maxWidth: '300px', focusAfterOpen: false })
    .setLngLat(f.geometry.coordinates)
    .setDOMContent(popupContent(f))
    .addTo(map);
  highlight(f);
};

// ---------- Zvýraznění vybraného domu ----------

const highlight = (f) => {
  map.getSource('selected')?.setData({ type: 'FeatureCollection', features: f ? [f] : [] });
};

// ---------- Panel s výpisem ----------

const openPanel = (title, features, selectedId, origin) => {
  panelTitle.textContent = title;
  panelList.replaceChildren(
    ...features.map((f) => {
      const p = f.properties;
      const distance = origin && p.id !== selectedId ? formatKm(km(origin, f.geometry.coordinates)) : null;
      const item = el(
        'li',
        { class: p.id === selectedId ? 'selected' : null },
        el(
          'button',
          { type: 'button', class: 'result' },
          thumb(f, 400, 260),
          el(
            'span',
            { class: 'result-body' },
            el('strong', {}, p.a),
            el('span', { class: 'result-meta' }, badge(p.s), distance && el('span', { class: 'muted' }, distance)),
            el('span', { class: 'result-meta muted' }, SUMP.designs[p.d]),
            p.c && el('span', { class: 'result-meta muted' }, swatch(p.c)),
            votes(p),
          ),
        ),
      );
      const button = item.querySelector('button');
      button.addEventListener('click', () => {
        for (const li of panelList.children) li.classList.toggle('selected', li === item);
        map.flyTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 17), offset: popupOffset() });
        openPopup(f);
      });
      button.addEventListener('mouseenter', () => highlight(f));
      return item;
    }),
  );
  panelList.scrollTop = 0;
  if (panel.hidden) {
    panel.hidden = false;
    layout.classList.add('with-results');
    map.resize();
  }
};

const closePanel = () => {
  panel.hidden = true;
  layout.classList.remove('with-results');
  map.resize();
};
document.getElementById('results-close').addEventListener('click', closePanel);

// Vybraný dům a nejbližší další domy (podle aktuálních filtrů).
const showNearby = (f) => {
  const origin = f.geometry.coordinates;
  const others = filtered()
    .features.filter((o) => o.properties.id !== f.properties.id)
    .map((o) => ({ o, d: km(origin, o.geometry.coordinates) }))
    .filter((x) => x.d <= NEARBY_KM)
    .sort((a, b) => a.d - b.d)
    .slice(0, NEARBY_MAX)
    .map((x) => x.o);
  const title = others.length ? `Vybraný dům a ${houses(others.length)} v okolí` : 'Vybraný dům';
  openPanel(title, [f, ...others], f.properties.id, origin);
};

// ---------- Mapa ----------

map.on('load', async () => {
  all = await getJson('/api/houses.geojson');

  map.addSource('houses', { type: 'geojson', data: filtered(), cluster: true, clusterRadius: 40, clusterMaxZoom: 15 });
  map.addSource('selected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'houses',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#d9822b',
      'circle-opacity': 0.92,
      'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 26, 200, 32],
      'circle-stroke-width': 3,
      'circle-stroke-color': '#fff',
    },
  });
  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: 'houses',
    filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13, 'text-font': ['Noto Sans Bold'] },
    paint: { 'text-color': '#fff' },
  });
  map.addLayer({
    id: 'selected-ring',
    type: 'circle',
    source: 'selected',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 11, 16, 16],
      'circle-color': '#1f3a5f',
      'circle-opacity': 0.18,
      'circle-stroke-width': 3,
      'circle-stroke-color': '#1f3a5f',
    },
  });
  map.addLayer({
    id: 'points',
    type: 'circle',
    source: 'houses',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': stateColorExpr('s'),
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 16, 9],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
    },
  });

  refresh();

  // Shluk: přiblížit a vypsat jeho domy do panelu.
  map.on('click', 'clusters', async (e) => {
    const f = e.features[0];
    const source = map.getSource('houses');
    const { cluster_id: id, point_count: count } = f.properties;
    const [zoom, leaves] = await Promise.all([source.getClusterExpansionZoom(id), source.getClusterLeaves(id, CLUSTER_MAX, 0)]);
    map.easeTo({ center: f.geometry.coordinates, zoom });
    popup?.remove();
    highlight(null);
    leaves.sort((a, b) => a.properties.a.localeCompare(b.properties.a, 'cs'));
    const title = count > CLUSTER_MAX ? `${houses(count)} ve shluku, prvních ${CLUSTER_MAX}` : `${houses(count)} ve shluku`;
    openPanel(title, leaves, null, null);
  });

  // Dům: bublina s náhledem a panel s domy v okolí.
  map.on('click', 'points', (e) => {
    const f = all.features.find((x) => x.properties.id === e.features[0].properties.id) ?? e.features[0];
    map.easeTo({ center: f.geometry.coordinates, offset: popupOffset() });
    openPopup(f);
    showNearby(f);
  });

  for (const layer of ['clusters', 'points']) {
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
  }
});

form.addEventListener('change', refresh);

// Hledání obce nebo adresy: přeletí na první výsledek.
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = form.q.value.trim();
  if (q.length < 3) return;
  const results = await getJson(`/api/geocode?q=${encodeURIComponent(q)}`).catch(() => []);
  if (results[0]) map.flyTo({ center: [results[0].lng, results[0].lat], zoom: results[0].street ? 16 : 13 });
  else counter.textContent = 'Místo nenalezeno.';
});
