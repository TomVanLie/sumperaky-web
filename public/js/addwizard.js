import { camMarkerElement } from './campicker.js';
import { SUMP, debounce, escapeHtml, getJson, maplibregl, mapyPano, nearestFacadeColor, sampleColor } from './common.js';

// Přidání domu přímo v hlavní mapě: 1. místo (klik nebo adresa), 2. údaje, 3. hotovo.
// Stránka se nepřenačítá, mapa zůstává tam, kde byla (šumperáky často stojí vedle sebe).

const MINE_KEY = 'sump:added';
const CAMERA_MAX_M = 150;

const stored = (key, fallback) => {
  try {
    return JSON.parse(sessionStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};

// Vzdálenost v metrech (stačí přibližně, kontroluje i server).
const meters = ([lng1, lat1], [lng2, lat2]) =>
  Math.hypot((lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180)), lat2 - lat1) * 111320;

export const createAddWizard = ({ map, onOpen, onClose }) => {
  const panel = document.getElementById('add-panel');
  const form = document.getElementById('add-form');
  const f = (name) => form.elements.namedItem(name);
  const search = document.getElementById('address-search');
  const results = document.getElementById('address-results');
  const picked = document.getElementById('picked');
  const pano = document.getElementById('picked-pano');
  const heading = document.getElementById('picked-address');
  const done = panel.querySelector('.add-done');
  const camPick = document.getElementById('cam-pick');
  const camReset = document.getElementById('cam-reset');
  const camHint = document.getElementById('cam-hint');
  const missingText = document.getElementById('pano-missing-text');
  const swatches = form.querySelector('.swatches');
  const swatchHint = swatches.querySelector('.swatch-hint');

  let active = false;
  let marker;
  let camMarker;
  let pickingCamera = false;

  window.validateAdd = () => (f('lat').value ? null : 'Klikni v mapě na dům, nebo vyhledej adresu.');

  const setStep = (n) => {
    panel.dataset.step = n;
    for (const li of panel.querySelectorAll('.stepper li')) {
      li.classList.toggle('done', Number(li.dataset.step) < n);
      li.classList.toggle('current', Number(li.dataset.step) === n);
    }
    form.hidden = n === 3;
    picked.hidden = n !== 2;
    done.hidden = n !== 3;
  };

  // ---------- Moje přidané domy (zeleně) ----------

  const mineData = () => ({
    type: 'FeatureCollection',
    features: stored(MINE_KEY, []).map(([lng, lat]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} })),
  });
  const addMineLayer = () => {
    map.addSource('mine', { type: 'geojson', data: mineData() });
    map.addLayer({
      id: 'mine',
      type: 'circle',
      source: 'mine',
      paint: {
        'circle-color': '#2f9e5b',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 16, 9],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff',
      },
    });
  };
  if (map.loaded()) addMineLayer();
  else map.on('load', addMineLayer);

  // ---------- Adresa ----------

  const addressLabel = () => {
    const street = [f('street').value, f('house_number').value].filter(Boolean).join(' ');
    return [street, f('municipality').value].filter(Boolean).join(', ') || 'Vybraný dům';
  };

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

  // ---------- Pohled z ulice, místo pohledu a přiblížení ----------

  if (!SUMP.mapyKey) pano.closest('.picked-media').hidden = true;

  const camera = () => (f('cam_lat').value ? [Number(f('cam_lng').value), Number(f('cam_lat').value)] : null);
  const fov = () => Number(form.querySelector('[name="pano_fov"]:checked')?.value) || null;
  const house = () => [Number(f('lng').value), Number(f('lat').value)];

  const showPano = () => {
    if (!SUMP.mapyKey || !f('lat').value) return;
    pano.parentElement.classList.remove('pano-missing');
    pano.hidden = false;
    missingText.textContent = camera()
      ? 'Na tomhle místě panorama není. Klikni v mapě přímo na silnici.'
      : 'U tohoto místa panorama z ulice není.';
    pano.src = mapyPano(Number(f('lat').value), Number(f('lng').value), 1024, 640, camera(), fov());
  };
  form.addEventListener('change', (e) => e.target.name === 'pano_fov' && showPano());

  const setPicking = (on) => {
    pickingCamera = on;
    camHint.hidden = !on;
    camHint.textContent = '👆 Klikni v mapě na ulici, ze které je vidět průčelí domu (nejvýš 150 m od domu).';
    camPick.textContent = on ? 'Zrušit výběr ulice' : '🔄 Dům je vidět z boku? Vyber ulici před průčelím';
    map.getCanvas().style.cursor = active ? 'crosshair' : '';
  };

  const setCamera = (lngLat) => {
    f('cam_lat').value = lngLat ? lngLat[1].toFixed(7) : '';
    f('cam_lng').value = lngLat ? lngLat[0].toFixed(7) : '';
    camReset.hidden = !lngLat;
    if (!lngLat) {
      camMarker?.remove();
      camMarker = null;
    } else if (camMarker) {
      camMarker.setLngLat(lngLat);
    } else {
      camMarker = new maplibregl.Marker({ element: camMarkerElement(), draggable: true }).setLngLat(lngLat).addTo(map);
      camMarker.on('dragend', () => {
        const p = camMarker.getLngLat();
        setCamera([p.lng, p.lat]);
      });
    }
    showPano();
  };

  camPick.addEventListener('click', () => setPicking(!pickingCamera));
  camReset.addEventListener('click', () => {
    setPicking(false);
    setCamera(null);
  });

  pano.addEventListener('error', () => pano.parentElement.classList.add('pano-missing'));
  // Mapy.com posílá CORS hlavičky, díky tomu smíme číst barvy pixelů.
  pano.crossOrigin = 'anonymous';

  // ---------- Barva fasády kliknutím do panoramatu ----------

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
      swatchHint.textContent = 'Barvu se nepodařilo přečíst, vyber ji prosím ve vzorníku.';
      return;
    }
    const radio = swatches.querySelector(`input[value="${key}"]`);
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    pickMarker.hidden = false;
    pickMarker.style.left = `${e.clientX - rect.left}px`;
    pickMarker.style.top = `${e.clientY - rect.top}px`;
    pickMarker.style.setProperty('--c', SUMP.facadeColors[key].hex);
    swatchHint.textContent = `Podle kliknutí: ${SUMP.facadeColors[key].label}. Nesedí? Klikni jinam na fasádu, nebo vyber ručně.`;
  });

  // ---------- Výběr místa ----------

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
    setStep(2);
    heading.textContent = place?.label ?? 'Hledám adresu…';
    // Nový dům, nové místo pohledu.
    setPicking(false);
    f('cam_lat').value = '';
    setCamera(null);
    fillAddress(place ?? (await getJson(`/api/reverse?lat=${lat}&lng=${lng}`).catch(() => null)));
  };

  map.on('click', (e) => {
    if (!active) return;
    if (!pickingCamera) return setLocation(e.lngLat.lat, e.lngLat.lng);
    const point = [e.lngLat.lng, e.lngLat.lat];
    if (meters(point, house()) > CAMERA_MAX_M) {
      camHint.textContent = 'To je od domu moc daleko. Klikni na ulici přímo před domem (nejvýš 150 m).';
      return;
    }
    setPicking(false);
    setCamera(point);
  });

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

  // ---------- Odeslání ----------

  const clearPicked = () => {
    marker?.remove();
    marker = null;
    setPicking(false);
    for (const name of ['lat', 'lng', 'country', 'district', 'region', 'cam_lat', 'cam_lng']) f(name).value = '';
    setCamera(null);
    pano.hidden = true;
    pano.removeAttribute('src');
    search.value = '';
    showResults([]);
    form.querySelector('.form-msg').textContent = '';
  };

  form.addEventListener('ajax:success', () => {
    const mine = stored(MINE_KEY, []);
    mine.push(house());
    sessionStorage.setItem(MINE_KEY, JSON.stringify(mine.slice(-50)));
    map.getSource('mine')?.setData(mineData());
    clearPicked();
    setStep(3);
  });

  const start = () => {
    if (active) return;
    active = true;
    panel.hidden = false;
    setStep(f('lat').value ? 2 : 1);
    setPicking(false);
    // Ověření Turnstile se mohlo načíst ve skrytém panelu, raději ho obnovíme.
    try {
      window.turnstile?.reset(form.querySelector('.cf-turnstile'));
    } catch {}
    onOpen?.();
    if (map.getZoom() < 15) search.focus();
  };

  const stop = () => {
    if (!active) return;
    active = false;
    clearPicked();
    form.reset();
    panel.hidden = true;
    map.getCanvas().style.cursor = '';
    onClose?.();
  };

  document.getElementById('add-close').addEventListener('click', stop);
  document.getElementById('add-finish').addEventListener('click', stop);
  document.getElementById('add-another').addEventListener('click', () => {
    setStep(1);
    search.focus();
  });

  return { start, stop, isActive: () => active };
};
