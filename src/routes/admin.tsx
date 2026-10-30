import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { DESIGNS, MODIFICATIONS, PHOTO_PHASES, REPORT_KINDS, STATES } from '../domain';
import type { AppEnv } from '../env';
import { addRevision, addressLine, getModifications, housesNear, modificationStatements, type House, type Photo } from '../db';
import { EDITABLE_FIELDS, FIELD_LABELS } from '../input';
import { requireAccess } from '../lib/access';
import { mapyLink, streetViewLink } from '../lib/streetview';
import { distance, formatDate, slugify } from '../lib/util';
import { FacadeSwatch, ModList, StateBadge, panoUrl } from '../views/components';
import { Layout } from '../views/layout';
import { servePhoto } from './files';

export const admin = new Hono<AppEnv>();

admin.use('*', requireAccess);
admin.use('*', csrf());

const adminPhoto = (key: string) => `/admin/foto/${key}`;

admin.get('/foto/:key{.+}', (c) => servePhoto(c.env.PHOTOS, c.req.param('key'), 'private, no-store'));

const Action = ({ action, label, kind, confirm }: { action: string; label: string; kind?: string; confirm?: string }) => (
  <form method="post" action={action} class="inline" data-confirm={confirm}>
    <button class={`btn btn-sm ${kind ?? ''}`} type="submit">
      {label}
    </button>
  </form>
);

const formatValue = (field: string, v: unknown) => {
  if (v === null || v === undefined || v === '') return '(prázdné)';
  if (field === 'state') return STATES[v as keyof typeof STATES]?.label ?? String(v);
  if (field === 'design') return DESIGNS[v as keyof typeof DESIGNS] ?? String(v);
  if (field === 'modifications')
    return (v as string[]).map((m) => MODIFICATIONS[m as keyof typeof MODIFICATIONS] ?? m).join(', ') || '(žádné)';
  if (field === 'hide_number') return v ? 'ano' : 'ne';
  return String(v);
};

