import { createAddWizard } from './addwizard.js';
import { SUMP, createMap, getJson, mapyPano, maplibregl, stateColorExpr } from './common.js';

const map = createMap('map', { hash: true });
map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.GeolocateControl({ fitBoundsOptions: { maxZoom: 14 } }), 'top-right');

const form = document.getElementById('filters');
const counter = document.getElementById('result-count');
const layout = document.querySelector('.map-layout');
const browse = document.getElementById('browse');
const listTitle = document.getElementById('results-title');
const list = document.getElementById('results-list');
const more = document.getElementById('results-more');
const clusterClear = document.getElementById('cluster-clear');
const sheet = document.getElementById('house-sheet');
let all = { type: 'FeatureCollection', features: [] };

// Náhledy z Mapy.com stojí kredity, proto se v seznamu načítá po 10 domech.
const PAGE = 10;
let limit = PAGE;
// Domy z kliknutého shluku. Platí, dokud uživatel mapou sám nepohne.
let clusterIds = null;
let selectedId = null;

const filtered = () => {
  const states = new Set(new FormData(form).getAll('state'));
  const mod = form.mod.value;
  const color = form.color.value;
  const design = form.design.value;
  const photoOnly = form.photo.checked;
  return all.features.filter((f) => {
    const p = f.properties;
    return (
      states.has(p.s) &&
      (!mod || p.m.split(',').includes(mod)) &&
      (!color || p.c === color) &&
      (!design || p.d === design) &&
      (!photoOnly || p.p)
    );
  });
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

const km = ([lng1, lat1], [lng2, lat2]) =>
  Math.hypot((lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180)), lat2 - lat1) * 111.32;

const panoSrc = (f, width, height) => {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  return p.k !== 'sk' && SUMP.mapyKey ? mapyPano(lat, lng, width, height, p.cam || null, p.z || null) : null;
};

// Náhled: vlastní fotka, jinak panorama z Mapy.com (jen Česko). Když se nenačte, zůstane zástupný text.
const thumb = (src, { zoomable = false } = {}) => {
  const box = el('div', { class: 'thumb' }, el('span', { class: 'thumb-empty' }, 'Bez náhledu'));
  if (src) {
    const img = el('img', { src, alt: '', loading: 'lazy', class: zoomable ? 'zoomable' : null });
    img.addEventListener('error', () => img.remove());
    box.append(img);
  }
  return box;
};
const previewSrc = (f, w, h) => (f.properties.p ? `/foto/${f.properties.p}` : panoSrc(f, w, h));

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

const highlight = (f) => map.getSource('selected')?.setData({ type: 'FeatureCollection', features: f ? [f] : [] });

// ---------- Detail vybraného domu (nad mapou) ----------

// Podrobnosti se dočítají z API, ať se nemusí proklikávat na stránku domu.
const details = new Map();
const loadDetails = (id) => {
  if (!details.has(id)) details.set(id, getJson(`/api/houses/${id}`).catch(() => null));
  return details.get(id);
};

const people = (n) => `${n} ${n === 1 ? 'člověk' : n >= 2 && n <= 4 ? 'lidé' : 'lidí'}`;
const formatDate = (s) => {
  const [y, m, d] = String(s ?? '').slice(0, 10).split('-').map(Number);
  return y ? `${d}. ${m}. ${y}` : '';
};

