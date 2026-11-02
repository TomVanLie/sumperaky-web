import { Hono } from 'hono';
import { DESIGNS, FACADE_COLORS, MODIFICATIONS, REPORT_KINDS, STATES, isKey } from '../domain';
import type { AppEnv } from '../env';
import {
  addressLine,
  getHouse,
  getModifications,
  getPhotos,
  getRevisions,
  type House,
} from '../db';
import { FIELD_LABELS } from '../input';
import { formatDate } from '../lib/util';
import { CameraPicker, FacadeSwatches, HouseCard, StateBadge, StreetView, ZoomChips, photoUrl, type CardHouse } from '../views/components';
import { FeatureFields, HouseFields } from '../views/houseForm';
import { Layout, Turnstile } from '../views/layout';

export const pages = new Hono<AppEnv>();

const notFound = (c: { env: AppEnv['Bindings']; req: { path: string } }) => (
  <Layout env={c.env} path={c.req.path} title="Stránka nenalezena">
    <div class="page">
      <h1>Tady nic není</h1>
      <p>
        Stránka neexistuje nebo dům zatím čeká na schválení. <a href="/">Zpět na mapu</a>
      </p>
    </div>
  </Layout>
);

// ---------- Mapa ----------

pages.get('/', async (c) => {
  const counts = await c.env.DB.prepare(
    `SELECT count(*) AS total, sum(state = 'renovated') AS renovated,
            count(DISTINCT municipality_slug) AS municipalities FROM houses WHERE status = 'approved'`,
  ).first<{ total: number; renovated: number | null; municipalities: number }>();

  return c.html(
    <Layout env={c.env} path="/" map turnstile scripts={['/js/map.js']} bodyClass="map-page">
      <div class="map-layout">
        <aside class="map-panel">
          <h1>Mapa šumperáků</h1>
          <p class="lead">
            <strong>{counts?.total ?? 0}</strong> domů v <strong>{counts?.municipalities ?? 0}</strong> obcích,{' '}
            <strong>{counts?.renovated ?? 0}</strong> po rekonstrukci.
          </p>
          <form id="filters" class="filters">
            <input type="search" name="q" placeholder="Hledat obec nebo adresu" autocomplete="off" />
            <fieldset>
              <legend>Stav</legend>
              {Object.entries(STATES).map(([k, s]) => (
                <label class="check">
                  <input type="checkbox" name="state" value={k} checked />
                  <span class="dot" style={`--c:${s.color}`}></span> {s.label}
                </label>
              ))}
            </fieldset>
            <label>
              Návrh
              <select name="design">
                <option value="">Jakýkoli</option>
                {Object.entries(DESIGNS).map(([k, l]) => (
                  <option value={k}>{l}</option>
                ))}
              </select>
            </label>
            <label>
              Úprava
              <select name="mod">
                <option value="">Jakákoli</option>
                {Object.entries(MODIFICATIONS).map(([k, l]) => (
                  <option value={k}>{l}</option>
                ))}
              </select>
            </label>
            <label>
              Barva fasády
              <select name="color">
                <option value="">Jakákoli</option>
                {Object.entries(FACADE_COLORS).map(([k, f]) => (
                  <option value={k}>{f.label}</option>
                ))}
              </select>
            </label>
            <label>
              Podsklepený
              <select name="basement">
                <option value="">Nezáleží</option>
                <option value="1">Ano</option>
                <option value="0">Ne</option>
              </select>
            </label>
            <label class="check">
              <input type="checkbox" name="photo" value="1" /> Jen s fotkou
            </label>
          </form>
          <p class="muted" id="result-count"></p>
          <a class="btn btn-primary btn-block" href="/pridat" id="add-start">
            + Přidat šumperák
          </a>
        </aside>
        <div class="map-center">
          <button type="button" class="btn btn-sm filters-toggle" id="filters-toggle" aria-expanded="true">
            ‹ Skrýt filtry
          </button>
          <div id="map" class="map"></div>
          <section id="house-sheet" class="house-sheet" hidden aria-label="Vybraný dům"></section>
        </div>
        <aside class="side-panel">
          <div id="browse" class="browse" aria-label="Domy na mapě">
            <header class="side-head">
              <h2 id="results-title">Domy na mapě</h2>
              <button type="button" class="chip-link" id="cluster-clear" hidden>
                Zrušit výběr shluku ×
              </button>
            </header>
            <ul id="results-list" class="results-list"></ul>
            <p class="results-more">
              <button type="button" class="btn btn-block" id="results-more" hidden>
                Načíst dalších 10
              </button>
            </p>
          </div>
          <AddPanel siteKey={c.env.TURNSTILE_SITE_KEY} />
        </aside>
      </div>
    </Layout>,
  );
});

// Přidání domu přímo v mapě, krok za krokem (viz addwizard.js). Formulář se odesílá bez přesměrování.
const QUICK_STATES = ['original', 'partial', 'in_progress', 'renovated', 'unknown'] as const;

