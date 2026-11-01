import { createMap, maplibregl, mapyPano, stateColorExpr } from './common.js';
import { mountPano } from './panoviewer.js';

// Výběr pohledu z ulice (detail domu, moderace): místo v mapě, natočení a přiblížení v živém náhledu.
// Značka 👁 = odkud se díváme.
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
  const field = (name) => box.querySelector(`[name="${name}"]`);
  const [camLat, camLng, fovField, headingField, pitchField] = ['cam_lat', 'cam_lng', 'pano_fov', 'sv_heading', 'sv_pitch'].map(field);
  const frame = box.querySelector('.cam-picker-preview');
  const img = frame.querySelector('img');
  const status = box.querySelector('.cam-status');
  let map;
  let marker;
  let live = null;

  const value = (input) => (input.value === '' ? null : Number(input.value));
  const camera = () => (camLat.value ? [Number(camLng.value), Number(camLat.value)] : null);
  const deg = (rad) => (rad * 180) / Math.PI;

  const changed = (text) => {
    status.textContent = text;
    box.dispatchEvent(new Event('cam-change', { bubbles: true }));
  };

  // Natočení a přiblížení z živého náhledu jdou rovnou do formuláře. Místo pohledu je místo snímku.
  const onView = (v) => {
    headingField.value = deg(v.yaw).toFixed(1);
    pitchField.value = Math.abs(deg(v.pitch)) < 0.05 ? '' : deg(v.pitch).toFixed(1);
    const fov = Math.min(1.57, Math.max(0.16, v.fov));
    fovField.value = Math.abs(fov - 1) < 1e-3 ? '' : fov.toFixed(3);
    setCamera([v.lon, v.lat]);
    changed('Pohled je nastavený, ulož formulář.');
  };

  const preview = () => {
    live?.destroy();
    img.src = mapyPano(lat, lng, 1024, 640, camera(), value(fovField), value(headingField), value(pitchField));
    live = mountPano(frame, img.src, { onView });
  };

  // Nové místo pohledu: natočení se znovu dopočítá na dům.
  const moved = (cam) => {
    setCamera(cam);
    headingField.value = '';
    pitchField.value = '';
    preview();
    changed(cam ? 'Místo pohledu změněno, v náhledu ho můžeš ještě natočit.' : 'Automatický pohled z nejbližšího místa.');
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
        moved([p.lng, p.lat]);
      });
    }
  };

  box.querySelector('.cam-auto').addEventListener('click', () => {
    fovField.value = '';
    moved(null);
  });

  const start = () => {
    if (map) return;
    map = createMap(box.querySelector('.cam-picker-map'), { center: camera() ?? [lng, lat], zoom: 18 });
    map.getCanvas().style.cursor = 'crosshair';
    map.on('load', () => houseLayer(map, lng, lat, box.dataset.state));
    map.on('click', (e) => moved([e.lngLat.lng, e.lngLat.lat]));
    setCamera(camera());
    preview();
  };

  const details = box.closest('details');
  if (details && !details.open) details.addEventListener('toggle', () => details.open && start());
  else start();
};

if (window.SUMP.mapyKey) for (const box of document.querySelectorAll('.cam-picker')) initPicker(box);