admin.get('/', async (c) => {
  const db = c.env.DB;
  const skip = Number.parseInt(c.req.query('po') ?? '0', 10) || 0;
  const [houses, photos, edits, reports, pendingCount] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT * FROM houses WHERE status = 'pending' AND id > ? ORDER BY id LIMIT 1`).bind(skip),
    db.prepare(
      `SELECT p.*, h.status AS house_status, h.municipality, h.street, h.house_number, h.hide_number
         FROM photos p JOIN houses h ON h.id = p.house_id WHERE p.status = 'pending' ORDER BY p.id LIMIT 100`,
    ),
    db.prepare(
      `SELECT e.*, h.municipality, h.street, h.house_number, h.hide_number
         FROM edit_suggestions e JOIN houses h ON h.id = e.house_id WHERE e.status = 'pending' ORDER BY e.id LIMIT 50`,
    ),
    db.prepare(
      `SELECT r.*, h.municipality, h.street, h.house_number, h.hide_number, h.status AS house_status
         FROM reports r JOIN houses h ON h.id = r.house_id WHERE r.status = 'open' ORDER BY r.id LIMIT 50`,
    ),
    db.prepare(`SELECT count(*) AS n, sum(id <= ?) AS skipped FROM houses WHERE status = 'pending'`).bind(skip),
  ]);
  const current = (houses.results as unknown as House[])[0];
  const { n: pendingTotal, skipped } = pendingCount.results[0] as { n: number; skipped: number | null };
  // Pořadí aktuálního domu ve frontě (přeskočené jsou před ním).
  const position = (skipped ?? 0) + 1;
  const [currentMods, neighbours] = current
    ? await Promise.all([
        getModifications(db, current.id),
        housesNear(db, current.lat, current.lng, 40).then((rows) =>
          rows
            .filter((r) => r.id !== current.id)
            .map((r) => ({ ...r, distance: Math.round(distance(current.lat, current.lng, r.lat, r.lng)) }))
            .filter((r) => r.distance <= 40),
        ),
      ])
    : [[], []];
  const currentPano = current ? panoUrl(c.env, current) : null;
  const allPhotos = photos.results as unknown as (Photo & { house_status: string } & House)[];
  // Fotky nových domů ukazujeme u domu, ostatní zvlášť.
  const photosByHouse = new Map<number, Photo[]>();
  for (const p of allPhotos.filter((p) => p.house_status === 'pending')) {
    photosByHouse.set(p.house_id, [...(photosByHouse.get(p.house_id) ?? []), p]);
  }
  const loosePhotos = allPhotos.filter((p) => p.house_status !== 'pending');
  const editRows = edits.results as unknown as ({ id: number; house_id: number; payload: string; comment: string | null; created_at: string } & House)[];
  const reportRows = reports.results as unknown as ({
    id: number;
    house_id: number;
    kind: keyof typeof REPORT_KINDS;
    message: string | null;
    contact: string | null;
    created_at: string;
    house_status: string;
  } & House)[];

  return c.html(
    <Layout env={c.env} path="/admin" title="Moderace" map scripts={['/js/admin.js', '/js/house.js']}>
      <div class="page admin">
        <h1>Moderace</h1>
        <nav class="admin-nav">
          <a href="#domy">Nové domy ({pendingTotal})</a>
          <a href="#fotky">Fotky ({loosePhotos.length})</a>
          <a href="#upravy">Návrhy úprav ({editRows.length})</a>
          <a href="#nahlaseni">Nahlášení ({reportRows.length})</a>
        </nav>

        <section id="domy">
          <h2>Nové domy</h2>
          {!current && (
            <p class="muted">
              {pendingTotal ? <a href="/admin#domy">Začít znovu od prvního přeskočeného</a> : 'Nic ke schválení.'}
            </p>
          )}
          {current && (
            <article
              class="review house"
              data-lat={current.lat}
              data-lng={current.lng}
              data-state={current.state}
            >
              <div class="review-media">
                {currentPano ? (
                  <div class="sv-frame">
                    <img src={currentPano} alt="Pohled z ulice" onerror="this.parentElement.classList.add('pano-missing')" />
                    <div class="sv-placeholder">Panorama tu není</div>
                  </div>
                ) : (
                  <p class="muted">Bez klíče Mapy.com se panorama nezobrazí.</p>
                )}
                {(photosByHouse.get(current.id) ?? []).length > 0 && (
                  <div class="mod-photos">
                    {(photosByHouse.get(current.id) ?? []).map((p) => (
                      <figure>
                        <a href={adminPhoto(p.r2_key)} target="_blank">
                          <img src={adminPhoto(p.r2_key)} alt="" />
                        </a>
                        <figcaption>
                          {PHOTO_PHASES[p.phase as keyof typeof PHOTO_PHASES]} {p.year_taken ?? ''}
                        </figcaption>
                        <Action action={`/admin/photos/${p.id}/reject`} label="Zamítnout fotku" />
                      </figure>
                    ))}
                  </div>
                )}
              </div>
              <div class="review-info">
                <p class="muted">
                  Dům {position} z {pendingTotal} čekajících · #{current.id} · přidáno{' '}
                  {formatDate(current.created_at)}
                </p>
                <h3>{addressLine(current)}</h3>
                <p class="meta">
                  <StateBadge state={current.state} /> <FacadeSwatch color={current.facade_color} />
                  <span class="tag">{DESIGNS[current.design as keyof typeof DESIGNS]}</span>
                </p>
                <p class="muted">
                  {[current.district, current.region, current.country.toUpperCase()].filter(Boolean).join(' · ')}
                  {current.hide_number ? ' · číslo skryté' : ''}
                </p>
                <ModList mods={currentMods} />
                {(current.year_built || current.year_renovated) && (
                  <p>
                    {current.year_built ? `Postaveno ${current.year_built}. ` : ''}
                    {current.year_renovated ? `Rekonstrukce ${current.year_renovated}.` : ''}
                  </p>
                )}
                {current.note && <p class="note">{current.note}</p>}
                {current.link && (
                  <p>
                    <a href={current.link} target="_blank" rel="noopener nofollow">
                      {current.link}
                    </a>
                  </p>
                )}
                {neighbours.length > 0 && (
                  <div class="alert">
                    <strong>Možná duplicita, v okolí už je:</strong>
                    <ul>
                      {neighbours.map((n) => (
                        <li>
                          #{n.id} {addressLine(n)} ({n.status === 'approved' ? 'na mapě' : 'čeká'}, {n.distance} m)
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div id="mini-map" class="mini-map"></div>
                <div class="review-actions">
                  <Action action={`/admin/houses/${current.id}/approve`} label="✓ Schválit (A)" kind="btn-primary btn-lg" />
                  <Action
                    action={`/admin/houses/${current.id}/reject`}
                    label="✕ Zamítnout (Z)"
                    kind="btn-danger btn-lg"
                    confirm="Opravdu smazat záznam i fotky?"
                  />
                  <a class="btn btn-lg" href={`/admin?po=${current.id}#domy`} data-key="skip">
                    Přeskočit (→)
                  </a>
                </div>
                <p class="muted small">
                  <a href={mapyLink(current)} target="_blank" rel="noopener">Procházet panorama na Mapy.cz</a> ·{' '}
                  <a href={streetViewLink(current)} target="_blank" rel="noopener">Google Street View</a>
                </p>
              </div>
            </article>
          )}
        </section>

        <section id="fotky">
          <h2>Fotky k existujícím domům</h2>
          {loosePhotos.length === 0 && <p class="muted">Nic ke schválení.</p>}
          <div class="mod-photos">
            {loosePhotos.map((p) => (
              <figure>
                <a href={adminPhoto(p.r2_key)} target="_blank"><img src={adminPhoto(p.r2_key)} alt="" /></a>
                <figcaption>
                  <a href={`/dum/${p.house_id}`}>{addressLine(p)}</a>
                  <br />
                  {PHOTO_PHASES[p.phase as keyof typeof PHOTO_PHASES]} {p.year_taken ?? ''} {p.caption ?? ''}
                </figcaption>
                <Action action={`/admin/photos/${p.id}/approve`} label="Schválit" kind="btn-primary" />
                <Action action={`/admin/photos/${p.id}/reject`} label="Zamítnout" />
              </figure>
            ))}
          </div>
        </section>

        <section id="upravy">
          <h2>Návrhy úprav</h2>
          {editRows.length === 0 && <p class="muted">Žádné návrhy.</p>}
          {editRows.map((e) => {
            const changes = JSON.parse(e.payload) as Record<string, { from: unknown; to: unknown }>;
            return (
              <article class="mod-item">
                <header>
                  <a href={`/dum/${e.house_id}`}><strong>#{e.house_id} {addressLine(e)}</strong></a>{' '}
                  <span class="muted">{formatDate(e.created_at)}</span>
                </header>
                <table class="diff">
                  {Object.entries(changes).map(([f, ch]) => (
                    <tr>
                      <th>{FIELD_LABELS[f] ?? f}</th>
                      <td class="from">{formatValue(f, ch.from)}</td>
                      <td class="to">{formatValue(f, ch.to)}</td>
                    </tr>
                  ))}
                </table>
                {e.comment && <p class="note">{e.comment}</p>}
                <div class="actions">
                  <Action action={`/admin/edits/${e.id}/apply`} label="Použít" kind="btn-primary" />
                  <Action action={`/admin/edits/${e.id}/reject`} label="Zamítnout" />
                </div>
              </article>
            );
          })}
        </section>

        <section id="nahlaseni">
          <h2>Nahlášení</h2>
          {reportRows.length === 0 && <p class="muted">Žádná otevřená nahlášení.</p>}
          {reportRows.map((r) => (
            <article class="mod-item">
              <header>
                <strong>{REPORT_KINDS[r.kind]}</strong> ·{' '}
                <a href={`/dum/${r.house_id}`}>#{r.house_id} {addressLine(r)}</a>{' '}
                <span class="muted">({r.house_status}) {formatDate(r.created_at)}</span>
              </header>
              {r.message && <p class="note">{r.message}</p>}
              {r.contact && <p>Kontakt: {r.contact}</p>}
              <div class="actions">
                {r.house_status === 'approved' && (
                  <Action action={`/admin/houses/${r.house_id}/hide`} label="Skrýt dům" kind="btn-danger" />
                )}
                <Action action={`/admin/reports/${r.id}/resolve`} label="Vyřešeno" />
              </div>
            </article>
          ))}
        </section>
      </div>
    </Layout>,
  );
});