const AddPanel = ({ siteKey }: { siteKey: string }) => (
  <div id="add-panel" class="add-panel" hidden>
    <header class="side-head">
      <h2>Přidat šumperák</h2>
      <button type="button" class="btn btn-sm" id="add-close" aria-label="Zavřít přidávání">
        ✕
      </button>
    </header>
    <ol class="stepper">
      <li data-step="1">Místo</li>
      <li data-step="2">Údaje</li>
      <li data-step="3">Hotovo</li>
    </ol>
    <div class="add-body">
      <form id="add-form" class="ajax" data-stay="1" action="/api/houses" method="post" enctype="multipart/form-data" data-validate="validateAdd">
        <section class="add-step" data-step="1">
          <p class="add-hint">
            <strong>Klikni do mapy na dům</strong>, nebo napiš adresu.
          </p>
          <div class="geosearch">
            <input type="search" id="address-search" placeholder="Adresa, např. Lidická 12, Šumperk" autocomplete="off" />
            <ul id="address-results" class="suggestions" hidden></ul>
          </div>
          <p class="map-legend muted small">
            <span class="dot" style="--c:#2f9e5b"></span> přidáno tebou, čeká na schválení
          </p>
        </section>

        <input type="hidden" name="lat" />
        <input type="hidden" name="lng" />
        <input type="hidden" name="country" />
        <input type="hidden" name="district" />
        <input type="hidden" name="region" />
        <input type="hidden" name="cam_lat" />
        <input type="hidden" name="cam_lng" />

        <section id="picked" class="add-step picked" data-step="2" hidden>
          <h3 id="picked-address">Vybraný dům</h3>
          <p class="muted small">Není to ono? Klikni v mapě vedle, nebo přetáhni špendlík.</p>

          <div class="picked-media">
            <div class="sv-frame picked-pano">
              <img id="picked-pano" alt="Pohled z ulice" hidden />
              <div class="sv-placeholder" id="pano-missing-text">
                U tohoto místa panorama z ulice není.
              </div>
            </div>
            <ZoomChips />
            <div class="cam-tools">
              <button type="button" class="btn btn-sm" id="cam-pick">
                🔄 Dům je vidět z boku? Vyber ulici před průčelím
              </button>
              <button type="button" class="btn btn-sm" id="cam-reset" hidden>
                Zpět na automatický pohled
              </button>
              <p class="cam-hint small" id="cam-hint" hidden>
                👆 Klikni v mapě na ulici, ze které je vidět průčelí domu (nejvýš 150 m od domu).
              </p>
            </div>
          </div>

          <fieldset class="chips">
            <legend>Jak dům vypadá teď?</legend>
            {QUICK_STATES.map((k) => (
              <label>
                <input type="radio" name="state" value={k} checked={k === 'unknown'} />
                <span>{k === 'unknown' ? 'Nevím' : STATES[k].label}</span>
              </label>
            ))}
          </fieldset>

          <fieldset class="chips">
            <legend>Návrh</legend>
            {Object.entries(DESIGNS).map(([k, l]) => (
              <label>
                <input type="radio" name="design" value={k} checked={k === 'original'} />
                <span>{l}</span>
              </label>
            ))}
          </fieldset>

          <FeatureFields />

          <FacadeSwatches picker />

          <Turnstile siteKey={siteKey} />
          <button class="btn btn-primary btn-lg btn-block" type="submit">
            Přidat šumperák
          </button>
          <p class="form-msg" role="status"></p>
          <p class="muted small">
            Odesláním souhlasíš se zveřejněním údajů pod licencí CC BY-SA 4.0 a se{' '}
            <a href="/soukromi">zásadami ochrany soukromí</a>. Dům se na mapě objeví po kontrole.
          </p>

          <details class="panel">
            <summary>Opravit adresu</summary>
            <div class="row">
              <label>
                Ulice
                <input name="street" maxlength={120} />
              </label>
              <label>
                Číslo
                <input name="house_number" maxlength={20} />
              </label>
            </div>
            <label>
              Obec
              <input name="municipality" maxlength={120} />
            </label>
            <label class="check">
              <input type="checkbox" name="hide_number" value="1" /> Nezobrazovat veřejně číslo domu
            </label>
          </details>

          <details class="panel">
            <summary>Doplnit podrobnosti a vlastní fotky (nepovinné)</summary>
            <HouseFields withState={false} />
            <h3>Vlastní fotky</h3>
            <p class="muted small">
              Hodí se hlavně fotky před a po rekonstrukci. Před nahráním se zmenší a odstraní se z nich GPS. Foť jen z
              ulice a bez lidí a SPZ.
            </p>
            <div class="photo-slots" data-slots="6"></div>
            <label>
              Autor fotek
              <input name="author" maxlength={80} />
            </label>
          </details>
        </section>
      </form>

      <section class="add-step add-done" data-step="3" hidden>
        <p class="add-done-icon" aria-hidden="true">🏠</p>
        <h3>Díky, šumperák je na cestě!</h3>
        <p>Záznam čeká na kontrolu moderátorem. Na mapě ho zatím vidíš zeleně jen ty.</p>
        <button type="button" class="btn btn-primary btn-lg btn-block" id="add-another">
          + Přidat další v okolí
        </button>
        <button type="button" class="btn btn-block" id="add-finish">
          Hotovo, zpět na mapu
        </button>
      </section>
    </div>
  </div>
);

// ---------- Detail domu ----------

