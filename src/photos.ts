import { MAX_PHOTO_BYTES, MAX_PHOTOS_PER_SUBMIT, PHOTO_PHASES, PHOTO_TYPES, isKey } from './domain';
import { int, str } from './lib/util';

type Form = Record<string, string | File | (string | File)[]>;

const list = (v: Form[string] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

// Ověření podle prvních bajtů, ne podle hlavičky od klienta.
const sniff = (b: Uint8Array): string | null => {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
};

export type PhotoUpload = {
  bytes: ArrayBuffer;
  type: string;
  phase: string;
  year: number | null;
  caption: string | null;
};

// Formulář posílá pole photo[], photo_phase[], photo_year[], photo_caption[] se stejným pořadím.
export const parsePhotos = async (form: Form): Promise<{ photos: PhotoUpload[]; error?: string }> => {
  const files = list(form['photo[]'] ?? form.photo);
  const phases = list(form['photo_phase[]'] ?? form.photo_phase);
  const years = list(form['photo_year[]'] ?? form.photo_year);
  const captions = list(form['photo_caption[]'] ?? form.photo_caption);

  const photos: PhotoUpload[] = [];
  for (const [i, f] of files.entries()) {
    if (!(f instanceof File) || f.size === 0) continue;
    if (photos.length >= MAX_PHOTOS_PER_SUBMIT) return { photos, error: `Najednou lze nahrát nejvýše ${MAX_PHOTOS_PER_SUBMIT} fotek.` };
    if (f.size > MAX_PHOTO_BYTES) return { photos, error: 'Fotka je příliš velká (max. 8 MB).' };
    const bytes = await f.arrayBuffer();
    const type = sniff(new Uint8Array(bytes.slice(0, 12)));
    if (!type) return { photos, error: 'Podporované formáty fotek jsou JPEG, PNG a WebP.' };
    const phase = phases[i];
    photos.push({
      bytes,
      type,
      phase: isKey(PHOTO_PHASES, phase) ? phase : 'current',
      year: int(years[i], 1960, new Date().getFullYear()),
      caption: str(captions[i], 200),
    });
  }
  return { photos };
};

export const storePhotos = async (
  db: D1Database,
  bucket: R2Bucket,
  houseId: number,
  photos: PhotoUpload[],
  author: string | null,
  submitterHash: string,
) => {
  for (const p of photos) {
    const key = `houses/${houseId}/${crypto.randomUUID()}.${PHOTO_TYPES[p.type]}`;
    await bucket.put(key, p.bytes, { httpMetadata: { contentType: p.type } });
    await db
      .prepare(
        `INSERT INTO photos (house_id, r2_key, phase, year_taken, caption, author, submitter_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(houseId, key, p.phase, p.year, p.caption, author, submitterHash)
      .run();
  }
};
