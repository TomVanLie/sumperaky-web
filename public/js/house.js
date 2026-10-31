import { createMap, maplibregl, mapyPano, stateColorExpr } from './common.js';

const article = document.querySelector('article.house');
const el = document.getElementById('mini-map');

const houseLayer = (map, lng, lat, state) => {
  map.addSource('house', {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { s: state } },
  });
  map.addLayer({
    id: 'house',
    type: 'circle',
    source: 'house',
    paint: { 'circle-color': stateColorExpr('s'), 'circle-radius': 9, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' },
  });
};

if (article && el) {
  const lng = Number(article.dataset.lng);
  const lat = Number(article.dataset.lat);
  const map = createMap(el, { center: [lng, lat], zoom: 15, interactive: true, cooperativeGestures: true });
  map.on('load', () => houseLayer(map, lng, lat, article.dataset.state));
}

// Oprava pohledu z ulice: klik do mapy zvolí místo, odkud se na dům díváme.
const fix = document.querySelector('.cam-fix');
if (article && fix) {
  const lng = Number(article.dataset.lng);
  const lat = Number(article.dataset.lat);
  const form = fix.querySelector('form');
  const frame = fix.querySelector('.cam-fix-preview');
  const img = frame.querySelector('img');
  const submit = form.querySelector('button[type="submit"]');
  let map;
  let marker;

  img.addEventListener('load', () => frame.classList.remove('pano-missing'));
  img.addEventListener('error', () => frame.classList.add('pano-missing'));

  const setCamera = (cam) => {
    form.cam_lat.value = cam[1].toFixed(7);
    form.cam_lng.value = cam[0].toFixed(7);
    submit.disabled = false;
    img.src = mapyPano(lat, lng, 1024, 640, cam);
    if (!marker) {
      const icon = document.createElement('div');
      icon.className = 'cam-marker';
      icon.textContent = '👁';
      marker = new maplibregl.Marker({ element: icon, draggable: true }).setLngLat(cam).addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLngLat();
        setCamera([p.lng, p.lat]);
      });
    } else {
      marker.setLngLat(cam);
    }
  };

  // Mapu vytvoříme až po rozbalení, ať se zbytečně nenačítá.
  fix.addEventListener('toggle', () => {
    if (!fix.open || map) return;
    map = createMap(fix.querySelector('.cam-fix-map'), { center: [lng, lat], zoom: 18 });
    map.getCanvas().style.cursor = 'crosshair';
    map.on('load', () => houseLayer(map, lng, lat, article.dataset.state));
    map.on('click', (e) => setCamera([e.lngLat.lng, e.lngLat.lat]));
    const current = fix.dataset.cam ? fix.dataset.cam.split(',').map(Number) : null;
    if (current) setCamera(current);
    submit.disabled = true;
  });
}
