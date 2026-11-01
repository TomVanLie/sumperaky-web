// Interaktivní pohled z ulice z Mapy.com: táhnutím se posouvá, kolečkem přibližuje a jde přepnout
// na starší roky snímků. Platí se za dlaždice (zhruba 40 kreditů za otevření).
// Použití: detail domu v mapě a zvětšení obrázku (lightbox).

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

// Statický snímek z Mapy.com, ze kterého jde poznat místo a směr pohledu.
export const isMapyPano = (src) => {
  try {
    const url = new URL(src, location.href);
    return Boolean(SUMP.mapyKey) && url.hostname === 'api.mapy.cz' && url.pathname.endsWith('/static/pano');
  } catch {
    return false;
  }
};

const parseView = (src) => {
  const q = new URL(src, location.href).searchParams;
  const yaw = q.get('yaw');
  const numeric = yaw !== null && yaw !== 'point' && yaw !== 'auto';
  return {
    lon: Number(q.get('lon')),
    lat: Number(q.get('lat')),
    radius: Number(q.get('radius')) || 0,
    // Bez místa pohledu (yaw=point) je bod v URL přímo dům.
    house: numeric ? null : [Number(q.get('lon')), Number(q.get('lat'))],
    yaw: numeric ? Number(yaw) : null,
    pitch: Number(q.get('pitch')) || 0,
    fov: Number(q.get('fov')) || 1,
  };
};

// Vloží do `stage` (pozicovaný prvek se statickým snímkem jako zástupcem) živý prohlížeč a lištu s roky.
// Vrací { destroy }.
export const mountPano = (stage, src) => {
  const view = parseView(src);
  const live = document.createElement('div');
  live.className = 'pano-live';
  live.hidden = true;
  const bar = document.createElement('div');
  bar.className = 'pano-bar';
  bar.innerHTML = '<span class="pano-years" aria-label="Roky snímků"></span><span class="pano-date">Načítám pohled z ulice…</span>';
  stage.append(live, bar);
  const years = bar.querySelector('.pano-years');
  const date = bar.querySelector('.pano-date');

  let viewer = null;
  let latest = null;
  let destroyed = false;
  let request = 0;

  const best = async (year) => {
    const p = new URLSearchParams({ lon: String(view.lon), lat: String(view.lat), radius: String(view.radius || 50), apikey: SUMP.mapyKey });
    if (year) p.set('year', String(year));
    const res = await fetch(`https://api.mapy.cz/v1/panorama/getbest?${p}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  const stopViewer = () => {
    viewer?.destroy?.();
    viewer = null;
    live.replaceChildren();
  };

  const showYears = (active) => {
    years.replaceChildren();
    const timeline = latest.panInfo?.timeline ?? [];
    const current = Number(String(latest.panInfo?.createdAt).slice(0, 4));
    if (timeline.length < 2) return;
    for (const y of timeline) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm';
      b.textContent = String(y);
      b.title = y === current ? 'Aktuální snímek' : `Snímek z roku ${y}`;
      b.setAttribute('aria-pressed', String(y === (active ?? current)));
      b.addEventListener('click', () => open(y === current ? null : y));
      years.append(b);
    }
  };

  const open = async (year) => {
    const mine = ++request;
    date.textContent = 'Načítám…';
    try {
      latest ??= await best();
      const [Panorama, found] = await Promise.all([loadPanoramaJs(), year ? best(year) : latest]);
      if (destroyed || mine !== request) return;
      stopViewer();
      const mark = [found.mark.lon, found.mark.lat];
      // Natočení na dům z místa, kde snímek vznikl (starší snímky bývají o pár metrů jinde).
      const yaw = view.house ? bearingRad(mark, view.house) : view.yaw;
      // Prohlížeč si rodiči nastaví vlastní třídu a styly, proto dostane vnitřní prvek s pevnou velikostí.
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
      if (destroyed || mine !== request) return stopViewer();
      date.textContent = `Snímek z ${formatDate(found.panInfo?.createdAt ?? viewer.info?.date)}`;
      showYears(year);
    } catch {
      // Bez interaktivního prohlížeče zůstane aspoň statický snímek.
      if (!destroyed && mine === request) {
        live.hidden = true;
        date.textContent = 'Interaktivní pohled se nepodařilo načíst.';
      }
    }
  };

  open(null);
  return {
    destroy() {
      destroyed = true;
      stopViewer();
      live.remove();
      bar.remove();
    },
  };
};
