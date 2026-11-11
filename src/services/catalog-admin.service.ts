import { randomBytes } from 'node:crypto';
import { detectBarcodeType } from '../lib/barcode.js';
import { sql } from '../db/client.js';
import { getStorage } from '../lib/storage.js';
import { nowMs } from '../lib/time.js';
import { AppError, validation } from '../lib/errors.js';
import { catalogCreateSchema, catalogUpdateSchema } from '../schemas/catalog.schema.js';
import * as catalog from './catalog.service.js';

/**
 * Kelola katalog dari dashboard admin (HTML form): baca termasuk yang di Sampah,
 * simpan dari form, upload foto server-side, aksi massal, pulihkan.
 * Validasi & cek barcode duplikat memakai catalog.service yang sama dengan API.
 */

export interface CatalogDetail {
  id: string;
  barcode: string | null;
  barcodeType: string | null;
  name: string | null;
  shortDescription: string | null;
  photoUrl: string | null;
  brand: string | null;
  category: string | null;
  manufacturer: string | null;
  defaultUnit: string | null;
  netSize: number | null;
  netUnit: string | null;
  packaging: string | null;
  variant: string | null;
  countryOfOrigin: string | null;
  keywords: string[];
  verified: boolean;
  source: string;
  createdAt: number | null;
  updatedAt: number | null;
  deletedAt: number | null;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Satu produk katalog (termasuk yang sudah di Sampah). */
export async function getProduct(id: string): Promise<CatalogDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await sql<Record<string, unknown>[]>`SELECT * FROM public_products WHERE id = ${id} LIMIT 1`;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id as string,
    barcode: (r.barcode as string) ?? null,
    barcodeType: (r.barcode_type as string) ?? null,
    name: (r.name as string) ?? null,
    shortDescription: (r.short_description as string) ?? null,
    photoUrl: (r.photo_url as string) ?? null,
    brand: (r.brand as string) ?? null,
    category: (r.category as string) ?? null,
    manufacturer: (r.manufacturer as string) ?? null,
    defaultUnit: (r.default_unit as string) ?? null,
    netSize: num(r.net_size),
    netUnit: (r.net_unit as string) ?? null,
    packaging: (r.packaging as string) ?? null,
    variant: (r.variant as string) ?? null,
    countryOfOrigin: (r.country_of_origin as string) ?? null,
    keywords: (r.keywords as string[]) ?? [],
    verified: Boolean(r.verified),
    source: (r.source as string) ?? 'admin',
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    deletedAt: num(r.deleted_at),
  };
}

// ── Form → input katalog ─────────────────────────────────────────────────────

type FormBody = Record<string, string | File | (string | File)[]>;

const str = (b: FormBody, k: string): string => {
  const v = b[k];
  return typeof v === 'string' ? v.trim() : '';
};
const opt = (b: FormBody, k: string): string | null => str(b, k) || null;

/** Field teks form → objek wire katalog. Kosong = null (menghapus nilai). */
function formToInput(b: FormBody): Record<string, unknown> {
  const netRaw = str(b, 'netSize').replace(',', '.');
  const netSize = netRaw === '' ? null : Number(netRaw);
  if (netSize !== null && !Number.isFinite(netSize)) throw validation('Ukuran bersih harus angka');
  const keywords = str(b, 'keywords')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  return {
    name: str(b, 'name'),
    barcode: opt(b, 'barcode'),
    // Jenis kosong → dikenali dari barcode (13/12/8 digit + check digit GS1).
    barcodeType: opt(b, 'barcodeType') ?? detectBarcodeType(str(b, 'barcode')),
    brand: opt(b, 'brand'),
    category: opt(b, 'category'),
    manufacturer: opt(b, 'manufacturer'),
    defaultUnit: opt(b, 'defaultUnit'),
    netSize,
    netUnit: opt(b, 'netUnit'),
    packaging: opt(b, 'packaging'),
    variant: opt(b, 'variant'),
    countryOfOrigin: opt(b, 'countryOfOrigin'),
    shortDescription: opt(b, 'shortDescription'),
    photoUrl: opt(b, 'photoUrl'),
    keywords: [...new Set(keywords)],
    verified: b.verified === 'on',
    source: str(b, 'source') || 'admin',
  };
}

/** Foto katalog dikompres di browser (browser-image-compression) → maks 200 KB. */
export const MAX_PHOTO_BYTES = 200 * 1024;
/**
 * Hanya format yang pasti tampil di app Flutter (Image.network di Android & iOS): JPEG, PNG, WebP.
 * HEIC/AVIF/SVG/TIFF ditolak (tak didukung decoder Flutter); GIF/BMP tak dipakai untuk foto produk.
 */
