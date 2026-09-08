import { sql as defaultSql, type Sql } from '../client.js';

/**
 * CatalogRepository — akses `public_products` (tabel GLOBAL, spec 08 §9).
 * BUKAN tenant-scoped: dibaca semua toko, ditulis hanya sirko_admin (dijaga di
 * lapisan route/middleware). TANPA business_id, TANPA harga/stok.
 */

export type CatalogRow = Record<string, unknown>;

export class CatalogRepository {
  constructor(private readonly sql: Sql = defaultSql) {}

  /** Lookup barcode untuk auto-fill scan — hanya produk hidup. */
  async findByBarcode(barcode: string): Promise<CatalogRow | undefined> {
    const rows = await this.sql<CatalogRow[]>`
      SELECT * FROM public_products
      WHERE barcode = ${barcode} AND deleted_at IS NULL
      LIMIT 1
    `;
    return rows[0];
  }

  async findById(id: string): Promise<CatalogRow | undefined> {
    const rows = await this.sql<CatalogRow[]>`
      SELECT * FROM public_products WHERE id = ${id} AND deleted_at IS NULL LIMIT 1
    `;
    return rows[0];
  }

  /**
   * Pencarian relevansi: substring (ILIKE) + trigram similarity (%) pada
   * name/brand + kecocokan keyword. Urut skor similarity desc. Offset-paginasi.
   */
  async search(q: string, limit: number, offset: number): Promise<CatalogRow[]> {
    const like = `%${q}%`;
    return this.sql<CatalogRow[]>`
      SELECT *,
             GREATEST(similarity(coalesce(name, ''), ${q}),
                      similarity(coalesce(brand, ''), ${q})) AS _score
      FROM public_products
      WHERE deleted_at IS NULL
        AND (
          name ILIKE ${like} OR brand ILIKE ${like}
          OR coalesce(name, '') % ${q} OR coalesce(brand, '') % ${q}
          OR EXISTS (SELECT 1 FROM unnest(keywords) k WHERE k ILIKE ${like})
        )
      ORDER BY _score DESC, name ASC, id ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  async create(dbRow: Record<string, unknown>): Promise<CatalogRow> {
    const rows = await this.sql<CatalogRow[]>`
      INSERT INTO public_products ${this.sql(dbRow)} RETURNING *
    `;
    return rows[0]!;
  }

  /** Update sebagian; hanya produk hidup. undefined bila tak ada/ sudah terhapus. */
  async update(id: string, dbPatch: Record<string, unknown>): Promise<CatalogRow | undefined> {
    const rows = await this.sql<CatalogRow[]>`
      UPDATE public_products SET ${this.sql(dbPatch)}
      WHERE id = ${id} AND deleted_at IS NULL
      RETURNING *
    `;
    return rows[0];
  }

  /** Soft delete. True bila baris hidup ditemukan & ditandai terhapus. */
  async softDelete(id: string, deletedAt: number): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE public_products SET deleted_at = ${deletedAt}, updated_at = ${deletedAt}
      WHERE id = ${id} AND deleted_at IS NULL
      RETURNING id
    `;
    return rows.length > 0;
  }

  /** True bila barcode sudah dipakai produk hidup lain (untuk cegah duplikat). */
  async barcodeTakenByOther(barcode: string, exceptId: string | null): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      SELECT id FROM public_products
      WHERE barcode = ${barcode} AND deleted_at IS NULL
        AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
      LIMIT 1
    `;
    return rows.length > 0;
  }
}
