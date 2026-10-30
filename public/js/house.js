import { createMap, stateColorExpr } from './common.js';

const article = document.querySelector('article.house');
const el = document.getElementById('mini-map');

if (article && el) {
  const lng = Number(article.dataset.lng);
  const lat = Number(article.dataset.lat);
  const map = createMap(el, { center: [lng, lat], zoom: 15, interactive: true, cooperativeGestures: true });
  map.on('load', () => {
    map.addSource('house', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { s: article.dataset.state } },
    });
    map.addLayer({
      id: 'house',
      type: 'circle',
      source: 'house',
      paint: { 'circle-color': stateColorExpr('s'), 'circle-radius': 9, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' },
    });
  });
}
