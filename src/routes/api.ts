import { Hono, type MiddlewareHandler } from 'hono';
import { REPORT_KINDS, isKey } from '../domain';
import type { AppEnv } from '../env';
import {
  addressLine,
  getHouse,
  getModifications,
  housesNear,
  insertHouse,
  mapPoints,
  recentSubmissions,
} from '../db';
import { diffHouse, parseHouseInput } from '../input';
import { parsePhotos, storePhotos } from '../photos';
import { reversePlace, searchPlaces } from '../lib/geocode';
import { panoMeta } from '../lib/streetview';
import { verifyTurnstile } from '../lib/turnstile';
import { distance, num, sha256, str } from '../lib/util';

const MAX_WRITES_PER_HOUR = 30;
const DUPLICATE_RADIUS_M = 40;

export const api = new Hono<AppEnv>();

const fail = (message: string, status: 400 | 403 | 404 | 429 = 400) => Response.json({ ok: false, message }, { status });

// Všechny zápisy: Turnstile, otisk zařízení (hash IP se solí) a limit zápisů za hodinu.
const guardWrite: MiddlewareHandler<AppEnv> = async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP');
  const form = await c.req.parseBody({ all: true });
  if (!(await verifyTurnstile(c.env.TURNSTILE_SECRET, form['cf-turnstile-response'], ip))) {
    return fail('Ověření proti spamu selhalo. Obnov stránku a zkus to znovu.', 403);
  }
  const hash = await sha256(`${ip ?? 'unknown'}|${c.env.IP_SALT}`);
  if ((await recentSubmissions(c.env.DB, hash)) >= MAX_WRITES_PER_HOUR) {
    return fail('Příliš mnoho příspěvků za krátkou dobu. Zkus to prosím později.', 429);
  }
  c.set('clientHash', hash);
  return next();
};

const houseId = (raw: string) => {
  const id = Number.parseInt(raw, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

api.get('/houses.geojson', async (c) => {
  const rows = await mapPoints(c.env.DB);
  const features = rows.map((r) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    properties: {
      id: r.id,
      s: r.state,
      m: r.mods ?? '',
      p: r.photo ?? '',
      a: addressLine(r),
      r: r.region ?? '',
      c: r.facade_color ?? '',
    },
  }));
  return c.json({ type: 'FeatureCollection', features }, 200, { 'Cache-Control': 'public, max-age=60' });
});

api.get('/geocode', async (c) => {
  const q = str(c.req.query('q'), 200);
  if (!q || q.length < 3) return c.json([]);
  try {
    return c.json(await searchPlaces(q, c.executionCtx));
  } catch {
    return fail('Vyhledávání adres je teď nedostupné.');
  }
});

api.get('/reverse', async (c) => {
  const lat = num(c.req.query('lat'), -90, 90);
  const lng = num(c.req.query('lng'), -180, 180);
  if (lat === null || lng === null) return fail('Neplatná poloha.');
  try {
    return c.json(await reversePlace(lat, lng, c.executionCtx));
  } catch {
    return c.json(null);
  }
});

api.get('/nearby', async (c) => {
  const lat = num(c.req.query('lat'), -90, 90);
  const lng = num(c.req.query('lng'), -180, 180);
  if (lat === null || lng === null) return fail('Neplatná poloha.');
  const rows = await housesNear(c.env.DB, lat, lng, DUPLICATE_RADIUS_M);
  return c.json(
    rows
      .map((r) => ({
        id: r.id,
        status: r.status,
        label: addressLine(r),
        distance: Math.round(distance(lat, lng, r.lat, r.lng)),
      }))
      .filter((r) => r.distance <= DUPLICATE_RADIUS_M)
      .sort((a, b) => a.distance - b.distance),
  );
});

// Natočení kamery na dům a datum snímku. Bez serverového klíče vrací jen "neznámo".
api.get('/streetview', async (c) => {
  const lat = num(c.req.query('lat'), -90, 90);
  const lng = num(c.req.query('lng'), -180, 180);
  if (lat === null || lng === null) return fail('Neplatná poloha.');
  if (!c.env.GOOGLE_MAPS_SERVER_KEY) return c.json({ available: null, heading: null, date: null });
  return c.json(await panoMeta(c.env.GOOGLE_MAPS_SERVER_KEY, lat, lng));
});

