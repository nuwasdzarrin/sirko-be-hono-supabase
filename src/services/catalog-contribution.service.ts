import { sql } from '../db/client.js';
import { CatalogContributionRepository, type ContributionRow } from '../db/repositories/catalog-contribution.repository.js';
import type { CatalogContributionInput, ContributionListQuery } from '../schemas/catalog.schema.js';
import { uuid } from '../lib/uuid.js';
import { nowMs } from '../lib/time.js';
import { conflict, notFound, validation } from '../lib/errors.js';

/**
 * Layanan kontribusi katalog (Fitur 2 — crowdsource dengan moderasi).
 *
 * Toko biasa mengusulkan produk baru / edit → antre `catalog_contributions`
 * (status pending). Admin approve di dashboard → disalin ke `public_products`
 * (source='crowdsource', verified=true) secara ATOMIK. Reject → status rejected.
 */

const repo = new CatalogContributionRepository();

/** Kolom katalog yang bisa diusulkan (input wire → kolom DB). */
const FIELD_MAP: Record<string, string> = {
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
};

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'number' ? v : Number(v);
}

function serialize(row: ContributionRow): Record<string, unknown> {
  return {
    id: row.id,
    businessId: row.business_id ?? null,
    businessName: (row.business_name as string | undefined) ?? null,
    contributedBy: row.contributed_by ?? null,
    targetId: row.target_id ?? null,
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
    note: row.note ?? null,
    status: row.status ?? 'pending',
    reviewNote: row.review_note ?? null,
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: toNum(row.reviewed_at),
    resultProductId: row.result_product_id ?? null,
    createdAt: toNum(row.created_at),
    updatedAt: toNum(row.updated_at),
  };
}

export interface ListResult {
  data: Record<string, unknown>[];
  meta: { nextCursor: string | null; hasMore: boolean };
}

/** Toko mengajukan usulan produk (baru atau edit target_id). */
export async function submit(
  businessId: string,
  contributedBy: string,
  input: CatalogContributionInput,
): Promise<Record<string, unknown>> {
  const ts = nowMs();
  const row: Record<string, unknown> = {
    id: uuid(),
    business_id: businessId,
    contributed_by: contributedBy,
    target_id: input.targetId ?? null,
    keywords: input.keywords ?? [],
    note: input.note ?? null,
    status: 'pending',
    created_at: ts,
    updated_at: ts,
  };
  for (const [wire, db] of Object.entries(FIELD_MAP)) {
    const v = (input as Record<string, unknown>)[wire];
    if (v !== undefined) row[db] = v;
  }
  const created = await repo.create(row);
  return serialize(created);
}

/** Usulan milik satu toko (untuk layar "status usulan saya"). */
export async function listMine(businessId: string, query: ContributionListQuery): Promise<ListResult> {
  const offset = decodeOffset(query.cursor);
  const rows = await repo.listByBusiness(businessId, query.limit, offset);
  const hasMore = rows.length === query.limit;
  return {
    data: rows.map(serialize),
    meta: { nextCursor: hasMore ? encodeOffset(offset + query.limit) : null, hasMore },
  };
}

// ── Moderasi (dipanggil dashboard admin) ─────────────────────────────────────

/** Setujui usulan → salin ke public_products (atomik) + tandai approved. */
export async function approve(id: string, reviewer: string): Promise<Record<string, unknown>> {
  const ts = nowMs();
  return sql.begin(async (tx) => {
    const rows = await tx<ContributionRow[]>`
      SELECT * FROM catalog_contributions WHERE id = ${id} FOR UPDATE
    `;
    const contrib = rows[0];
    if (!contrib) throw notFound('Usulan tidak ditemukan');
    if (contrib.status !== 'pending') throw conflict('Usulan sudah diproses');

    // Bangun kolom katalog dari usulan.
    const cat: Record<string, unknown> = {};
    for (const db of Object.values(FIELD_MAP)) {
      if (contrib[db] !== undefined && contrib[db] !== null) cat[db] = contrib[db];
    }
    cat.keywords = (contrib.keywords as string[]) ?? [];

    let resultId: string;
    const targetId = contrib.target_id as string | null;

    if (targetId) {
      // Usulan EDIT: perbarui produk katalog yang ada (yang masih hidup).
      const upd = await tx<{ id: string }[]>`
        UPDATE public_products SET ${tx({ ...cat, updated_at: ts })}
        WHERE id = ${targetId} AND deleted_at IS NULL
        RETURNING id
      `;
      if (!upd[0]) throw conflict('Produk target sudah tidak ada / terhapus');
      resultId = upd[0].id;
    } else {
      // Usulan BARU: cegah duplikat barcode pada produk hidup.
      const barcode = contrib.barcode as string | null;
      if (barcode) {
        const dup = await tx<{ id: string }[]>`
          SELECT id FROM public_products
          WHERE barcode = ${barcode} AND deleted_at IS NULL LIMIT 1
        `;
        if (dup[0]) throw conflict('Barcode sudah ada di katalog — gunakan usulan EDIT (targetId)');
      }
      resultId = uuid();
      await tx`
        INSERT INTO public_products ${tx({
          id: resultId,
          ...cat,
          verified: true,
          source: 'crowdsource',
          created_at: ts,
          updated_at: ts,
        })}
      `;
    }

    const done = await tx<ContributionRow[]>`
      UPDATE catalog_contributions
      SET status = 'approved', reviewed_by = ${reviewer}, reviewed_at = ${ts},
          result_product_id = ${resultId}, review_note = NULL, updated_at = ${ts}
      WHERE id = ${id}
      RETURNING *
    `;
    return serialize(done[0]!);
  });
}

/** Tolak usulan (opsional catatan). */
export async function reject(id: string, reviewer: string, note?: string): Promise<Record<string, unknown>> {
  const ts = nowMs();
  const updated = await repo.setStatus(id, {
    status: 'rejected',
    review_note: note?.trim() || null,
    reviewed_by: reviewer,
    reviewed_at: ts,
    result_product_id: null,
    updated_at: ts,
  });
  if (!updated) {
    const existing = await repo.findById(id);
    if (!existing) throw notFound('Usulan tidak ditemukan');
    throw conflict('Usulan sudah diproses');
  }
  return serialize(updated);
}

// ── Cursor offset opaque ──────────────────────────────────────────────────────

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
