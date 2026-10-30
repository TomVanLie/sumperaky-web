import {
  SUMP,
  createMap,
  debounce,
  escapeHtml,
  getJson,
  maplibregl,
  mapyPano,
  nearestFacadeColor,
  sampleColor,
} from './common.js';

const form = document.getElementById('add-form');
const f = (name) => form.elements.namedItem(name);
const search = document.getElementById('address-search');
const results = document.getElementById('address-results');
const picked = document.getElementById('picked');
const pano = document.getElementById('picked-pano');
const heading = document.getElementById('picked-address');
const duplicates = document.getElementById('duplicates');

window.validateAdd = () => (f('lat').value ? null : 'Klikni v mapě na dům, nebo vyhledej adresu.');

// Šumperáky často stojí vedle sebe: pamatujeme si výřez mapy a domy přidané v této relaci.
const VIEW_KEY = 'sump:add-view';
const MINE_KEY = 'sump:added';
const stored = (key, fallback) => {
  try {
    return JSON.parse(sessionStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const lastView = stored(VIEW_KEY, null);

const map = createMap('add-map', lastView ? { center: lastView.center, zoom: lastView.zoom } : {});
map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.GeolocateControl({ fitBoundsOptions: { maxZoom: 18 } }), 'top-right');

map.on('moveend', () => {
  const c = map.getCenter();
  sessionStorage.setItem(VIEW_KEY, JSON.stringify({ center: [c.lng, c.lat], zoom: map.getZoom() }));
});

const pointsLayer = (id, source, color) =>
  map.addLayer({
    id,
    type: 'circle',
    source,
    paint: {
      'circle-color': color,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 18, 9],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
    },
  });

// Domy, které už na mapě jsou (modře), a ty, co jsi právě přidal a čekají na schválení (zeleně).
map.on('load', async () => {
  const mine = stored(MINE_KEY, []);
  map.addSource('existing', { type: 'geojson', data: await getJson('/api/houses.geojson').catch(() => ({ type: 'FeatureCollection', features: [] })) });
  map.addSource('mine', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: mine.map(([lng, lat]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} })),
    },
  });
  pointsLayer('existing', 'existing', '#1f3a5f');
  pointsLayer('mine', 'mine', '#2f9e5b');
});

form.addEventListener('ajax:success', () => {
  const mine = stored(MINE_KEY, []);
  mine.push([Number(f('lng').value), Number(f('lat').value)]);
  sessionStorage.setItem(MINE_KEY, JSON.stringify(mine.slice(-50)));
});

let marker;

const addressLabel = () => {
  const street = [f('street').value, f('house_number').value].filter(Boolean).join(' ');
  return [street, f('municipality').value].filter(Boolean).join(', ') || 'Vybraný dům';
};

// Adresa se vyplní automaticky. Pole v části "Opravit adresu" zůstávají k ruční opravě.
const fillAddress = (place) => {
  f('street').value = place?.street ?? '';
  f('house_number').value = place?.houseNumber ?? '';
  f('municipality').value = place?.municipality ?? '';
  f('district').value = place?.district ?? '';
  f('region').value = place?.region ?? '';
  f('country').value = place?.country ?? '';
  heading.textContent = addressLabel();
};

for (const name of ['street', 'house_number', 'municipality']) {
  f(name).addEventListener('input', () => (heading.textContent = addressLabel()));
}

const checkDuplicates = async (lat, lng) => {
  const near = await getJson(`/api/nearby?lat=${lat}&lng=${lng}`).catch(() => []);
  duplicates.hidden = !near.length;
  duplicates.innerHTML = near.length
    ? `<strong>Tenhle dům už možná máme:</strong><ul>${near
        .map((h) =>
          h.status === 'approved'
            ? `<li><a href="/dum/${h.id}" target="_blank">${escapeHtml(h.label)}</a> (${h.distance} m)</li>`
            : `<li>${escapeHtml(h.label)}, čeká na schválení (${h.distance} m)</li>`,
        )
        .join('')}</ul>`
    : '';
};

