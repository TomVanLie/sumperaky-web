import { SUMP, createMap, escapeHtml, getJson, maplibregl, stateColorExpr } from './common.js';

const map = createMap('map', { hash: true });
map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.GeolocateControl({ fitBoundsOptions: { maxZoom: 14 } }), 'top-right');

const form = document.getElementById('filters');
const counter = document.getElementById('result-count');
let all = { type: 'FeatureCollection', features: [] };

const filtered = () => {
  const states = new Set(new FormData(form).getAll('state'));
  const mod = form.mod.value;
  const color = form.color.value;
  const photoOnly = form.photo.checked;
  return {
    type: 'FeatureCollection',
    features: all.features.filter((f) => {
      const p = f.properties;
      return (
        states.has(p.s) && (!mod || p.m.split(',').includes(mod)) && (!color || p.c === color) && (!photoOnly || p.p)
      );
    }),
  };
};

const refresh = () => {
  const data = filtered();
  map.getSource('houses')?.setData(data);
  counter.textContent = `Zobrazeno ${data.features.length} z ${all.features.length} domů`;
};

map.on('load', async () => {
  all = await getJson('/api/houses.geojson');

  map.addSource('houses', { type: 'geojson', data: filtered(), cluster: true, clusterRadius: 45, clusterMaxZoom: 13 });

  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'houses',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#1f3a5f',
      'circle-opacity': 0.85,
      'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 26, 200, 32],
      'circle-stroke-width': 2,
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

  map.on('click', 'clusters', async (e) => {
    const f = e.features[0];
    const zoom = await map.getSource('houses').getClusterExpansionZoom(f.properties.cluster_id);
    map.easeTo({ center: f.geometry.coordinates, zoom });
  });

  map.on('click', 'points', (e) => {
    const p = e.features[0].properties;
    const state = SUMP.states[p.s];
    const img = p.p ? `<img src="/foto/${escapeHtml(p.p)}" alt="" />` : '';
    new maplibregl.Popup({ offset: 10, maxWidth: '280px' })
      .setLngLat(e.features[0].geometry.coordinates)
      .setHTML(
        `<a class="popup" href="/dum/${p.id}">${img}<strong>${escapeHtml(p.a)}</strong>
         <span class="badge" style="--c:${state?.color}">${escapeHtml(state?.label)}</span>
         <span class="popup-more">Detail domu ›</span></a>`,
      )
      .addTo(map);
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
