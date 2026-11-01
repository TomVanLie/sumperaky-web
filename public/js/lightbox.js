// Zvětšení fotky nebo pohledu z ulice (obrázky s třídou zoomable).
// U panoramatu z Mapy.com jde snímek posouvat a přibližovat: každý krok je nový statický snímek (4 kredity).
// Starší roky statický náhled neumí, ty ukáže interaktivní prohlížeč Mapy.com (platí se za dlaždice,
// jedno otevření stojí zhruba 40 kreditů), proto se načítá až na kliknutí.

const SUMP = window.SUMP;
const FOVS = SUMP.panoZooms.map((z) => z.fov);
const PANO_JS = 'https://api.mapy.cz/js/panorama/v1/panorama.js';
const TAU = Math.PI * 2;

const bearingRad = ([lng1, lat1], [lng2, lat2]) => {
  const r = Math.PI / 180;
  const y = Math.sin((lng2 - lng1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
  return (Math.atan2(y, x) + TAU) % TAU;
};

const formatDate = (s) => {
  const [d] = String(s ?? '').split(' ');
  const [y, m, day] = d.split('-').map(Number);
  return y ? `${day}. ${m}. ${y}` : '';
};

let box;
let view; // stav panoramatu: { lon, lat, radius, house, yaw, pitch, fov, best }
let viewer; // interaktivní prohlížeč Mapy.com

const $ = (sel) => box.querySelector(sel);

const build = () => {
  box = document.createElement('dialog');
  box.className = 'lightbox';
  box.innerHTML = `
    <div class="lightbox-stage">
      <img alt="" />
      <div class="lightbox-live" hidden></div>
      <p class="lightbox-missing" hidden>Tady panorama není.</p>
    </div>
    <div class="lightbox-bar">
      <span class="lightbox-pano">
        <span class="lightbox-group" aria-label="Posun">
          <button type="button" class="btn btn-sm" data-pan="left" title="Doleva (←)">←</button>
          <button type="button" class="btn btn-sm" data-pan="up" title="Nahoru (↑)">↑</button>
          <button type="button" class="btn btn-sm" data-pan="down" title="Dolů (↓)">↓</button>
          <button type="button" class="btn btn-sm" data-pan="right" title="Doprava (→)">→</button>
        </span>
        <span class="lightbox-group" aria-label="Přiblížení">
          <button type="button" class="btn btn-sm" data-zoom="-1" title="Oddálit (−)">−</button>
          <span class="lightbox-level"></span>
          <button type="button" class="btn btn-sm" data-zoom="1" title="Přiblížit (+)">+</button>
        </span>
        <button type="button" class="btn btn-sm lightbox-free">🖐 Volně posouvat</button>
        <span class="lightbox-years" aria-label="Roky snímků"></span>
        <span class="lightbox-date muted"></span>
      </span>
      <button type="button" class="btn btn-sm lightbox-close">Zavřít ✕</button>
    </div>`;
  document.body.append(box);
  $('.lightbox-close').addEventListener('click', () => box.close());
  box.addEventListener('click', (e) => e.target === box && box.close());
  box.addEventListener('close', stopViewer);
  for (const b of box.querySelectorAll('[data-pan]')) b.addEventListener('click', () => pan(b.dataset.pan));
  for (const b of box.querySelectorAll('[data-zoom]')) b.addEventListener('click', () => zoom(Number(b.dataset.zoom)));
  $('.lightbox-free').addEventListener('click', () => openViewer(null));
  $('img').addEventListener('load', () => ($('.lightbox-missing').hidden = true));
  $('img').addEventListener('error', () => view && ($('.lightbox-missing').hidden = false));
  box.addEventListener('keydown', (e) => {
    if (!view || viewer) return;
    const keys = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (keys[e.key]) pan(keys[e.key]);
    else if (e.key === '+') zoom(1);
    else if (e.key === '-') zoom(-1);
    else return;
    e.preventDefault();
  });
};

// ---------- Statický snímek ----------

const staticUrl = () => {
  const p = new URLSearchParams({
    width: '1024',
    height: '640',
    lon: String(view.lon),
    lat: String(view.lat),
    yaw: view.yaw === null ? 'point' : view.yaw.toFixed(3),
    fov: String(view.fov),
    lang: 'cs',
    apikey: SUMP.mapyKey,
  });
  if (view.pitch) p.set('pitch', view.pitch.toFixed(3));
  if (view.radius) p.set('radius', String(view.radius));
  return `https://api.mapy.cz/v1/static/pano?${p}`;
};

const render = () => {
  stopViewer();
  $('img').hidden = false;
  $('img').src = staticUrl();
  const i = FOVS.findIndex((f) => Math.abs(f - view.fov) < 0.01);
  $('.lightbox-level').textContent = i >= 0 ? SUMP.panoZooms[i].label : '';
  $('[data-zoom="-1"]').disabled = view.fov >= FOVS[0];
  $('[data-zoom="1"]').disabled = view.fov <= FOVS[FOVS.length - 1];
  // Posun do stran potřebuje znát směr k domu (u automatického pohledu ho vrátí Mapy.com).
  for (const dir of ['left', 'right']) $(`[data-pan="${dir}"]`).disabled = view.yaw === null && !view.best;
};

const pan = (dir) => {
  const sideways = dir === 'left' || dir === 'right';
  if (sideways && view.yaw === null) {
    if (!view.best) return;
    view.yaw = (view.best.lookDir * Math.PI) / 180;
  }
  const step = view.fov * 0.4;
  if (dir === 'left') view.yaw = (view.yaw - step + TAU) % TAU;
  if (dir === 'right') view.yaw = (view.yaw + step) % TAU;
  if (dir === 'up') view.pitch = Math.min(1.2, view.pitch + view.fov * 0.25);
  if (dir === 'down') view.pitch = Math.max(-1.2, view.pitch - view.fov * 0.25);
  render();
};

const zoom = (step) => {
  const next = step > 0 ? FOVS.find((f) => f < view.fov - 0.001) : [...FOVS].reverse().find((f) => f > view.fov + 0.001);
  if (!next) return;
  view.fov = next;
  render();
};

// ---------- Roky a interaktivní prohlížeč ----------

const best = async (year) => {
  const p = new URLSearchParams({ lon: String(view.lon), lat: String(view.lat), radius: String(view.radius || 50), apikey: SUMP.mapyKey });
  if (year) p.set('year', String(year));
  const res = await fetch(`https://api.mapy.cz/v1/panorama/getbest?${p}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const loadPanoramaJs = () =>
  window.Panorama
    ? Promise.resolve(window.Panorama)
    : new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = PANO_JS;
        s.onload = () => resolve(window.Panorama);
        s.onerror = reject;
        document.head.append(s);
      });

const stopViewer = () => {
  viewer?.destroy?.();
  viewer = null;
  if (!box) return;
  $('.lightbox-live').hidden = true;
  $('.lightbox-live').replaceChildren();
  for (const b of box.querySelectorAll('.lightbox-years button')) b.setAttribute('aria-pressed', 'false');
  $('.lightbox-free').setAttribute('aria-pressed', 'false');
  if (view?.best) $('.lightbox-date').textContent = `Snímek z ${formatDate(view.best.panInfo?.createdAt)}`;
};

const openViewer = async (year) => {
  const live = $('.lightbox-live');
  const date = $('.lightbox-date');
  date.textContent = 'Načítám…';
  try {
    view.best ??= await best();
    const [Panorama, found] = await Promise.all([loadPanoramaJs(), year ? best(year) : view.best]);
    stopViewer();
    const mark = [found.mark.lon, found.mark.lat];
    // Natočení na dům z místa, kde snímek vznikl (starší snímky bývají o pár metrů jinde).
    const yaw = view.house ? bearingRad(mark, view.house) + (view.yaw === null ? 0 : view.yaw - (view.best.lookDir * Math.PI) / 180) : view.yaw;
    $('img').hidden = true;
    live.hidden = false;
    // Prohlížeč si rodiči nastaví vlastní třídu a styly, proto dostane vnitřní prvek s pevnou velikostí.
    const parent = document.createElement('div');
    parent.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    live.append(parent);
    viewer = await Panorama.panoramaFromPid({
      parent,
      pid: found.pid,
      apiKey: SUMP.mapyKey,
      yaw: (yaw + TAU) % TAU,
      pitch: -view.pitch,
      fov: Math.max(Math.PI / 20, Math.min(Math.PI / 2, view.fov)),
      showNavigation: true,
      lang: 'cs',
    });
    date.textContent = `Snímek z ${formatDate(found.panInfo?.createdAt ?? viewer.info?.date)} · táhni myší, kolečkem přibližuj`;
    const pressed = year ? box.querySelector(`.lightbox-years [data-year="${year}"]`) : $('.lightbox-free');
    pressed?.setAttribute('aria-pressed', 'true');
  } catch {
    date.textContent = 'Interaktivní prohlížeč se nepodařilo načíst.';
  }
};

const showYears = (found) => {
  const years = $('.lightbox-years');
  years.replaceChildren();
  const timeline = found.panInfo?.timeline ?? [];
  const current = Number(String(found.panInfo?.createdAt).slice(0, 4));
  if (timeline.length < 2) return;
  years.append(Object.assign(document.createElement('span'), { className: 'muted', textContent: 'Roky:' }));
  for (const y of timeline) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm';
    b.dataset.year = String(y);
    b.textContent = String(y);
    b.title = y === current ? 'Interaktivně, aktuální snímek' : `Snímek z roku ${y} (interaktivně)`;
    b.addEventListener('click', () => (y === current ? openViewer(null) : openViewer(y)));
    years.append(b);
  }
};

// ---------- Otevření ----------

const openPano = (url) => {
  const q = url.searchParams;
  const yaw = q.get('yaw');
  const numeric = yaw !== null && yaw !== 'point' && yaw !== 'auto';
  view = {
    lon: Number(q.get('lon')),
    lat: Number(q.get('lat')),
    radius: Number(q.get('radius')) || 0,
    // Bez místa pohledu (yaw=point) je bod v URL přímo dům.
    house: numeric ? null : [Number(q.get('lon')), Number(q.get('lat'))],
    yaw: numeric ? Number(yaw) : null,
    pitch: Number(q.get('pitch')) || 0,
    fov: Number(q.get('fov')) || 1,
    best: null,
  };
  box.classList.add('is-pano');
  $('.lightbox-years').replaceChildren();
  $('.lightbox-date').textContent = '';
  render();
  const current = view;
  best()
    .then((found) => {
      if (view !== current) return;
      view.best = found;
      $('.lightbox-date').textContent = `Snímek z ${formatDate(found.panInfo?.createdAt)}`;
      showYears(found);
      render();
    })
    .catch(() => {});
};

export const openLightbox = (src, alt) => {
  if (!box) build();
  const url = new URL(src, location.href);
  $('img').alt = alt || '';
  $('.lightbox-missing').hidden = true;
  if (url.hostname === 'api.mapy.cz' && url.pathname.endsWith('/static/pano') && SUMP.mapyKey) {
    openPano(url);
  } else {
    view = null;
    stopViewer();
    box.classList.remove('is-pano');
    $('img').hidden = false;
    $('img').src = url.toString();
  }
  if (!box.open) box.showModal();
};

document.addEventListener('click', (e) => {
  const img = e.target.closest?.('img.zoomable');
  if (!img || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  openLightbox(img.dataset.full || img.currentSrc || img.src, img.alt);
});