// Bez klíče Mapy.com panorama vůbec neukazujeme.
if (!SUMP.mapyKey) {
  pano.parentElement.remove();
  picked.classList.add('no-pano');
}

const showPano = (lat, lng) => {
  if (!SUMP.mapyKey) return;
  pano.parentElement.classList.remove('pano-missing');
  pano.hidden = false;
  pano.src = mapyPano(lat, lng);
};

pano.addEventListener('error', () => pano.parentElement.classList.add('pano-missing'));
// Mapy.com posílá CORS hlavičky, díky tomu smíme číst barvy pixelů.
pano.crossOrigin = 'anonymous';

// ---------- Barva fasády kliknutím do panoramatu ----------

const swatches = form.querySelector('.swatches');
const hint = swatches.querySelector('.swatch-hint');
const pickMarker = document.createElement('span');
pickMarker.className = 'pick-marker';
pickMarker.hidden = true;
pano.after(pickMarker);

pano.addEventListener('load', () => {
  pano.parentElement.classList.add('can-pick');
  pickMarker.hidden = true;
});

pano.addEventListener('click', (e) => {
  const rect = pano.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * pano.naturalWidth;
  const y = ((e.clientY - rect.top) / rect.height) * pano.naturalHeight;
  let key;
  try {
    key = nearestFacadeColor(sampleColor(pano, x, y));
  } catch {
    hint.textContent = 'Barvu se nepodařilo přečíst, vyber ji prosím ve vzorníku.';
    return;
  }
  const radio = swatches.querySelector(`input[value="${key}"]`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
  pickMarker.hidden = false;
  pickMarker.style.left = `${e.clientX - rect.left}px`;
  pickMarker.style.top = `${e.clientY - rect.top}px`;
  pickMarker.style.setProperty('--c', SUMP.facadeColors[key].hex);
  hint.textContent = `Podle kliknutí: ${SUMP.facadeColors[key].label}. Nesedí? Klikni jinam na fasádu, nebo vyber ručně.`;
});

const setLocation = async (lat, lng, place) => {
  f('lat').value = lat.toFixed(7);
  f('lng').value = lng.toFixed(7);
  if (!marker) {
    marker = new maplibregl.Marker({ draggable: true, color: '#d9822b' }).setLngLat([lng, lat]).addTo(map);
    marker.on('dragend', () => {
      const p = marker.getLngLat();
      setLocation(p.lat, p.lng);
    });
  } else {
    marker.setLngLat([lng, lat]);
  }
  picked.hidden = false;
  heading.textContent = place?.label ?? 'Hledám adresu…';
  showPano(lat, lng);
  checkDuplicates(lat, lng);
  fillAddress(place ?? (await getJson(`/api/reverse?lat=${lat}&lng=${lng}`).catch(() => null)));
  picked.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

map.on('click', (e) => setLocation(e.lngLat.lat, e.lngLat.lng));

const showResults = (places) => {
  results.hidden = !places.length;
  results.innerHTML = places.map((p, i) => `<li><button type="button" data-i="${i}">${escapeHtml(p.label)}</button></li>`).join('');
  results.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      const p = places[Number(b.dataset.i)];
      results.hidden = true;
      search.value = p.label;
      map.flyTo({ center: [p.lng, p.lat], zoom: p.houseNumber ? 18 : 16 });
      // U přesné adresy rovnou zapíchneme špendlík, jinak čekáme na kliknutí do mapy.
      if (p.houseNumber) setLocation(p.lat, p.lng, p);
    }),
  );
};

search.addEventListener(
  'input',
  debounce(async () => {
    const q = search.value.trim();
    if (q.length < 3) return showResults([]);
    showResults(await getJson(`/api/geocode?q=${encodeURIComponent(q)}`).catch(() => []));
  }, 300),
);
search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    results.querySelector('button')?.click();
  }
});
