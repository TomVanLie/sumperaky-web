import { Hono } from 'hono';
import type { AppEnv } from '../env';

export const files = new Hono<AppEnv>();

// Fotky z R2. Veřejně jen schválené, moderátor vidí i čekající přes /admin/foto.
files.get('/foto/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const photo = await c.env.DB.prepare(`SELECT 1 FROM photos WHERE r2_key = ? AND status = 'approved'`).bind(key).first();
  if (!photo) return c.notFound();
  return servePhoto(c.env.PHOTOS, key, 'public, max-age=31536000, immutable');
});

export const servePhoto = async (bucket: R2Bucket, key: string, cacheControl: string) => {
  const obj = await bucket.get(key);
  if (!obj) return new Response('Nenalezeno', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('ETag', obj.httpEtag);
  headers.set('Cache-Control', cacheControl);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(obj.body, { headers });
};

type ExportRow = {
  id: number;
  lat: number;
  lng: number;
  country: string;
  street: string | null;
  house_number: string | null;
  municipality: string;
  district: string | null;
  region: string | null;
  state: string;
  design: string;
  modifications: string | null;
  roof: string | null;
  facade_color: string | null;
  year_built: number | null;
  year_renovated: number | null;
  updated_at: string;
};

const exportRows = async (db: D1Database) => {
  const { results } = await db
    .prepare(
      `SELECT h.id, round(h.lat, 6) AS lat, round(h.lng, 6) AS lng, h.country, h.street,
              CASE WHEN h.hide_number THEN NULL ELSE h.house_number END AS house_number,
              h.municipality, h.district, h.region, h.state, h.design,
              (SELECT group_concat(modification, ';') FROM house_modifications m WHERE m.house_id = h.id) AS modifications,
              h.roof, h.facade_color, h.year_built, h.year_renovated, h.updated_at
         FROM houses h WHERE h.status = 'approved' ORDER BY h.id`,
    )
    .all<ExportRow>();
  return results;
};

const EXPORT_HEADERS = { 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' };

files.get('/data/sumperaky.geojson', async (c) => {
  const rows = await exportRows(c.env.DB);
  const site = c.env.SITE_URL;
  return c.json(
    {
      type: 'FeatureCollection',
      license: 'CC BY-SA 4.0, Šumperáky.cz',
      features: rows.map(({ lat, lng, ...p }) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: { ...p, url: `${site}/dum/${p.id}` },
      })),
    },
    200,
    EXPORT_HEADERS,
  );
});

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Ochrana proti vzorcům v tabulkových editorech.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

files.get('/data/sumperaky.csv', async (c) => {
  const rows = await exportRows(c.env.DB);
  const cols = Object.keys(rows[0] ?? { id: 0 }) as (keyof ExportRow)[];
  const body = [cols.join(','), ...rows.map((r) => cols.map((k) => csvCell(r[k])).join(','))].join('\n');
  return c.body(`﻿${body}\n`, 200, { ...EXPORT_HEADERS, 'Content-Type': 'text/csv; charset=utf-8' });
});

files.get('/sitemap.xml', async (c) => {
  const site = c.env.SITE_URL;
  const [houses, munis] = await c.env.DB.batch<{ loc: string; lastmod: string }>([
    c.env.DB.prepare(`SELECT '/dum/' || id AS loc, updated_at AS lastmod FROM houses WHERE status = 'approved'`),
    c.env.DB.prepare(
      `SELECT '/obec/' || municipality_slug AS loc, max(updated_at) AS lastmod FROM houses WHERE status = 'approved' GROUP BY municipality_slug`,
    ),
  ]);
  const staticPaths = ['/', '/obce', '/promeny', '/statistiky', '/o-projektu', '/data'];
  const urls = [
    ...staticPaths.map((p) => `<url><loc>${site}${p}</loc></url>`),
    ...[...munis.results, ...houses.results].map(
      (r) => `<url><loc>${site}${r.loc}</loc><lastmod>${r.lastmod.slice(0, 10)}</lastmod></url>`,
    ),
  ];
  return c.body(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`,
    200,
    { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  );
});
