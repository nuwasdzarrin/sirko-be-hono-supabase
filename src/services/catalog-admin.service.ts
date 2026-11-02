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
    barcodeType: opt(b, 'barcodeType'),
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

const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // < batas body Vercel 4.5 MB
const PHOTO_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'produk';
}

/** Upload foto ke bucket (server-side, presigned PUT) → URL publik. */
async function uploadPhoto(file: File, name: string, idHint: string): Promise<string> {
  const ext = PHOTO_TYPES[file.type];
  if (!ext) throw validation('Foto harus JPG, PNG, atau WebP');
  if (file.size > MAX_PHOTO_BYTES) throw validation('Foto maksimal 4 MB');
  const storage = getStorage();
  const key = `catalog/${slug(name)}_${idHint}-${Date.now()}.${ext}`;
  const res = await fetch(storage.signPut(key, file.type), {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: Buffer.from(await file.arrayBuffer()),
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
  if (file) input.photoUrl = await uploadPhoto(file, String(input.name || 'produk'), String(input.barcode || id.slice(0, 8)));
  await catalog.update(id, catalogUpdateSchema.parse(input));
  return id;
}

/** Buat produk baru dari form. Kembalikan id. */
export async function createFromForm(body: FormBody): Promise<string> {
  const input = formToInput(body);
  const file = photoFile(body);
  if (file) input.photoUrl = await uploadPhoto(file, String(input.name || 'produk'), String(input.barcode || 'baru'));
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
