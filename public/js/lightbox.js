// Zvětšení fotky nebo pohledu z ulice (obrázky s třídou zoomable).
// Pohled z Mapy.com se rovnou otevře v interaktivním prohlížeči: táhnutím se posouvá, kolečkem přibližuje
// a jde přepnout na starší roky. Platí se za dlaždice (zhruba 40 kreditů za otevření), proto až na kliknutí.

const SUMP = window.SUMP;
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
let view; // { lon, lat, radius, house, yaw, pitch, fov, best }
let viewer; // interaktivní prohlížeč Mapy.com

const $ = (sel) => box.querySelector(sel);

const build = () => {
  box = document.createElement('dialog');
  box.className = 'lightbox';
  box.innerHTML = `
    <div class="lightbox-stage">
      <img alt="" />
      <div class="lightbox-live" hidden></div>
    </div>
    <div class="lightbox-bar">
      <span class="lightbox-pano">
        <span class="lightbox-years" aria-label="Roky snímků"></span>
        <span class="lightbox-date muted"></span>
      </span>
      <button type="button" class="btn btn-sm lightbox-close">Zavřít ✕</button>
    </div>`;
  document.body.append(box);
  $('.lightbox-close').addEventListener('click', () => box.close());
  box.addEventListener('click', (e) => e.target === box && box.close());
  box.addEventListener('close', stopViewer);
};

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
  $('.lightbox-stage img').hidden = false;
};

const openViewer = async (year) => {
  const current = view;
  const date = $('.lightbox-date');
  date.textContent = 'Načítám…';
  try {
    view.best ??= await best();
    const [Panorama, found] = await Promise.all([loadPanoramaJs(), year ? best(year) : view.best]);
    if (view !== current || !box.open) return;
    stopViewer();
    const mark = [found.mark.lon, found.mark.lat];
    // Natočení na dům z místa, kde snímek vznikl (starší snímky bývají o pár metrů jinde).
    const yaw = view.house ? bearingRad(mark, view.house) : view.yaw;
    // Prohlížeč si rodiči nastaví vlastní třídu a styly, proto dostane vnitřní prvek s pevnou velikostí.
    const live = $('.lightbox-live');
    const parent = document.createElement('div');
    parent.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    live.append(parent);
    live.hidden = false;
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
    $('.lightbox-stage img').hidden = true;
    date.textContent = `Snímek z ${formatDate(found.panInfo?.createdAt ?? viewer.info?.date)} · táhni myší, kolečkem přibližuj`;
    showYears(view.best, year);
  } catch {
    // Bez interaktivního prohlížeče zůstane aspoň statický snímek.
    if (view === current) date.textContent = 'Interaktivní prohlížeč se nepodařilo načíst, zobrazuji statický snímek.';
  }
};

const showYears = (found, active) => {
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
    b.textContent = String(y);
    b.title = y === current ? 'Aktuální snímek' : `Snímek z roku ${y}`;
    b.setAttribute('aria-pressed', String(y === (active ?? current)));
    b.addEventListener('click', () => openViewer(y === current ? null : y));
    years.append(b);
  }
};

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
  // Než se načte prohlížeč, je vidět statický snímek ve větším rozlišení.
  url.searchParams.set('width', '1024');
  url.searchParams.set('height', '640');
  $('.lightbox-stage img').src = url.toString();
  openViewer(null);
};

export const openLightbox = (src, alt) => {
  if (!box) build();
  const url = new URL(src, location.href);
  stopViewer();
  $('.lightbox-stage img').alt = alt || '';
  if (url.hostname === 'api.mapy.cz' && url.pathname.endsWith('/static/pano') && SUMP.mapyKey) {
    if (!box.open) box.showModal();
    openPano(url);
    return;
  }
  view = null;
  box.classList.remove('is-pano');
  $('.lightbox-stage img').src = url.toString();
  if (!box.open) box.showModal();
};

document.addEventListener('click', (e) => {
  const img = e.target.closest?.('img.zoomable');
  if (!img || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  openLightbox(img.dataset.full || img.currentSrc || img.src, img.alt);
});