const PHOTO_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Format sebenarnya dari isi file (bukan dari ekstensi/MIME yang bisa dipalsukan). */
export function sniffImageType(buf: Uint8Array): keyof typeof PHOTO_TYPES | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.length >= 12 && String.fromCharCode(...buf.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...buf.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

const RAND = 'abcdefghijklmnopqrstuvwxyz0123456789';
function rand6(): string {
  const b = randomBytes(6);
  return Array.from(b, (x) => RAND[x % RAND.length]).join('');
}

/**
 * Nama file foto: `<nama-asli>-<6 huruf kecil/angka>.<ext>` (mis. `indomie-goreng-k3f9x2.jpg`).
 * Nama dari browser yang sudah berpola itu dipakai apa adanya; selain itu dibentuk ulang di server.
 */
export function photoFileName(original: string, ext: string): string {
  const base = original.replace(/\.[^.]*$/, '');
  const ready = /^([a-z0-9]+(?:-[a-z0-9]+)*)-([a-z0-9]{6})$/.exec(base);
  if (ready && ready[1]!.length <= 60) return `${base}.${ext}`;
  return `${slug(base).slice(0, 60)}-${rand6()}.${ext}`;
}

/** URL foto manual: tolak ekstensi yang tak bisa ditampilkan app Flutter. */
export function assertDisplayablePhotoUrl(url: string | null | undefined): void {
  if (!url) return;
  let path = '';
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return; // format URL divalidasi skema
  }
  if (/\.(heic|heif|avif|svg|svgz|tif|tiff|bmp|gif|ico|psd|raw)$/.test(path)) {
    throw validation('Format foto tidak bisa ditampilkan di aplikasi. Pakai JPG, PNG, atau WebP.');
  }
}

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'produk';
}

/** Upload foto ke bucket (server-side, presigned PUT) → URL publik. */
async function uploadPhoto(file: File): Promise<string> {
  if (file.size > MAX_PHOTO_BYTES) {
    throw validation(`Foto ${Math.ceil(file.size / 1024)} KB — maksimal 200 KB. Pilih ulang foto agar dikompres otomatis.`);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) throw validation('Foto harus JPG, PNG, atau WebP (format lain tidak bisa ditampilkan di aplikasi).');
  const storage = getStorage();
  const key = `catalog/${photoFileName(file.name || 'produk', PHOTO_TYPES[type]!)}`;
  const res = await fetch(storage.signPut(key, type), {
    method: 'PUT',
    headers: { 'Content-Type': type },
    body: bytes,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new AppError('INTERNAL', `Upload foto gagal (HTTP ${res.status})`);
  return storage.publicUrl(key);
}

function photoFile(b: FormBody): File | null {
  const f = b.photo;
  return f instanceof File && f.size > 0 ? f : null;
}

/** Simpan perubahan dari form edit. Kembalikan id. */
export async function saveFromForm(id: string, body: FormBody): Promise<string> {
  const input = formToInput(body);
  const file = photoFile(body);
  if (file) input.photoUrl = await uploadPhoto(file);
  else assertDisplayablePhotoUrl(input.photoUrl as string | null | undefined);
  await catalog.update(id, catalogUpdateSchema.parse(input));
  return id;
}

/** Buat produk baru dari form. Kembalikan id. */
export async function createFromForm(body: FormBody): Promise<string> {
  const input = formToInput(body);
  const file = photoFile(body);
  if (file) input.photoUrl = await uploadPhoto(file);
  else assertDisplayablePhotoUrl(input.photoUrl as string | null | undefined);
  const row = await catalog.create(catalogCreateSchema.parse(input));
  return row.id as string;
}

/** Nilai form mentah (untuk mengisi ulang form saat validasi gagal). */
export function formEcho(body: FormBody): Partial<CatalogDetail> {
  try {
    const i = formToInput(body);
    return { ...(i as Partial<CatalogDetail>), keywords: (i.keywords as string[]) ?? [] };
  } catch {
    return { name: str(body, 'name') };
  }
}

// ── Hapus / pulihkan / aksi massal ───────────────────────────────────────────

export const BULK_ACTIONS = ['delete', 'restore', 'verify', 'unverify'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export interface BulkResult {
  done: number;
  skipped: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function bulk(action: BulkAction, rawIds: string[]): Promise<BulkResult> {
  const ids = [...new Set(rawIds.filter((x) => UUID_RE.test(x)))].slice(0, 500);
  if (ids.length === 0) return { done: 0, skipped: 0 };
  const ts = nowMs();

  if (action === 'restore') return restore(ids, ts);

  const rows =
    action === 'delete'
      ? await sql`UPDATE public_products SET deleted_at = ${ts}, updated_at = ${ts}
                  WHERE id = ANY(${ids}::uuid[]) AND deleted_at IS NULL RETURNING id`
      : await sql`UPDATE public_products SET verified = ${action === 'verify'}, updated_at = ${ts}
                  WHERE id = ANY(${ids}::uuid[]) AND deleted_at IS NULL RETURNING id`;
  return { done: rows.length, skipped: ids.length - rows.length };
}

/**
 * Pulihkan dari Sampah. Barcode unik di antara produk hidup → produk yang
 * barcode-nya kini dipakai produk lain dilewati (bukan menggagalkan semua).
 */
async function restore(ids: string[], ts: number): Promise<BulkResult> {
  // Satu per satu: dua produk Sampah ber-barcode sama → yang kedua terlewati, bukan 23505.
  let done = 0;
  for (const id of ids) {
    const rows = await sql`
      UPDATE public_products p SET deleted_at = NULL, updated_at = ${ts}
      WHERE p.id = ${id} AND p.deleted_at IS NOT NULL
        AND (p.barcode IS NULL OR NOT EXISTS (
          SELECT 1 FROM public_products o
          WHERE o.barcode = p.barcode AND o.deleted_at IS NULL AND o.id <> p.id))
      RETURNING p.id
    `;
    done += rows.length;
  }
  return { done, skipped: ids.length - done };
}
