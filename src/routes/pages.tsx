import { Hono } from 'hono';
import { DESIGNS, FACADE_COLORS, MODIFICATIONS, PHOTO_PHASES, REPORT_KINDS, ROOFS, STATES, isKey } from '../domain';
import type { AppEnv } from '../env';
import {
  addressLine,
  countConfirmations,
  getHouse,
  getModifications,
  getPhotos,
  getRevisions,
  type House,
} from '../db';
import { FIELD_LABELS } from '../input';
import { formatDate } from '../lib/util';
import { FacadeSwatch, FacadeSwatches, HouseCard, ModList, StateBadge, StreetView, photoUrl, type CardHouse } from '../views/components';
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
    <Layout env={c.env} path="/" map scripts={['/js/map.js']} bodyClass="map-page">
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
            <label class="check">
              <input type="checkbox" name="photo" value="1" /> Jen s fotkou
            </label>
          </form>
          <p class="muted" id="result-count"></p>
          <a class="btn btn-primary btn-block" href="/pridat">
            + Přidat šumperák
          </a>
        </aside>
        <div id="map" class="map"></div>
      </div>
    </Layout>,
  );
});

// ---------- Detail domu ----------

pages.get('/dum/:id{[0-9]+}', async (c) => {
  const house = await getHouse(c.env.DB, Number(c.req.param('id')));
  if (!house || house.status !== 'approved') return c.html(notFound(c), 404);

  const [mods, photos, revisions, confirmations] = await Promise.all([
    getModifications(c.env.DB, house.id),
    getPhotos(c.env.DB, house.id),
    getRevisions(c.env.DB, house.id),
    countConfirmations(c.env.DB, house.id),
  ]);
  const before = photos.find((p) => p.phase === 'before');
  const after = [...photos].reverse().find((p) => p.phase === 'after' || p.phase === 'current');
  const address = addressLine(house);
  const siteKey = c.env.TURNSTILE_SITE_KEY;

  return c.html(
    <Layout
      env={c.env}
      path={`/dum/${house.id}`}
      title={`Šumperák, ${address}`}
      description={`Šumperák v obci ${house.municipality}: ${STATES[house.state as keyof typeof STATES]?.label ?? ''}. Fotky, úpravy a pohled z ulice.`}
      image={after ? photoUrl(after.r2_key) : undefined}
      map
      turnstile
      scripts={['/js/house.js']}
    >
      <article class="page house" data-lat={house.lat} data-lng={house.lng} data-state={house.state}>
        <p class="crumbs">
          <a href="/obce">Obce</a> › <a href={`/obec/${house.municipality_slug}`}>{house.municipality}</a>
        </p>
        <h1>{address}</h1>
        <p class="meta">
          <StateBadge state={house.state} />
          {house.district && <span>{house.district}</span>}
          {house.region && <span>{house.region}</span>}
          <span>{house.country === 'sk' ? 'Slovensko' : 'Česko'}</span>
        </p>

        <div class="house-grid">
          <div>
            {before && after ? (
              <figure class="compare" style="--pos:50%">
                <img src={photoUrl(after.r2_key)} alt="Po rekonstrukci" />
                <img class="compare-before" src={photoUrl(before.r2_key)} alt="Před rekonstrukcí" />
                <input type="range" min="0" max="100" value="50" aria-label="Posunout porovnání před a po" />
                <figcaption>
                  <span>Před{before.year_taken ? ` (${before.year_taken})` : ''}</span>
                  <span>Po{after.year_taken ? ` (${after.year_taken})` : ''}</span>
                </figcaption>
              </figure>
            ) : null}

            <StreetView h={house} keys={c.env} />

            {photos.length > 0 && (
              <section>
                <h2>Fotky</h2>
                <div class="gallery">
                  {photos.map((p) => (
                    <figure>
                      <a href={photoUrl(p.r2_key)} target="_blank">
                        <img src={photoUrl(p.r2_key)} alt={p.caption ?? PHOTO_PHASES[p.phase as keyof typeof PHOTO_PHASES]} loading="lazy" />
                      </a>
                      <figcaption>
                        {PHOTO_PHASES[p.phase as keyof typeof PHOTO_PHASES]}
                        {p.year_taken ? `, ${p.year_taken}` : ''}
                        {p.caption ? `: ${p.caption}` : ''}
                        {p.author ? <span class="muted"> · foto {p.author}</span> : null}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside>
            <dl class="facts">
              <dt>Stav</dt>
              <dd>{STATES[house.state as keyof typeof STATES]?.label}</dd>
              <dt>Návrh</dt>
              <dd>{DESIGNS[house.design as keyof typeof DESIGNS]}</dd>
              {house.year_built && (
                <>
                  <dt>Rok stavby</dt>
                  <dd>{house.year_built}</dd>
                </>
              )}
              {house.year_renovated && (
                <>
                  <dt>Rok rekonstrukce</dt>
                  <dd>{house.year_renovated}</dd>
                </>
              )}
              {house.roof && isKey(ROOFS, house.roof) && (
                <>
                  <dt>Střešní krytina</dt>
                  <dd>{ROOFS[house.roof]}</dd>
                </>
              )}
              {house.facade_color && (
                <>
                  <dt>Barva fasády</dt>
                  <dd>
                    <FacadeSwatch color={house.facade_color} />
                  </dd>
                </>
              )}
            </dl>
            {mods.length > 0 && (
              <>
                <h3>Úpravy</h3>
                <ModList mods={mods} />
              </>
            )}
            {house.note && <p class="note">{house.note}</p>}
            {house.link && (
              <p>
                <a href={house.link} target="_blank" rel="noopener nofollow ugc">
                  Související odkaz
                </a>
              </p>
            )}

            <div id="mini-map" class="mini-map"></div>

            <form class="ajax confirm" action={`/api/houses/${house.id}/confirm`} method="post">
              <Turnstile siteKey={siteKey} />
              <button class="btn" type="submit">
                👍 Ano, je to šumperák <span class="count">{confirmations}</span>
              </button>
              <p class="form-msg" role="status"></p>
            </form>

            <details class="panel">
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

            <details class="panel">
              <summary>Navrhnout úpravu údajů</summary>
              <EditForm house={house} mods={mods} siteKey={siteKey} />
            </details>

            <details class="panel">
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
          </aside>
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

const HouseFields = ({ house, mods, withState = true }: { house?: Partial<House>; mods?: string[]; withState?: boolean }) => (
  <>
    {withState && (
      <label>
        Stav domu
        <select name="state" required>
          <option value="">Vyber…</option>
          {Object.entries(STATES).map(([k, s]) => (
            <option value={k} selected={house?.state === k}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
    )}
    {withState && (
      <label>
        Návrh
        <select name="design">
          {Object.entries(DESIGNS).map(([k, l]) => (
            <option value={k} selected={(house?.design ?? 'original') === k}>
              {l}
            </option>
          ))}
        </select>
      </label>
    )}
    <fieldset class="mods">
      <legend>Typ úprav (lze vybrat více)</legend>
      {Object.entries(MODIFICATIONS).map(([k, l]) => (
        <label class="check">
          <input type="checkbox" name="modifications[]" value={k} checked={mods?.includes(k)} /> {l}
        </label>
      ))}
    </fieldset>
    <div class="row">
      <label>
        Rok stavby
        <input name="year_built" type="number" min={1950} max={2030} value={house?.year_built ?? ''} />
      </label>
      <label>
        Rok rekonstrukce
        <input name="year_renovated" type="number" min={1960} max={2030} value={house?.year_renovated ?? ''} />
      </label>
    </div>
    <div class="row">
      <label>
        Střešní krytina
        <select name="roof">
          <option value="">Nevím</option>
          {Object.entries(ROOFS).map(([k, l]) => (
            <option value={k} selected={house?.roof === k}>
              {l}
            </option>
          ))}
        </select>
      </label>
    </div>
    {withState && <FacadeSwatches selected={house?.facade_color} />}
    <label>
      Poznámka
      <textarea name="note" rows={3} maxlength={2000}>
        {house?.note ?? ''}
      </textarea>
    </label>
    <label>
      Odkaz (článek, inzerát, blog o rekonstrukci)
      <input name="link" type="url" maxlength={1000} value={house?.link ?? ''} />
    </label>
  </>
);

const EditForm = ({ house, mods, siteKey }: { house: House; mods: string[]; siteKey: string }) => (
  <form class="ajax" action={`/api/houses/${house.id}/edit`} method="post">
    <input type="hidden" name="lat" value={String(house.lat)} />
    <input type="hidden" name="lng" value={String(house.lng)} />
    <input type="hidden" name="sv_heading" value={house.sv_heading ?? ''} />
    <input type="hidden" name="sv_pitch" value={house.sv_pitch ?? ''} />
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
  </form>
);

// ---------- Přidání domu ----------

const QUICK_STATES = ['original', 'partial', 'in_progress', 'renovated', 'unknown'] as const;

pages.get('/pridat', (c) =>
  c.html(
    <Layout env={c.env} path="/pridat" title="Přidat šumperák" map turnstile scripts={['/js/add.js']}>
      <div class="page add">
        <h1>Přidat šumperák</h1>
        <p class="lead">Klikni do mapy na dům, nebo napiš adresu. Víc není potřeba.</p>
        <p class="map-legend muted small">
          <span class="dot" style="--c:#1f3a5f"></span> už na mapě <span class="dot" style="--c:#2f9e5b"></span> právě
          přidáno, čeká na schválení
        </p>
        <form id="add-form" class="ajax" action="/api/houses" method="post" enctype="multipart/form-data" data-validate="validateAdd">
          <div class="geosearch">
            <input type="search" id="address-search" placeholder="Adresa, např. Lidická 12, Šumperk" autocomplete="off" />
            <ul id="address-results" class="suggestions" hidden></ul>
          </div>
          <div id="add-map" class="add-map"></div>
          <Turnstile siteKey={c.env.TURNSTILE_SITE_KEY} />

          <input type="hidden" name="lat" />
          <input type="hidden" name="lng" />
          <input type="hidden" name="country" />
          <input type="hidden" name="district" />
          <input type="hidden" name="region" />

          <section id="picked" class="picked" hidden>
            <div class="sv-frame picked-pano">
              <img id="picked-pano" alt="Pohled z ulice" hidden />
              <div class="sv-placeholder">U tohoto místa panorama z ulice není.</div>
            </div>
            <div class="picked-body">
              <h2 id="picked-address">Vybraný dům</h2>
              <p class="muted">Není to ono? Klikni v mapě vedle, nebo přetáhni špendlík.</p>
              <div id="duplicates" class="alert" hidden></div>

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

              <FacadeSwatches picker />

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
                <p class="muted">
                  Hodí se hlavně fotky před a po rekonstrukci. Před nahráním se zmenší a odstraní se z nich GPS. Foť jen
                  z ulice a bez lidí a SPZ.
                </p>
                <div class="photo-slots" data-slots="6"></div>
                <label>
                  Autor fotek
                  <input name="author" maxlength={80} />
                </label>
              </details>
            </div>
          </section>
        </form>
      </div>
    </Layout>,
  ),
);

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
            country, count(*) AS n
       FROM houses WHERE status = 'approved'
      GROUP BY municipality_slug, country ORDER BY country, region, name`,
  ).all<{ slug: string; name: string; region: string; country: string; n: number }>();

  const groups = new Map<string, typeof results>();
  for (const r of results) {
    const key = `${r.country === 'sk' ? 'Slovensko' : 'Česko'}: ${r.region}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  return c.html(
    <Layout env={c.env} path="/obce" title="Šumperáky podle obcí">
      <div class="page">
        <h1>Šumperáky podle obcí</h1>
        {results.length === 0 && <p>Zatím tu nic není. <a href="/pridat">Přidej první šumperák!</a></p>}
        <div class="columns">
          {[...groups].map(([region, rows]) => (
            <section>
              <h2>{region}</h2>
              <ul class="plain">
                {rows.map((r) => (
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

const cardsQuery = `SELECT h.id, h.lat, h.lng, h.country, h.state, h.street, h.house_number, h.hide_number, h.municipality,
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
              <a href={`/dum/${h.id}`}>
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

// ---------- Statistiky ----------

pages.get('/statistiky', async (c) => {
  const db = c.env.DB;
  const [byState, byDesign, byRegion, byMod, byYear, byColor, totals] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT state AS k, count(*) AS n FROM houses WHERE status = 'approved' GROUP BY state ORDER BY n DESC`),
    db.prepare(`SELECT design AS k, count(*) AS n FROM houses WHERE status = 'approved' GROUP BY design ORDER BY n DESC`),
    db.prepare(
      `SELECT coalesce(region, 'Neuvedeno') AS k, count(*) AS n FROM houses WHERE status = 'approved' GROUP BY k ORDER BY n DESC`,
    ),
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
      `SELECT count(*) AS houses, (SELECT count(*) FROM photos WHERE status = 'approved') AS photos,
              count(DISTINCT municipality_slug) AS municipalities FROM houses WHERE status = 'approved'`,
    ),
  ]);
  const t = totals.results[0] as { houses: number; photos: number; municipalities: number };
  const rows = (r: D1Result<Record<string, unknown>>) => r.results as { k: string | number; n: number }[];

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
        </div>
        <div class="columns">
          <Bars
            title="Podle stavu"
            rows={rows(byState).map((r) => ({
              label: STATES[r.k as keyof typeof STATES]?.label ?? String(r.k),
              n: r.n,
              color: STATES[r.k as keyof typeof STATES]?.color,
            }))}
          />
          <Bars
            title="Podle návrhu"
            rows={rows(byDesign).map((r) => ({ label: DESIGNS[r.k as keyof typeof DESIGNS] ?? String(r.k), n: r.n }))}
          />
          <Bars
            title="Barvy fasád"
            rows={rows(byColor).map((r) => {
              const f = FACADE_COLORS[r.k as keyof typeof FACADE_COLORS];
              return { label: f?.label ?? String(r.k), n: r.n, color: f?.hex };
            })}
          />
          <Bars title="Podle kraje" rows={rows(byRegion).map((r) => ({ label: String(r.k), n: r.n }))} />
          <Bars
            title="Nejčastější úpravy"
            rows={rows(byMod).map((r) => ({ label: MODIFICATIONS[r.k as keyof typeof MODIFICATIONS] ?? String(r.k), n: r.n }))}
          />
          <Bars
            title="Rekonstrukce podle let"
            rows={rows(byYear).map((r) => ({ label: `${r.k}–${Number(r.k) + 4}`, n: r.n }))}
          />
        </div>
      </div>
    </Layout>,
  );
});

const Bars = ({ title, rows }: { title: string; rows: { label: string; n: number; color?: string }[] }) => {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <section class="bars">
      <h2>{title}</h2>
      {rows.length === 0 && <p class="muted">Zatím bez dat.</p>}
      {rows.map((r) => (
        <div class="bar-row">
          <span class="bar-label">{r.label}</span>
          <span class="bar-track">
            <span class="bar" style={`width:${(r.n / max) * 100}%${r.color ? `;--c:${r.color}` : ''}`}></span>
          </span>
          <span class="bar-value">{r.n}</span>
        </div>
      ))}
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
          <li>U existujících domů potvrď, že jde opravdu o šumperák, nebo navrhni opravu údajů.</li>
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
        <h2>Pohled z ulice</h2>
        <p>
          Snímky z ulice načítá tvůj prohlížeč přímo ze služby Google Street View, my je neukládáme. Platí pro ně{' '}
          <a href="https://policies.google.com/privacy" rel="noopener">zásady ochrany soukromí Googlu</a>.
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