const detailsBlock = (d) => {
  const facts = [
    ['Stav', SUMP.states[d.state]?.label],
    ['Návrh', SUMP.designs[d.design]],
    ['Fasáda', d.facadeColor ? swatch(d.facadeColor) : null],
    ['Střecha', SUMP.roofs[d.roof]],
    ['Postaven', d.yearBuilt],
    ['Rekonstrukce', d.yearRenovated],
    ['Obec', el('a', { href: `/obec/${d.municipalitySlug}` }, d.municipality)],
    ['Okres', d.district],
    ['Kraj', d.region],
  ].filter(([, v]) => v);
  const mods = d.modifications.map((m) => SUMP.modifications[m]).filter(Boolean);
  const total = d.votes.yes + d.votes.no;
  const share = total ? Math.round((d.votes.yes / total) * 100) : 0;
  return [
    el('dl', { class: 'popup-facts' }, facts.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])),
    mods.length ? el('ul', { class: 'tags' }, mods.map((m) => el('li', {}, m))) : null,
    d.note ? el('p', { class: 'note' }, d.note) : null,
    d.link ? el('p', {}, el('a', { href: d.link, target: '_blank', rel: 'noopener nofollow ugc' }, 'Související odkaz ↗')) : null,
    d.photos.length
      ? el(
          'div',
          { class: 'sheet-photos' },
          d.photos.map((ph) =>
            el(
              'figure',
              {},
              el('img', { class: 'zoomable', src: `/foto/${ph.key}`, alt: ph.caption ?? SUMP.photoPhases[ph.phase] ?? '', loading: 'lazy' }),
              el('figcaption', {}, [SUMP.photoPhases[ph.phase], ph.year].filter(Boolean).join(', ')),
            ),
          ),
        )
      : null,
    el(
      'div',
      { class: 'sheet-vote' },
      el('strong', {}, 'Je to šumperák?'),
      total ? el('div', { class: 'vote-bar' }, el('span', { class: 'vote-yes', style: `width:${share}%` })) : null,
      el('span', { class: 'muted small' }, total ? `Ano si myslí ${people(d.votes.yes)}, ne ${people(d.votes.no)}.` : 'Zatím nikdo nehlasoval.'),
    ),
    d.comments.length
      ? el(
          'div',
          { class: 'sheet-comments' },
          el('strong', {}, `Komentáře (${d.commentCount})`),
          d.comments.map((k) =>
            el('blockquote', {}, el('p', {}, k.body), el('footer', { class: 'muted small' }, `${k.nickname ?? 'Anonym'}, ${formatDate(k.createdAt)}`)),
          ),
        )
      : null,
  ];
};

const openSheet = (f) => {
  const p = f.properties;
  selectedId = p.id;
  const index = order.findIndex((o) => o.properties.id === p.id);

  const pano = panoSrc(f, 1024, 640);
  const photo = p.p ? `/foto/${p.p}` : null;
  const main = thumb(photo ?? pano, { zoomable: true });
  // Vlastní fotka i pohled z ulice: druhý obrázek jde přepnout.
  const alt = photo && pano ? el('button', { type: 'button', class: 'sheet-alt' }, thumb(pano), el('span', {}, 'Pohled z ulice')) : null;
  alt?.addEventListener('click', () => {
    const img = main.querySelector('img');
    const other = alt.querySelector('img');
    if (img && other) [img.src, other.src] = [other.src, img.src];
    alt.lastChild.textContent = alt.lastChild.textContent === 'Pohled z ulice' ? 'Fotka' : 'Pohled z ulice';
  });

  const button = (label, attrs, onClick) => {
    const b = el('button', { type: 'button', class: 'btn btn-sm', ...attrs }, label);
    b.addEventListener('click', onClick);
    return b;
  };
  const nav = el(
    'div',
    { class: 'sheet-nav' },
    button('‹ Předchozí', { disabled: index <= 0 ? '' : null, title: 'Předchozí dům (←)' }, () => step(-1)),
    el('span', { class: 'muted small' }, index >= 0 ? `${index + 1} / ${order.length}` : ''),
    button('Další ›', { disabled: index < 0 || index >= order.length - 1 ? '' : null, title: 'Další dům (→)' }, () => step(1)),
    button('✕', { 'aria-label': 'Zavřít detail', title: 'Zavřít (Esc)' }, closeSheet),
  );

  const more = el('div', { class: 'sheet-details' }, el('p', { class: 'muted small' }, 'Načítám podrobnosti…'));
  sheet.replaceChildren(
    nav,
    el('div', { class: 'sheet-media' }, main, alt, el('span', { class: 'muted small' }, 'Klikni na obrázek: zvětšení, posun, starší roky')),
    el(
      'div',
      { class: 'sheet-body' },
      el('h2', {}, el('a', { href: `/dum/${p.id}` }, p.a)),
      el('p', { class: 'sheet-meta' }, badge(p.s), p.r ? el('span', { class: 'muted' }, p.r) : null),
      more,
      el(
        'p',
        { class: 'sheet-actions' },
        el('a', { class: 'btn btn-primary', href: `/dum/${p.id}` }, 'Celý detail ›'),
        el('a', { class: 'btn', href: `/dum/${p.id}#hlasovani` }, 'Hlasovat'),
        el('a', { class: 'btn', href: `/dum/${p.id}#komentare` }, 'Komentovat'),
      ),
    ),
  );
  loadDetails(p.id).then((d) => {
    if (selectedId !== p.id) return;
    if (d) more.replaceChildren(...detailsBlock(d).filter(Boolean));
    else more.replaceChildren(el('p', { class: 'muted small' }, 'Podrobnosti se nepodařilo načíst.'));
  });

  if (sheet.hidden) {
    sheet.hidden = false;
    map.resize({ keepList: true });
  }
  sheet.scrollTop = 0;
  highlight(f);
  for (const li of list.children) li.classList.toggle('selected', Number(li.dataset.id) === p.id);
  list.querySelector('li.selected')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  // Dům musí zůstat vidět i pod detailem.
  if (!map.getBounds().contains(f.geometry.coordinates)) map.easeTo({ center: f.geometry.coordinates }, { keepList: true });
};

