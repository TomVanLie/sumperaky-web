import type { HouseInput } from './input';

export type House = {
  id: number;
  status: 'pending' | 'approved' | 'hidden' | 'rejected';
  lat: number;
  lng: number;
  country: 'cz' | 'sk';
  street: string | null;
  house_number: string | null;
  hide_number: number;
  municipality: string;
  municipality_slug: string;
  district: string | null;
  region: string | null;
  state: string;
  roof: string | null;
  facade_color: string | null;
  year_built: number | null;
  year_renovated: number | null;
  note: string | null;
  link: string | null;
  sv_heading: number | null;
  sv_pitch: number | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
};

export type Photo = {
  id: number;
  house_id: number;
  r2_key: string;
  phase: string;
  year_taken: number | null;
  caption: string | null;
  author: string | null;
  width: number | null;
  height: number | null;
  status: string;
  created_at: string;
};

export type Revision = { id: number; summary: string; changes: string | null; created_at: string };

export const addressLine = (h: Pick<House, 'street' | 'house_number' | 'hide_number' | 'municipality'>) => {
  const street = [h.street, h.hide_number ? null : h.house_number].filter(Boolean).join(' ');
  return [street, h.municipality].filter(Boolean).join(', ');
};

// Data pro mapu: kompaktní body, filtrování probíhá v prohlížeči.
export const mapPoints = async (db: D1Database) => {
  const { results } = await db
    .prepare(
      `SELECT h.id, h.lat, h.lng, h.state,
              (SELECT group_concat(modification) FROM house_modifications m WHERE m.house_id = h.id) AS mods,
              (SELECT r2_key FROM photos p WHERE p.house_id = h.id AND p.status = 'approved'
                 ORDER BY CASE p.phase WHEN 'current' THEN 0 WHEN 'after' THEN 1 ELSE 2 END, p.id DESC LIMIT 1) AS photo,
              h.street, h.house_number, h.hide_number, h.municipality, h.region, h.facade_color
         FROM houses h WHERE h.status = 'approved'`,
    )
    .all<
      Pick<
        House,
        'id' | 'lat' | 'lng' | 'state' | 'street' | 'house_number' | 'hide_number' | 'municipality' | 'region' | 'facade_color'
      > & {
        mods: string | null;
        photo: string | null;
      }
    >();
  return results;
};

export const getHouse = (db: D1Database, id: number) =>
  db.prepare('SELECT * FROM houses WHERE id = ?').bind(id).first<House>();

export const getModifications = async (db: D1Database, id: number) => {
  const { results } = await db
    .prepare('SELECT modification FROM house_modifications WHERE house_id = ?')
    .bind(id)
    .all<{ modification: string }>();
  return results.map((r) => r.modification);
};

export const getPhotos = async (db: D1Database, houseId: number, status: string = 'approved') => {
  const { results } = await db
    .prepare('SELECT * FROM photos WHERE house_id = ? AND status = ? ORDER BY year_taken IS NULL, year_taken, id')
    .bind(houseId, status)
    .all<Photo>();
  return results;
};

export const getRevisions = async (db: D1Database, houseId: number) => {
  const { results } = await db
    .prepare('SELECT id, summary, changes, created_at FROM revisions WHERE house_id = ? ORDER BY id DESC LIMIT 50')
    .bind(houseId)
    .all<Revision>();
  return results;
};

export const countConfirmations = async (db: D1Database, houseId: number) =>
  (await db.prepare('SELECT count(*) AS n FROM confirmations WHERE house_id = ?').bind(houseId).first<number>('n')) ?? 0;

export const addRevision = (db: D1Database, houseId: number, summary: string, changes?: unknown) =>
  db
    .prepare('INSERT INTO revisions (house_id, summary, changes) VALUES (?, ?, ?)')
    .bind(houseId, summary, changes ? JSON.stringify(changes) : null);

// Domy v okolí (pro kontrolu duplicit). Hrubý výběr obdélníkem, přesná vzdálenost dopočítá volající.
export const housesNear = async (db: D1Database, lat: number, lng: number, meters: number) => {
  const dLat = meters / 111320;
  const dLng = meters / (111320 * Math.cos((lat * Math.PI) / 180));
  const { results } = await db
    .prepare(
      `SELECT id, lat, lng, status, street, house_number, hide_number, municipality FROM houses
        WHERE status IN ('approved', 'pending') AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
    )
    .bind(lat - dLat, lat + dLat, lng - dLng, lng + dLng)
    .all<Pick<House, 'id' | 'lat' | 'lng' | 'status' | 'street' | 'house_number' | 'hide_number' | 'municipality'>>();
  return results;
};

export const insertHouse = async (db: D1Database, h: HouseInput, submitterHash: string) => {
  const row = await db
    .prepare(
      `INSERT INTO houses (lat, lng, country, street, house_number, hide_number, municipality, municipality_slug,
                           district, region, state, roof, facade_color, year_built, year_renovated, note, link,
                           sv_heading, sv_pitch, submitter_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      h.lat,
      h.lng,
      h.country,
      h.street,
      h.house_number,
      h.hide_number,
      h.municipality,
      h.municipality_slug,
      h.district,
      h.region,
      h.state,
      h.roof,
      h.facade_color,
      h.year_built,
      h.year_renovated,
      h.note,
      h.link,
      h.sv_heading,
      h.sv_pitch,
      submitterHash,
    )
    .first<{ id: number }>();
  const id = row!.id;
  await db.batch([...modificationStatements(db, id, h.modifications), addRevision(db, id, 'Dům přidán')]);
  return id;
};

export const modificationStatements = (db: D1Database, houseId: number, mods: string[]) => [
  db.prepare('DELETE FROM house_modifications WHERE house_id = ?').bind(houseId),
  ...mods.map((m) => db.prepare('INSERT INTO house_modifications (house_id, modification) VALUES (?, ?)').bind(houseId, m)),
];

// Kolik zápisů udělalo zařízení za poslední hodinu (jednoduchý rate limit).
export const recentSubmissions = async (db: D1Database, hash: string) =>
  (await db
    .prepare(
      `SELECT (SELECT count(*) FROM houses WHERE submitter_hash = ?1 AND created_at > datetime('now', '-1 hour'))
            + (SELECT count(*) FROM photos WHERE submitter_hash = ?1 AND created_at > datetime('now', '-1 hour'))
            + (SELECT count(*) FROM edit_suggestions WHERE submitter_hash = ?1 AND created_at > datetime('now', '-1 hour'))
            + (SELECT count(*) FROM reports WHERE submitter_hash = ?1 AND created_at > datetime('now', '-1 hour')) AS n`,
    )
    .bind(hash)
    .first<number>('n')) ?? 0;