pages.get('/dum/:id{[0-9]+}', async (c) => {
  const house = await getHouse(c.env.DB, Number(c.req.param('id')));
  if (!house || house.status !== 'approved') return c.html(notFound(c), 404);

  const [mods, photos, revisions] = await Promise.all([
    getModifications(c.env.DB, house.id),
    getPhotos(c.env.DB, house.id),
    getRevisions(c.env.DB, house.id),
  ]);
  const after = [...photos].reverse().find((p) => p.phase === 'after' || p.phase === 'current');
  const address = addressLine(house);
  const siteKey = c.env.TURNSTILE_SITE_KEY;
  // Živý pohled z ulice jde rovnou natočit, nahrazuje náhledový obrázek.
  const livePicker = !!c.env.MAPY_API_KEY && house.country !== 'sk';

  return c.html(
    <Layout
      env={c.env}
      path={`/dum/${house.id}`}
      title={`Šumperák, ${address}`}
      description={`Šumperák v obci ${house.municipality}: ${STATES[house.state as keyof typeof STATES]?.label ?? ''}. Úpravy údajů, fotky a pohled z ulice.`}
      image={after ? photoUrl(after.r2_key) : undefined}
      map
      turnstile
      scripts={['/js/house.js', '/js/campicker.js']}
    >
      <article class="page house">
        <p class="crumbs">
          <a href={`/?dum=${house.id}`}>‹ Zpět na mapu</a>
        </p>
        <h1>{address}</h1>
        <p class="meta">
          <StateBadge state={house.state} />
          <a href={`/obec/${house.municipality_slug}`}>{house.municipality}</a>
          {house.region && <span>{house.region}</span>}
          <span>{house.country === 'sk' ? 'Slovensko' : 'Česko'}</span>
        </p>

        <form class="ajax house-edit" id="upravit" action={`/api/houses/${house.id}/edit`} method="post">
          <input type="hidden" name="lat" value={String(house.lat)} />
          <input type="hidden" name="lng" value={String(house.lng)} />
          <div class="house-grid">
            <div>
              {livePicker ? (
                <CameraPicker h={house} />
              ) : (
                <>
                  <StreetView h={house} keys={c.env} />
                  <input type="hidden" name="sv_heading" value={house.sv_heading ?? ''} />
                  <input type="hidden" name="sv_pitch" value={house.sv_pitch ?? ''} />
                  <input type="hidden" name="cam_lat" value={house.cam_lat ?? ''} />
                  <input type="hidden" name="cam_lng" value={house.cam_lng ?? ''} />
                  <input type="hidden" name="pano_fov" value={house.pano_fov ?? ''} />
                </>
              )}
            </div>
            <div>
              <h2>Navrhnout úpravu</h2>
              <p class="muted small">Oprav, co nesedí, a odešli. Změny se projeví po schválení moderátorem.</p>
              <div class="row">
                <label>
                  Ulice
                  <input name="street" maxlength={120} value={house.street ?? ''} />
                </label>
                <label>
                  Číslo
                  <input name="house_number" maxlength={20} value={house.house_number ?? ''} />
                </label>
              </div>
              <label>
                Obec
                <input name="municipality" required maxlength={120} value={house.municipality} />
              </label>
              <label class="check">
                <input type="checkbox" name="hide_number" value="1" checked={!!house.hide_number} /> Nezobrazovat číslo domu
              </label>
              <HouseFields house={house} mods={mods} />
              <label>
                Komentář pro moderátora
                <textarea name="comment" rows={2} maxlength={1000}></textarea>
              </label>
              <Turnstile siteKey={siteKey} />
              <button class="btn btn-primary" type="submit">
                Odeslat návrh
              </button>
              <p class="form-msg" role="status"></p>
            </div>
          </div>
        </form>

        <div class="house-extra">
          <details class="panel" id="fotky-pridat">
            <summary>Přidat fotky</summary>
            <form class="ajax photo-form" action={`/api/houses/${house.id}/photos`} method="post" enctype="multipart/form-data">
              <div class="photo-slots" data-slots="3"></div>
              <label>
                Autor fotek (nepovinné)
                <input name="author" maxlength={80} />
              </label>
              <p class="muted small">
                Nahráním potvrzuješ, že fotky jsou z veřejného prostranství, a souhlasíš s jejich zveřejněním pod
                licencí CC BY-SA 4.0.
              </p>
              <Turnstile siteKey={siteKey} />
              <button class="btn btn-primary" type="submit">
                Nahrát fotky
              </button>
              <p class="form-msg" role="status"></p>
            </form>
          </details>

          <details class="panel" id="nahlasit">
            <summary>Nahlásit problém nebo požádat o skrytí</summary>
            <form class="ajax" action={`/api/houses/${house.id}/report`} method="post">
              <label>
                Důvod
                <select name="kind" required>
                  {Object.entries(REPORT_KINDS).map(([k, l]) => (
                    <option value={k}>{l}</option>
                  ))}
                </select>
              </label>
              <label>
                Popis
                <textarea name="message" rows={3} maxlength={2000}></textarea>
              </label>
              <label>
                Kontakt (nepovinný, jen pro moderátory)
                <input name="contact" maxlength={200} />
              </label>
              <Turnstile siteKey={siteKey} />
              <button class="btn" type="submit">
                Odeslat
              </button>
              <p class="form-msg" role="status"></p>
            </form>
          </details>

          {revisions.length > 0 && (
            <details class="panel">
              <summary>Historie změn</summary>
              <ul class="history">
                {revisions.map((r) => (
                  <li>
                    <time>{formatDate(r.created_at)}</time> {r.summary}
                    {r.changes && <span class="muted"> ({changedFields(r.changes)})</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </article>
    </Layout>,
  );
});

const changedFields = (json: string) => {
  try {
    return Object.keys(JSON.parse(json))
      .map((k) => FIELD_LABELS[k] ?? k)
      .join(', ');
  } catch {
    return '';
  }
};

// ---------- Přidání domu ----------

pages.get('/pridat', (c) => c.redirect('/?pridat=1'));

pages.get('/dekujeme', (c) =>
  c.html(
    <Layout env={c.env} path="/dekujeme" title="Děkujeme">
      <div class="page narrow">
        <h1>Díky, šumperák je na cestě! 🏠</h1>
        <p>Záznam teď čeká na kontrolu moderátorem. Jakmile ho schválíme, objeví se na mapě.</p>
        <p>
          <a class="btn btn-primary btn-lg" href="/pridat">
            + Přidat další v okolí
          </a>
        </p>
        <p class="muted">
          Mapa se vrátí na stejné místo. Nebo se podívej na <a href="/promeny">proměny šumperáků</a>.
        </p>
      </div>
    </Layout>,
  ),
);

// ---------- Obce ----------

pages.get('/obce', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT municipality_slug AS slug, min(municipality) AS name, coalesce(min(region), 'Neznámý kraj') AS region,
            min(region) AS raw_region, country, count(*) AS n
       FROM houses WHERE status = 'approved'
      GROUP BY municipality_slug, country ORDER BY country, region, name`,
  ).all<{ slug: string; name: string; region: string; raw_region: string | null; country: string; n: number }>();

  const groups = new Map<string, { country: string; region: string; raw: string | null; rows: typeof results }>();
  for (const r of results) {
    const key = `${r.country}|${r.region}`;
    const g = groups.get(key) ?? { country: r.country === 'sk' ? 'Slovensko' : 'Česko', region: r.region, raw: r.raw_region, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }

  return c.html(
    <Layout env={c.env} path="/obce" title="Šumperáky podle obcí">
      <div class="page">
        <h1>Šumperáky podle obcí</h1>
        {results.length === 0 && <p>Zatím tu nic není. <a href="/pridat">Přidej první šumperák!</a></p>}
        <div class="columns">
          {[...groups.values()].map((g) => (
            <section>
              <h2>
                {g.country}:{' '}
                <a href={`/domy?${new URLSearchParams({ kraj: g.raw ?? NO_REGION })}`} title="Všechny šumperáky v kraji">
                  {g.region}
                </a>{' '}
                <span class="muted small">({g.rows.reduce((sum, r) => sum + r.n, 0)})</span>
              </h2>
              <ul class="plain">
                {g.rows.map((r) => (
                  <li>
                    <a href={`/obec/${r.slug}`}>{r.name}</a> <span class="muted">({r.n})</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </Layout>,
  );
});

const cardsQuery = `SELECT h.id, h.lat, h.lng, h.cam_lat, h.cam_lng, h.pano_fov, h.sv_heading, h.sv_pitch, h.country, h.state, h.street, h.house_number, h.hide_number, h.municipality,
      (SELECT r2_key FROM photos p WHERE p.house_id = h.id AND p.status = 'approved'
         ORDER BY CASE p.phase WHEN 'current' THEN 0 WHEN 'after' THEN 1 ELSE 2 END, p.id DESC LIMIT 1) AS photo
   FROM houses h`;

pages.get('/obec/:slug', async (c) => {
  const slug = c.req.param('slug');
  const { results } = await c.env.DB.prepare(`${cardsQuery} WHERE h.status = 'approved' AND h.municipality_slug = ? ORDER BY h.street, h.house_number`)
    .bind(slug)
    .all<CardHouse & { lat: number; lng: number }>();
  if (!results.length) return c.html(notFound(c), 404);
  const name = results[0].municipality;

  return c.html(
    <Layout
      env={c.env}
      path={`/obec/${slug}`}
      title={`Šumperáky v obci ${name}`}
      description={`Seznam a mapa šumperáků v obci ${name}: ${results.length} domů, fotky a rekonstrukce.`}
    >
      <div class="page">
        <p class="crumbs">
          <a href="/obce">Obce</a> › {name}
        </p>
        <h1>Šumperáky v obci {name}</h1>
        <p class="lead">
          {results.length} {results.length === 1 ? 'dům' : results.length < 5 ? 'domy' : 'domů'}.{' '}
          <a href={`/#14/${results[0].lat}/${results[0].lng}`}>Zobrazit na mapě</a>
        </p>
        <div class="cards">
          {results.map((h) => (
            <HouseCard h={h} keys={c.env} />
          ))}
        </div>
      </div>
    </Layout>,
  );
});

// ---------- Proměny (před a po) ----------

pages.get('/promeny', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT h.id, h.street, h.house_number, h.hide_number, h.municipality, h.state, h.year_renovated,
            (SELECT r2_key FROM photos p WHERE p.house_id = h.id AND p.status = 'approved' AND p.phase = 'before' ORDER BY p.id LIMIT 1) AS before_key,
            (SELECT r2_key FROM photos p WHERE p.house_id = h.id AND p.status = 'approved' AND p.phase IN ('after', 'current') ORDER BY p.id DESC LIMIT 1) AS after_key
       FROM houses h
      WHERE h.status = 'approved' AND before_key IS NOT NULL AND after_key IS NOT NULL
      ORDER BY h.approved_at DESC LIMIT 60`,
  ).all<House & { before_key: string; after_key: string }>();

  return c.html(
    <Layout
      env={c.env}
      path="/promeny"
      title="Proměny šumperáků: před a po rekonstrukci"
      description="Inspirace pro rekonstrukci šumperáku. Fotky domů před a po úpravách."
      scripts={['/js/house.js']}
    >
      <div class="page">
        <h1>Proměny šumperáků</h1>
        <p class="lead">Jak se dá šumperák předělat. Posuň jezdcem a porovnej stav před a po rekonstrukci.</p>
        {results.length === 0 && (
          <p>
            Zatím tu žádné proměny nejsou. Máš fotky před a po? <a href="/pridat">Přidej je.</a>
          </p>
        )}
        <div class="transformations">
          {results.map((h) => (
            <article>
              <figure class="compare" style="--pos:50%">
                <img src={photoUrl(h.after_key)} alt="Po rekonstrukci" loading="lazy" />
                <img class="compare-before" src={photoUrl(h.before_key)} alt="Před rekonstrukcí" loading="lazy" />
                <input type="range" min="0" max="100" value="50" aria-label="Posunout porovnání před a po" />
              </figure>
              <a href={`/?dum=${h.id}`}>
                <strong>{addressLine(h)}</strong>
              </a>
              {h.year_renovated && <span class="muted"> · rekonstrukce {h.year_renovated}</span>}
            </article>
          ))}
        </div>
      </div>
    </Layout>,
  );
});

// ---------- Výpis domů podle filtru (proklik ze statistik) ----------

const VOTE_GROUPS = {
  ano: { label: 'Spíš je šumperák', sql: 'yes_votes > no_votes' },
  nerozhodnuto: { label: 'Nerozhodnuto', sql: 'yes_votes = no_votes AND yes_votes > 0' },
  ne: { label: 'Spíš není šumperák', sql: 'no_votes > yes_votes' },
  bez: { label: 'Bez hlasů', sql: 'yes_votes + no_votes = 0' },
} as const;
const NO_REGION = 'neuvedeno';
const PAGE_SIZE = 48;

type Filter = { param: string; value: string; label: string; where: string; args: unknown[] };

// Z parametrů URL sestaví podmínky. Neznámé hodnoty se ignorují, do SQL jdou jen jako parametry.
const listFilters = (q: (name: string) => string | undefined): Filter[] => {
  const out: Filter[] = [];
  const stav = q('stav');
  if (isKey(STATES, stav)) out.push({ param: 'stav', value: stav, label: STATES[stav].label, where: 'h.state = ?', args: [stav] });
  const navrh = q('navrh');
  if (isKey(DESIGNS, navrh)) out.push({ param: 'navrh', value: navrh, label: DESIGNS[navrh], where: 'h.design = ?', args: [navrh] });
  const barva = q('barva');
  if (isKey(FACADE_COLORS, barva))
    out.push({ param: 'barva', value: barva, label: `Fasáda: ${FACADE_COLORS[barva].label.toLowerCase()}`, where: 'h.facade_color = ?', args: [barva] });
  const uprava = q('uprava');
  if (isKey(MODIFICATIONS, uprava))
    out.push({
      param: 'uprava',
      value: uprava,
      label: MODIFICATIONS[uprava],
      where: 'EXISTS (SELECT 1 FROM house_modifications m WHERE m.house_id = h.id AND m.modification = ?)',
      args: [uprava],
    });
  const kraj = q('kraj')?.slice(0, 100);
  if (kraj === NO_REGION) out.push({ param: 'kraj', value: kraj, label: 'Kraj neuveden', where: 'h.region IS NULL', args: [] });
  else if (kraj) out.push({ param: 'kraj', value: kraj, label: kraj, where: 'h.region = ?', args: [kraj] });
  const rok = q('rekonstrukce');
  const from = rok && /^\d{4}$/.test(rok) ? Number(rok) : null;
  if (from)
    out.push({ param: 'rekonstrukce', value: String(from), label: `Rekonstrukce ${from}–${from + 4}`, where: 'h.year_renovated BETWEEN ? AND ?', args: [from, from + 4] });
  const sklep = q('sklep');
  if (sklep === 'ano' || sklep === 'ne')
    out.push({ param: 'sklep', value: sklep, label: sklep === 'ano' ? 'Podsklepený' : 'Bez sklepa', where: 'h.basement = ?', args: [sklep === 'ano' ? 1 : 0] });
  const hlasy = q('hlasovani');
  if (isKey(VOTE_GROUPS, hlasy)) out.push({ param: 'hlasovani', value: hlasy, label: VOTE_GROUPS[hlasy].label, where: VOTE_GROUPS[hlasy].sql, args: [] });
  return out;
};

const housesWord = (n: number) => (n === 1 ? 'dům' : n >= 2 && n <= 4 ? 'domy' : 'domů');

pages.get('/domy', async (c) => {
  const filters = listFilters((name) => c.req.query(name));
  const page = Math.max(1, Number.parseInt(c.req.query('strana') ?? '1', 10) || 1);
  const values = filters.flatMap((f) => f.args);
  const where = ["h.status = 'approved'", ...filters.map((f) => f.where)].join(' AND ');
  const base = `SELECT * FROM (
      SELECT h.*, (SELECT count(*) FROM votes v WHERE v.house_id = h.id AND v.vote = 1) AS yes_votes,
                  (SELECT count(*) FROM votes v WHERE v.house_id = h.id AND v.vote = 0) AS no_votes
        FROM houses h WHERE h.status = 'approved') h WHERE ${where}`;

  const [list, total] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(
      `SELECT h.id, h.lat, h.lng, h.cam_lat, h.cam_lng, h.pano_fov, h.sv_heading, h.sv_pitch, h.country, h.state, h.street, h.house_number, h.hide_number, h.municipality,
              (SELECT r2_key FROM photos p WHERE p.house_id = h.id AND p.status = 'approved'
                 ORDER BY CASE p.phase WHEN 'current' THEN 0 WHEN 'after' THEN 1 ELSE 2 END, p.id DESC LIMIT 1) AS photo
         FROM (${base}) h ORDER BY h.municipality, h.street, h.house_number LIMIT ? OFFSET ?`,
    ).bind(...values, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    c.env.DB.prepare(`SELECT count(*) AS n FROM (${base})`).bind(...values),
  ]);
  const houses = list.results as unknown as (CardHouse & { lat: number; lng: number })[];
  const count = (total.results[0] as { n: number }).n;
  const pages_ = Math.ceil(count / PAGE_SIZE);

  const query = (fs: Filter[], extra: Record<string, string> = {}) => {
    const params = new URLSearchParams([...fs.map((f) => [f.param, f.value]), ...Object.entries(extra)]);
    return `/domy${params.size ? `?${params}` : ''}`;
  };
  const title = filters.length ? `Šumperáky: ${filters.map((f) => f.label).join(', ')}` : 'Všechny šumperáky';

  return c.html(
    <Layout env={c.env} path={query(filters)} title={title} description={`${title}. Seznam domů s fotkami a pohledem z ulice.`}>
      <div class="page">
        <p class="crumbs">
          <a href="/statistiky">Statistiky</a> › Výpis
        </p>
        <h1>{title}</h1>
        {filters.length > 0 && (
          <p class="filter-chips">
            {filters.map((f) => (
              <a class="chip-link" href={query(filters.filter((o) => o !== f))} title="Zrušit filtr">
                {f.label} <span aria-hidden="true">×</span>
              </a>
            ))}
          </p>
        )}
        <p class="lead">
          {count} {housesWord(count)}
          {pages_ > 1 && `, strana ${page} z ${pages_}`}.
        </p>
        {count === 0 && (
          <p>
            Nic tu není. <a href="/statistiky">Zpět na statistiky</a>
          </p>
        )}
        <div class="cards">
          {houses.map((h) => (
            <HouseCard h={h} keys={c.env} />
          ))}
        </div>
        {pages_ > 1 && (
          <nav class="pager">
            {page > 1 && <a class="btn" href={query(filters, page > 2 ? { strana: String(page - 1) } : {})}>‹ Předchozí</a>}
            {page < pages_ && <a class="btn" href={query(filters, { strana: String(page + 1) })}>Další ›</a>}
          </nav>
        )}
      </div>
    </Layout>,
  );
});

// ---------- Statistiky ----------

pages.get('/statistiky', async (c) => {
  const db = c.env.DB;
  const withVotes = `SELECT h.*, (SELECT count(*) FROM votes v WHERE v.house_id = h.id AND v.vote = 1) AS yes_votes,
                            (SELECT count(*) FROM votes v WHERE v.house_id = h.id AND v.vote = 0) AS no_votes
                       FROM houses h WHERE h.status = 'approved'`;
  const [byState, byDesign, byRegion, byMod, byYear, byColor, byVote, disputed, totals] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT state AS k, count(*) AS n FROM houses WHERE status = 'approved' GROUP BY state ORDER BY n DESC`),
    db.prepare(`SELECT design AS k, count(*) AS n FROM houses WHERE status = 'approved' GROUP BY design ORDER BY n DESC`),
    db.prepare(`SELECT region AS k, count(*) AS n FROM houses WHERE status = 'approved' GROUP BY k ORDER BY n DESC`),
    db.prepare(
      `SELECT m.modification AS k, count(*) AS n FROM house_modifications m JOIN houses h ON h.id = m.house_id
        WHERE h.status = 'approved' GROUP BY k ORDER BY n DESC`,
    ),
    db.prepare(
      `SELECT (year_renovated / 5) * 5 AS k, count(*) AS n FROM houses
        WHERE status = 'approved' AND year_renovated IS NOT NULL GROUP BY k ORDER BY k`,
    ),
    db.prepare(
      `SELECT facade_color AS k, count(*) AS n FROM houses
        WHERE status = 'approved' AND facade_color IS NOT NULL GROUP BY k ORDER BY n DESC`,
    ),
    db.prepare(
      `SELECT CASE WHEN yes_votes > no_votes THEN 'ano' WHEN no_votes > yes_votes THEN 'ne'
                   WHEN yes_votes > 0 THEN 'nerozhodnuto' ELSE 'bez' END AS k, count(*) AS n
         FROM (${withVotes}) GROUP BY k`,
    ),
    // Domy, o kterých lidé nejvíc pochybují.
    db.prepare(
      `SELECT id, street, house_number, hide_number, municipality, yes_votes, no_votes FROM (${withVotes})
        WHERE no_votes > 0 ORDER BY no_votes * 1.0 / (yes_votes + no_votes) DESC, no_votes DESC LIMIT 10`,
    ),
    db.prepare(
      `SELECT count(*) AS houses, (SELECT count(*) FROM photos WHERE status = 'approved') AS photos,
              (SELECT count(*) FROM votes) AS votes, (SELECT count(*) FROM comments WHERE status = 'visible') AS comments,
              count(DISTINCT municipality_slug) AS municipalities FROM houses WHERE status = 'approved'`,
    ),
  ]);
  const t = totals.results[0] as { houses: number; photos: number; votes: number; comments: number; municipalities: number };
  const rows = (r: D1Result<Record<string, unknown>>) => r.results as { k: string | number | null; n: number }[];
  const link = (param: string, value: string | number | null) => `/domy?${new URLSearchParams({ [param]: String(value) })}`;
  const voteRows = rows(byVote);
  const disputedRows = disputed.results as unknown as (House & { yes_votes: number; no_votes: number })[];
  const voteColors: Record<string, string> = { ano: '#2f9e5b', nerozhodnuto: '#d9a52b', ne: '#c0392b', bez: '#b0b7c3' };

  return c.html(
    <Layout env={c.env} path="/statistiky" title="Statistiky šumperáků">
      <div class="page">
        <h1>Statistiky</h1>
        <div class="tiles">
          <div class="tile">
            <span class="tile-value">{t.houses}</span>
            <span class="tile-label">šumperáků na mapě</span>
          </div>
          <div class="tile">
            <span class="tile-value">{t.municipalities}</span>
            <span class="tile-label">obcí</span>
          </div>
          <div class="tile">
            <span class="tile-value">{t.photos}</span>
            <span class="tile-label">fotek</span>
          </div>
          <div class="tile">
            <span class="tile-value">{t.votes}</span>
            <span class="tile-label">hlasů „je to šumperák?“</span>
          </div>
          <div class="tile">
            <span class="tile-value">{t.comments}</span>
            <span class="tile-label">komentářů</span>
          </div>
        </div>
        <p class="muted">Klikni na řádek a zobrazí se seznam domů.</p>
        <div class="columns">
          <Bars
            title="Podle stavu"
            rows={rows(byState).map((r) => ({
              label: STATES[r.k as keyof typeof STATES]?.label ?? String(r.k),
              n: r.n,
              color: STATES[r.k as keyof typeof STATES]?.color,
              href: link('stav', r.k),
            }))}
          />
          <Bars
            title="Podle návrhu"
            rows={rows(byDesign).map((r) => ({
              label: DESIGNS[r.k as keyof typeof DESIGNS] ?? String(r.k),
              n: r.n,
              href: link('navrh', r.k),
            }))}
          />
          <Bars
            title="Je to šumperák? Názor komunity"
            rows={Object.entries(VOTE_GROUPS).map(([k, g]) => ({
              label: g.label,
              n: voteRows.find((r) => r.k === k)?.n ?? 0,
              color: voteColors[k],
              href: link('hlasovani', k),
            }))}
          />
          <Bars
            title="Barvy fasád"
            rows={rows(byColor).map((r) => {
              const f = FACADE_COLORS[r.k as keyof typeof FACADE_COLORS];
              return { label: f?.label ?? String(r.k), n: r.n, color: f?.hex, href: link('barva', r.k) };
            })}
          />
          <Bars
            title="Podle kraje"
            rows={rows(byRegion).map((r) => ({
              label: r.k === null ? 'Neuvedeno' : String(r.k),
              n: r.n,
              href: link('kraj', r.k ?? NO_REGION),
            }))}
          />
          <Bars
            title="Nejčastější úpravy"
            rows={rows(byMod).map((r) => ({
              label: MODIFICATIONS[r.k as keyof typeof MODIFICATIONS] ?? String(r.k),
              n: r.n,
              href: link('uprava', r.k),
            }))}
          />
          <Bars
            title="Rekonstrukce podle let"
            rows={rows(byYear).map((r) => ({ label: `${r.k}–${Number(r.k) + 4}`, n: r.n, href: link('rekonstrukce', r.k) }))}
          />
          {disputedRows.length > 0 && (
            <section class="bars">
              <h2>Nejvíc sporné domy</h2>
              <ol class="disputed">
                {disputedRows.map((h) => (
                  <li>
                    <a href={`/?dum=${h.id}`}>{addressLine(h) || h.municipality}</a>{' '}
                    <span class="muted small">
                      👍 {h.yes_votes} · 👎 {h.no_votes}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>
    </Layout>,
  );
});

type BarRow = { label: string; n: number; color?: string; href?: string };

const Bars = ({ title, rows }: { title: string; rows: BarRow[] }) => {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <section class="bars">
      <h2>{title}</h2>
      {rows.length === 0 && <p class="muted">Zatím bez dat.</p>}
      {rows.map((r) => {
        const inner = (
          <>
            <span class="bar-label">{r.label}</span>
            <span class="bar-track">
              <span class="bar" style={`width:${(r.n / max) * 100}%${r.color ? `;--c:${r.color}` : ''}`}></span>
            </span>
            <span class="bar-value">{r.n}</span>
          </>
        );
        return r.href && r.n > 0 ? (
          <a class="bar-row" href={r.href}>
            {inner}
          </a>
        ) : (
          <div class="bar-row">{inner}</div>
        );
      })}
    </section>
  );
};

// ---------- Statické texty ----------

pages.get('/o-projektu', (c) =>
  c.html(
    <Layout env={c.env} path="/o-projektu" title="O projektu">
      <div class="page narrow prose">
        <h1>O projektu</h1>
        <p>
          <strong>Šumperák</strong> je lidové označení typového rodinného domu, který se v Československu stavěl hlavně
          v 70. a 80. letech. Poznáš ho podle strmé sedlové střechy, vysokého štítu do ulice a typického členění oken a
          balkonu. Jméno nese podle Šumperka.
        </p>
        <p>
          Šumperáky.cz je komunitní mapa těchto domů v Česku a na Slovensku. Cílem je zmapovat, kolik jich stojí, jak se
          mění a jak se dají citlivě i odvážně předělat. Každý může přidat dům, fotky nebo opravit údaje. Příspěvky
          kontroluje moderátor.
        </p>
        <h2>Jak přispět</h2>
        <ul>
          <li>Přidej šumperák, který znáš, ideálně s fotkou z ulice.</li>
          <li>Pokud jsi dům zrekonstruoval(a), nahraj fotky před a po. Inspiruješ ostatní.</li>
          <li>
            U existujících domů hlasuj, jestli jde opravdu o šumperák. Po rekonstrukci se původní tvar často ztratí,
            proto rozhoduje názor komunity. Můžeš taky přidat komentář nebo navrhnout opravu údajů.
          </li>
        </ul>
        <h2>Data</h2>
        <p>
          Všechna schválená data jsou volně ke stažení pod licencí CC BY-SA 4.0 na stránce{' '}
          <a href="/data">Otevřená data</a>.
        </p>
      </div>
    </Layout>,
  ),
);

pages.get('/soukromi', (c) =>
  c.html(
    <Layout env={c.env} path="/soukromi" title="Ochrana soukromí">
      <div class="page narrow prose">
        <h1>Ochrana soukromí</h1>
        <p>
          Mapujeme domy, ne lidi. Nezveřejňujeme jména majitelů ani údaje z katastru. Každý dům lze zobrazit bez čísla
          popisného, jen s ulicí a obcí.
        </p>
        <h2>Jsem majitel a nechci, aby tu můj dům byl</h2>
        <p>
          Otevři detail domu a použij volbu <em>Nahlásit problém nebo požádat o skrytí</em> s důvodem{' '}
          <em>Jsem majitel a žádám o skrytí</em>. Záznam skryjeme bez dalších otázek, obvykle do několika dnů.
        </p>
        <h2>Fotky</h2>
        <ul>
          <li>Přijímáme jen fotky pořízené z veřejného prostranství.</li>
          <li>Před nahráním se v prohlížeči odstraní metadata fotky včetně GPS polohy a typu telefonu.</li>
          <li>Fotky s rozpoznatelnými lidmi nebo SPZ moderátor nezveřejní.</li>
        </ul>
        <h2>Jaké údaje ukládáme o přispěvatelích</h2>
        <p>
          Nevyžadujeme registraci. Kvůli ochraně proti spamu ukládáme k příspěvku jen jednosměrný otisk (hash) IP
          adresy, ze kterého nelze IP adresu zpětně zjistit. Kontakt v nahlášení je nepovinný a vidí ho jen moderátoři.
        </p>
        <h2>Hlasování a komentáře</h2>
        <p>
          Hlasovat i komentovat jde anonymně. Stejný otisk zařízení slouží k tomu, aby každý mohl u domu hlasovat jen
          jednou (hlas jde změnit). Komentáře s osobními údaji o majitelích nebo urážkami moderátor skryje.
        </p>
        <h2>Pohled z ulice</h2>
        <p>
          Snímky z ulice načítá tvůj prohlížeč přímo ze služby Mapy.com (Seznam.cz), my je neukládáme. Platí pro ně{' '}
          <a href="https://o.seznam.cz/ochrana-udaju/" rel="noopener">zásady ochrany údajů Seznamu</a>.
        </p>
      </div>
    </Layout>,
  ),
);

pages.get('/data', (c) =>
  c.html(
    <Layout env={c.env} path="/data" title="Otevřená data">
      <div class="page narrow prose">
        <h1>Otevřená data</h1>
        <p>
          Seznam všech schválených šumperáků je volně k dispozici pod licencí{' '}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.cs">CC BY-SA 4.0</a>. Při použití uveď zdroj
          „Šumperáky.cz“.
        </p>
        <ul>
          <li>
            <a href="/data/sumperaky.geojson">sumperaky.geojson</a> (pro mapové aplikace, QGIS, uMap)
          </li>
          <li>
            <a href="/data/sumperaky.csv">sumperaky.csv</a> (pro tabulky)
          </li>
        </ul>
        <p>Export obsahuje polohu, obec, kraj, stav, úpravy a roky. Čísla domů skrytá majiteli v exportu nejsou.</p>
      </div>
    </Layout>,
  ),
);