// Předchozí a další dům v pořadí seznamu vpravo. Seznam se přitom nepřepočítává.
const step = (delta) => {
  const index = order.findIndex((o) => o.properties.id === selectedId);
  const f = order[index + delta];
  if (index < 0 || !f) return;
  if (index + delta >= limit) {
    limit = Math.ceil((index + delta + 1) / PAGE) * PAGE;
    drawList();
  }
  openSheet(f);
  map.easeTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 16) }, { keepList: true });
};

const closeSheet = () => {
  selectedId = null;
  sheet.hidden = true;
  sheet.replaceChildren();
  highlight(null);
  for (const li of list.children) li.classList.remove('selected');
  map.resize({ keepList: true });
};

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]') || e.target.closest?.('input, textarea, select') || selectedId === null) return;
  if (e.key === 'Escape') closeSheet();
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
});

// ---------- Seznam vpravo: domy ve výřezu mapy, nebo ve vybraném shluku ----------

const listItem = (f, center) => {
  const p = f.properties;
  const item = el(
    'li',
    { 'data-id': p.id, class: p.id === selectedId ? 'selected' : null },
    el(
      'button',
      { type: 'button', class: 'result' },
      thumb(previewSrc(f, 400, 260)),
      el(
        'span',
        { class: 'result-body' },
        el('strong', {}, p.a),
        el('span', { class: 'result-meta' }, badge(p.s), center && el('span', { class: 'muted' }, formatKm(km(center, f.geometry.coordinates)))),
        el('span', { class: 'result-meta muted' }, SUMP.designs[p.d]),
        p.c && el('span', { class: 'result-meta muted' }, swatch(p.c)),
        votes(p),
      ),
    ),
  );
  const button = item.querySelector('button');
  button.addEventListener('click', () => {
    openSheet(f);
    map.easeTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 16) }, { keepList: true });
  });
  button.addEventListener('mouseenter', () => selectedId === null && highlight(f));
  button.addEventListener('mouseleave', () => selectedId === null && highlight(null));
  return item;
};

const formatKm = (d) => (d < 1 ? `${Math.max(10, Math.round((d * 1000) / 10) * 10)} m` : `${d.toFixed(1).replace('.', ',')} km`);

// Pořadí domů v seznamu (podle vzdálenosti od středu mapy). Podle něj jde i Předchozí a Další.
let order = [];
let listCenter = null;

const renderList = () => {
  const data = filtered();
  const bounds = map.getBounds();
  const center = map.getCenter().toArray();
  order = clusterIds ? data.filter((f) => clusterIds.has(f.properties.id)) : data.filter((f) => bounds.contains(f.geometry.coordinates));
  order.sort((a, b) => km(center, a.geometry.coordinates) - km(center, b.geometry.coordinates));
  // Vzdálenost od středu mapy má smysl až při přiblížení.
  listCenter = map.getZoom() >= 11 ? center : null;

  listTitle.textContent = clusterIds
    ? `${houses(order.length)} ve shluku`
    : order.length
      ? `${houses(order.length)} ve výřezu mapy`
      : 'Ve výřezu mapy nic není';
  clusterClear.hidden = !clusterIds;
  drawList();
  list.scrollTop = 0;
};

