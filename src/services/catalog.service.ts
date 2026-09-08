import { CatalogRepository, type CatalogRow } from '../db/repositories/catalog.repository.js';
import type { CatalogCreateInput, CatalogUpdateInput, SearchQuery } from '../schemas/catalog.schema.js';
import { uuid } from '../lib/uuid.js';
import { nowMs } from '../lib/time.js';
import { conflict, notFound, validation } from '../lib/errors.js';

/**
 * Catalog service — public_products GLOBAL (tanpa businessId, tanpa harga/stok).
 * Tulis (create/update/delete) hanya dipanggil route yang dijaga sirko_admin.
 */

const repo = new CatalogRepository();

/** Pemetaan field wire (camelCase) → kolom DB (snake_case). */
const WIRE_TO_DB: Record<string, string> = {
  barcode: 'barcode',
  barcodeType: 'barcode_type',
  name: 'name',
  shortDescription: 'short_description',
  photoUrl: 'photo_url',
  brand: 'brand',
  category: 'category',
  manufacturer: 'manufacturer',
  defaultUnit: 'default_unit',
  netSize: 'net_size',
  netUnit: 'net_unit',
  packaging: 'packaging',
  variant: 'variant',
  countryOfOrigin: 'country_of_origin',
  keywords: 'keywords',
  verified: 'verified',
  source: 'source',
};

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'number' ? v : Number(v);
}

/** Baris DB → bentuk wire (spec 10 §3.1). */
function serialize(row: CatalogRow): Record<string, unknown> {
  return {
    id: row.id,
    barcode: row.barcode ?? null,
    barcodeType: row.barcode_type ?? null,
    name: row.name ?? null,
    shortDescription: row.short_description ?? null,
    photoUrl: row.photo_url ?? null,
    brand: row.brand ?? null,
    category: row.category ?? null,
    manufacturer: row.manufacturer ?? null,
    defaultUnit: row.default_unit ?? null,
    netSize: toNum(row.net_size),
    netUnit: row.net_unit ?? null,
    packaging: row.packaging ?? null,
    variant: row.variant ?? null,
    countryOfOrigin: row.country_of_origin ?? null,
    keywords: (row.keywords as string[]) ?? [],
    verified: row.verified ?? false,
    source: row.source ?? 'admin',
    updatedAt: toNum(row.updated_at),
  };
}

/** Ubah field wire yang HADIR → objek kolom DB. */
function mapProvided(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [wire, db] of Object.entries(WIRE_TO_DB)) {
    if (input[wire] !== undefined) out[db] = input[wire];
  }
  return out;
}

export async function lookup(barcode: string): Promise<Record<string, unknown>> {
  const row = await repo.findByBarcode(barcode);
  if (!row) throw notFound('Produk katalog tidak ditemukan untuk barcode tersebut');
  return serialize(row);
}

export interface SearchResult {
  data: Record<string, unknown>[];
  meta: { nextCursor: string | null; hasMore: boolean };
}

export async function search(query: SearchQuery): Promise<SearchResult> {
  const offset = decodeOffset(query.cursor);
  const rows = await repo.search(query.q, query.limit, offset);
  const hasMore = rows.length === query.limit;
  return {
    data: rows.map(serialize),
    meta: { nextCursor: hasMore ? encodeOffset(offset + query.limit) : null, hasMore },
  };
}

export async function create(input: CatalogCreateInput): Promise<Record<string, unknown>> {
  const id = input.id ?? uuid();
  const ts = nowMs();

  if (input.barcode) {
    if (await repo.barcodeTakenByOther(input.barcode, null)) {
      throw conflict('Barcode sudah ada di katalog');
    }
  }

  const dbRow: Record<string, unknown> = {
    id,
    ...mapProvided(input as Record<string, unknown>),
    created_at: ts,
    updated_at: ts,
  };
  const row = await repo.create(dbRow);
  return serialize(row);
}

export async function update(
  id: string,
  input: CatalogUpdateInput,
): Promise<Record<string, unknown>> {
  const existing = await repo.findById(id);
  if (!existing) throw notFound('Produk katalog tidak ditemukan');

  if (input.barcode) {
    if (await repo.barcodeTakenByOther(input.barcode, id)) {
      throw conflict('Barcode sudah dipakai produk katalog lain');
    }
  }

  const patch = mapProvided(input as Record<string, unknown>);
  if (Object.keys(patch).length === 0) throw validation('Tidak ada field untuk diperbarui');
  patch.updated_at = nowMs();

  const row = await repo.update(id, patch);
  if (!row) throw notFound('Produk katalog tidak ditemukan');
  return serialize(row);
}

export async function remove(id: string): Promise<{ id: string; deleted: true }> {
  const ok = await repo.softDelete(id, nowMs());
  if (!ok) throw notFound('Produk katalog tidak ditemukan');
  return { id, deleted: true };
}

// ── Cursor offset opaque (search relevansi tak cocok keyset) ──────────────────

function encodeOffset(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64');
}

function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as { o?: unknown };
    const o = Number(parsed.o);
    return Number.isSafeInteger(o) && o >= 0 ? o : 0;
  } catch {
    throw validation('Cursor tidak valid');
  }
}
