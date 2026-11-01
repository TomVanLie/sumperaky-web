import { houseLayer } from './campicker.js';
import { createMap } from './common.js';

const article = document.querySelector('article.house');
const el = document.getElementById('mini-map');

if (article && el) {
  const lng = Number(article.dataset.lng);
  const lat = Number(article.dataset.lat);
  const map = createMap(el, { center: [lng, lat], zoom: 15, interactive: true, cooperativeGestures: true });
  map.on('load', () => houseLayer(map, lng, lat, article.dataset.state));
}

// Oprava pohledu z ulice: odeslat jde až po změně místa nebo přiblížení.
for (const fix of document.querySelectorAll('.cam-fix')) {
  const submit = fix.querySelector('button[type="submit"]');
  fix.addEventListener('cam-change', () => (submit.disabled = false));
}