api.post('/houses', guardWrite, async (c) => {
  const form = await c.req.parseBody({ all: true });

  // Adresu běžně vyplní prohlížeč. Když to nestihl, dohledáme ji tady.
  const lat = num(form.lat, -90, 90);
  const lng = num(form.lng, -180, 180);
  if (lat !== null && lng !== null && (!str(form.municipality) || !str(form.country))) {
    const place = await reversePlace(lat, lng, c.executionCtx).catch(() => null);
    if (place) {
      form.country = place.country ?? '';
      form.municipality = str(form.municipality) ?? place.municipality ?? '';
      form.street = str(form.street) ?? place.street ?? '';
      form.house_number = str(form.house_number) ?? place.houseNumber ?? '';
      form.district = place.district ?? '';
      form.region = place.region ?? '';
    }
  }

  const { data, error } = parseHouseInput(form);
  if (!data) return fail(error!);

  const { photos, error: photoError } = await parsePhotos(form);
  if (photoError) return fail(photoError);

  const id = await insertHouse(c.env.DB, data, c.get('clientHash'));
  await storePhotos(c.env.DB, c.env.PHOTOS, id, photos, str(form.author, 80), c.get('clientHash'));
  return c.json({ ok: true, id, redirect: `/dekujeme?id=${id}` });
});

api.post('/houses/:id/photos', guardWrite, async (c) => {
  const id = houseId(c.req.param('id'));
  const house = id && (await getHouse(c.env.DB, id));
  if (!house || house.status !== 'approved') return fail('Dům nenalezen.', 404);

  const form = await c.req.parseBody({ all: true });
  const { photos, error } = await parsePhotos(form);
  if (error) return fail(error);
  if (!photos.length) return fail('Vyber alespoň jednu fotku.');

  await storePhotos(c.env.DB, c.env.PHOTOS, house.id, photos, str(form.author, 80), c.get('clientHash'));
  return c.json({ ok: true, message: 'Díky! Fotky se zobrazí po schválení moderátorem.' });
});

api.post('/houses/:id/confirm', guardWrite, async (c) => {
  const id = houseId(c.req.param('id'));
  const house = id && (await getHouse(c.env.DB, id));
  if (!house || house.status !== 'approved') return fail('Dům nenalezen.', 404);

  const res = await c.env.DB.prepare('INSERT OR IGNORE INTO confirmations (house_id, voter_hash) VALUES (?, ?)')
    .bind(house.id, c.get('clientHash'))
    .run();
  const count = await c.env.DB.prepare('SELECT count(*) AS n FROM confirmations WHERE house_id = ?')
    .bind(house.id)
    .first<number>('n');
  return c.json({
    ok: true,
    count,
    message: res.meta.changes ? 'Díky za potvrzení!' : 'Tenhle dům už jsi potvrdil(a).',
  });
});

api.post('/houses/:id/report', guardWrite, async (c) => {
  const id = houseId(c.req.param('id'));
  const house = id && (await getHouse(c.env.DB, id));
  if (!house) return fail('Dům nenalezen.', 404);

  const form = await c.req.parseBody();
  if (!isKey(REPORT_KINDS, form.kind)) return fail('Vyber důvod nahlášení.');
  await c.env.DB.prepare('INSERT INTO reports (house_id, kind, message, contact, submitter_hash) VALUES (?, ?, ?, ?, ?)')
    .bind(house.id, form.kind, str(form.message, 2000), str(form.contact, 200), c.get('clientHash'))
    .run();
  return c.json({ ok: true, message: 'Díky, nahlášení jsme přijali a podíváme se na něj.' });
});

api.post('/houses/:id/edit', guardWrite, async (c) => {
  const id = houseId(c.req.param('id'));
  const house = id && (await getHouse(c.env.DB, id));
  if (!house || house.status !== 'approved') return fail('Dům nenalezen.', 404);

  const form = await c.req.parseBody({ all: true });
  // Zemi a správní celky návrh nemění, bereme je ze stávajícího záznamu.
  const { data, error } = parseHouseInput({
    ...form,
    country: house.country,
    district: house.district ?? '',
    region: house.region ?? '',
  });
  if (!data) return fail(error!);

  const current = { ...house, modifications: await getModifications(c.env.DB, house.id) };
  const changes = diffHouse(current, data);
  if (!Object.keys(changes).length) return fail('Návrh neobsahuje žádnou změnu.');

  await c.env.DB.prepare('INSERT INTO edit_suggestions (house_id, payload, comment, submitter_hash) VALUES (?, ?, ?, ?)')
    .bind(house.id, JSON.stringify(changes), str(form.comment, 1000), c.get('clientHash'))
    .run();
  return c.json({ ok: true, message: 'Díky! Návrh úprav se projeví po schválení moderátorem.' });
});
