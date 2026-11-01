import { createMap, maplibregl, mapyPano, stateColorExpr } from './common.js';

// Výběr místa pohledu z ulice a přiblížení (detail domu, moderace). Značka 👁 = odkud se díváme.
// Mapu vytváříme až ve chvíli, kdy je výběr vidět (bývá ve sbaleném panelu).

export const houseLayer = (map, lng, lat, state) => {
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

export const camMarkerElement = () => {
  const icon = document.createElement('div');
  icon.className = 'cam-marker';
  icon.textContent = '👁';
  icon.title = 'Odsud se díváme na dům';
  return icon;
};

const initPicker = (box) => {
  const lng = Number(box.dataset.lng);
  const lat = Number(box.dataset.lat);
  const camLat = box.querySelector('[name="cam_lat"]');
  const camLng = box.querySelector('[name="cam_lng"]');
  const frame = box.querySelector('.cam-picker-preview');
  const img = frame.querySelector('img');
  let map;
  let marker;

  img.addEventListener('load', () => frame.classList.remove('pano-missing'));
  img.addEventListener('error', () => frame.classList.add('pano-missing'));

  const camera = () => (camLat.value ? [Number(camLng.value), Number(camLat.value)] : null);
  const fov = () => Number(box.querySelector('[name="pano_fov"]:checked')?.value) || null;

  const preview = () => {
    frame.classList.remove('pano-missing');
    img.src = mapyPano(lat, lng, 1024, 640, camera(), fov());
  };

  const changed = () => {
    preview();
    box.dispatchEvent(new Event('cam-change', { bubbles: true }));
  };

  const setCamera = (cam) => {
    camLat.value = cam ? cam[1].toFixed(7) : '';
    camLng.value = cam ? cam[0].toFixed(7) : '';
    if (!cam) {
      marker?.remove();
      marker = null;
    } else if (marker) {
      marker.setLngLat(cam);
    } else if (map) {
      marker = new maplibregl.Marker({ element: camMarkerElement(), draggable: true }).setLngLat(cam).addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLngLat();
        setCamera([p.lng, p.lat]);
        changed();
      });
    }
  };

  box.querySelector('.cam-auto').addEventListener('click', () => {
    setCamera(null);
    changed();
  });
  box.addEventListener('change', (e) => {
    if (e.target.name === 'pano_fov') changed();
  });

  const start = () => {
    if (map) return;
    map = createMap(box.querySelector('.cam-picker-map'), { center: camera() ?? [lng, lat], zoom: 18 });
    map.getCanvas().style.cursor = 'crosshair';
    map.on('load', () => houseLayer(map, lng, lat, box.dataset.state));
    map.on('click', (e) => {
      setCamera([e.lngLat.lng, e.lngLat.lat]);
      changed();
    });
    setCamera(camera());
    preview();
  };

  const details = box.closest('details');
  if (details && !details.open) details.addEventListener('toggle', () => details.open && start());
  else start();
};

if (window.SUMP.mapyKey) for (const box of document.querySelectorAll('.cam-picker')) initPicker(box);