const drawList = () => {
  const scroll = list.scrollTop;
  list.replaceChildren(...order.slice(0, limit).map((f) => listItem(f, listCenter)));
  if (!order.length) list.append(el('li', { class: 'muted results-empty' }, 'Oddal mapu nebo uprav filtry.'));
  list.scrollTop = scroll;
  more.hidden = order.length <= limit;
  more.textContent = `Načíst dalších ${Math.min(PAGE, order.length - limit)} (zbývá ${order.length - limit})`;
};

more.addEventListener('click', () => {
  limit += PAGE;
  drawList();
});

clusterClear.addEventListener('click', () => {
  clusterIds = null;
  limit = PAGE;
  renderList();
});

const refresh = () => {
  const data = filtered();
  map.getSource('houses')?.setData({ type: 'FeatureCollection', features: data });
  counter.textContent = `Zobrazeno ${data.length} z ${all.features.length} domů`;
  limit = PAGE;
  renderList();
};

// Pohyb mapy uživatelem zruší výběr shluku a seznam se přepočítá podle výřezu.
map.on('moveend', (e) => {
  if (e.keepList) return;
  if (!e.fromCluster) clusterIds = null;
  limit = PAGE;
  renderList();
});

// ---------- Mapa ----------

map.on('load', async () => {
  all = await getJson('/api/houses.geojson');

  map.addSource('houses', { type: 'geojson', data: { type: 'FeatureCollection', features: filtered() }, cluster: true, clusterRadius: 40, clusterMaxZoom: 15 });
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

  // Shluk: přiblížit na jeho domy a vypsat je vpravo.
  map.on('click', 'clusters', async (e) => {
    if (wizard.isActive()) return;
    const { cluster_id: id, point_count: count } = e.features[0].properties;
    const leaves = await map.getSource('houses').getClusterLeaves(id, count, 0);
    clusterIds = new Set(leaves.map((f) => f.properties.id));
    const bounds = new maplibregl.LngLatBounds();
    for (const f of leaves) bounds.extend(f.geometry.coordinates);
    map.fitBounds(bounds, { padding: 60, maxZoom: 17 }, { fromCluster: true });
  });

  // Dům: detail mezi mapou a seznamem.
  map.on('click', 'points', (e) => {
    if (wizard.isActive()) return;
    const f = all.features.find((x) => x.properties.id === e.features[0].properties.id);
    if (f) openSheet(f);
  });

  // Při najetí myší krátký popisek s adresou.
  const hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'hover-label' });
  map.on('mouseenter', 'points', (e) => {
    map.getCanvas().style.cursor = wizard.isActive() ? 'crosshair' : 'pointer';
    if (!wizard.isActive()) hover.setLngLat(e.features[0].geometry.coordinates).setText(e.features[0].properties.a).addTo(map);
  });
  map.on('mouseleave', 'points', () => {
    map.getCanvas().style.cursor = wizard.isActive() ? 'crosshair' : '';
    hover.remove();
  });
  map.on('mouseenter', 'clusters', () => !wizard.isActive() && (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'clusters', () => (map.getCanvas().style.cursor = wizard.isActive() ? 'crosshair' : ''));
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

// ---------- Přidání domu v mapě ----------

const wizard = createAddWizard({
  map,
  onOpen: () => {
    closeSheet();
    browse.hidden = true;
    layout.classList.add('adding');
  },
  onClose: () => {
    browse.hidden = false;
    layout.classList.remove('adding');
    renderList();
  },
});

// Tlačítka "Přidat šumperák" (v panelu i v hlavičce) otevřou průvodce bez načtení stránky.
for (const a of document.querySelectorAll('a[href="/pridat"]')) {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    wizard.start();
  });
}
if (new URLSearchParams(location.search).has('pridat')) {
  history.replaceState(null, '', location.pathname + location.hash);
  wizard.start();
}