const back = (c: { redirect: (url: string) => Response }, anchor: string) => c.redirect(`/admin#${anchor}`);
const idParam = (raw: string) => Number.parseInt(raw, 10);

admin.post('/houses/:id/approve', async (c) => {
  const id = idParam(c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE houses SET status = 'approved', approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(id),
    c.env.DB.prepare(`UPDATE photos SET status = 'approved' WHERE house_id = ? AND status = 'pending'`).bind(id),
    addRevision(c.env.DB, id, 'Schváleno moderátorem'),
  ]);
  return back(c, 'domy');
});

admin.post('/houses/:id/reject', async (c) => {
  const id = idParam(c.req.param('id'));
  const { results } = await c.env.DB.prepare('SELECT r2_key FROM photos WHERE house_id = ?').bind(id).all<{ r2_key: string }>();
  if (results.length) await c.env.PHOTOS.delete(results.map((r) => r.r2_key));
  await c.env.DB.prepare('DELETE FROM houses WHERE id = ?').bind(id).run();
  return back(c, 'domy');
});

admin.post('/houses/:id/hide', async (c) => {
  const id = idParam(c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE houses SET status = 'hidden', updated_at = datetime('now') WHERE id = ?`).bind(id),
    c.env.DB.prepare(`UPDATE reports SET status = 'resolved', resolved_at = datetime('now') WHERE house_id = ? AND status = 'open'`).bind(id),
  ]);
  return back(c, 'nahlaseni');
});

admin.post('/photos/:id/approve', async (c) => {
  await c.env.DB.prepare(`UPDATE photos SET status = 'approved' WHERE id = ?`).bind(idParam(c.req.param('id'))).run();
  return back(c, 'fotky');
});

admin.post('/photos/:id/reject', async (c) => {
  const id = idParam(c.req.param('id'));
  const photo = await c.env.DB.prepare('SELECT r2_key FROM photos WHERE id = ?').bind(id).first<{ r2_key: string }>();
  if (photo) {
    await c.env.PHOTOS.delete(photo.r2_key);
    await c.env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
  }
  return back(c, 'fotky');
});

admin.post('/edits/:id/apply', async (c) => {
  const db = c.env.DB;
  const edit = await db
    .prepare(`SELECT house_id, payload FROM edit_suggestions WHERE id = ? AND status = 'pending'`)
    .bind(idParam(c.req.param('id')))
    .first<{ house_id: number; payload: string }>();
  if (!edit) return back(c, 'upravy');

  const changes = JSON.parse(edit.payload) as Record<string, { from: unknown; to: unknown }>;
  const columns = Object.keys(changes).filter(
    (f): f is Exclude<(typeof EDITABLE_FIELDS)[number], 'modifications'> =>
      f !== 'modifications' && (EDITABLE_FIELDS as readonly string[]).includes(f),
  );
  const sets = columns.map((f) => `${f} = ?`);
  const values: unknown[] = columns.map((f) => changes[f].to);
  if ('municipality' in changes) {
    sets.push('municipality_slug = ?');
    values.push(slugify(String(changes.municipality.to)));
  }

  await db.batch([
    db.prepare(`UPDATE houses SET ${[...sets, "updated_at = datetime('now')"].join(', ')} WHERE id = ?`).bind(...values, edit.house_id),
    ...('modifications' in changes ? modificationStatements(db, edit.house_id, changes.modifications.to as string[]) : []),
    db.prepare(`UPDATE edit_suggestions SET status = 'applied', resolved_at = datetime('now') WHERE id = ?`).bind(idParam(c.req.param('id'))),
    addRevision(db, edit.house_id, 'Úprava údajů', changes),
  ]);
  return back(c, 'upravy');
});

admin.post('/edits/:id/reject', async (c) => {
  await c.env.DB.prepare(`UPDATE edit_suggestions SET status = 'rejected', resolved_at = datetime('now') WHERE id = ?`)
    .bind(idParam(c.req.param('id')))
    .run();
  return back(c, 'upravy');
});

admin.post('/reports/:id/resolve', async (c) => {
  await c.env.DB.prepare(`UPDATE reports SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?`)
    .bind(idParam(c.req.param('id')))
    .run();
  return back(c, 'nahlaseni');
});
