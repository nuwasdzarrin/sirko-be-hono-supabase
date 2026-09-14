import { sql as defaultSql, type Sql, type DbClient } from '../client.js';

/**
 * CatalogContributionRepository — antrean usulan katalog dari toko (moderasi).
 * BUKAN tenant-scoped untuk baca admin (dashboard lintas-tenant), tetapi baca
 * "usulan saya" difilter business_id di service. Approve/reject menyalin ke
 * public_products di transaksi (menerima DbClient agar bisa dipakai di dalam tx).
 */

export type ContributionRow = Record<string, unknown>;

export class CatalogContributionRepository {
  constructor(private readonly sql: DbClient = defaultSql) {}

  async create(row: Record<string, unknown>): Promise<ContributionRow> {
    const rows = await this.sql<ContributionRow[]>`
      INSERT INTO catalog_contributions ${this.sql(row)} RETURNING *
    `;
    return rows[0]!;
  }

  async findById(id: string): Promise<ContributionRow | undefined> {
    const rows = await this.sql<ContributionRow[]>`
      SELECT * FROM catalog_contributions WHERE id = ${id} LIMIT 1
    `;
    return rows[0];
  }

  /** Usulan satu toko (terbaru dulu). Offset-paginasi. */
  async listByBusiness(businessId: string, limit: number, offset: number): Promise<ContributionRow[]> {
    return this.sql<ContributionRow[]>`
      SELECT * FROM catalog_contributions
      WHERE business_id = ${businessId}
      ORDER BY created_at DESC, id ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  /** Antrean moderasi lintas-tenant (dashboard). status opsional. */
  async listByStatus(status: string | undefined, limit: number, offset: number): Promise<ContributionRow[]> {
    const sf = status === undefined ? this.sql`` : this.sql`WHERE status = ${status}`;
    return this.sql<ContributionRow[]>`
      SELECT c.*, b.name AS business_name
      FROM catalog_contributions c
      LEFT JOIN businesses b ON b.id = c.business_id
      ${sf}
      ORDER BY c.created_at ASC, c.id ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  async countByStatus(status: string | undefined): Promise<number> {
    const sf = status === undefined ? this.sql`` : this.sql`WHERE status = ${status}`;
    const rows = await this.sql<{ c: number }[]>`
      SELECT count(*)::int c FROM catalog_contributions ${sf}
    `;
    return rows[0]?.c ?? 0;
  }

  /** Jumlah per status (untuk badge/tab dashboard). */
  async statusCounts(): Promise<{ pending: number; approved: number; rejected: number }> {
    const rows = await this.sql<{ status: string; c: number }[]>`
      SELECT status, count(*)::int c FROM catalog_contributions GROUP BY status
    `;
    const out = { pending: 0, approved: 0, rejected: 0 };
    for (const r of rows) if (r.status in out) (out as Record<string, number>)[r.status] = r.c;
    return out;
  }

  async setStatus(
    id: string,
    patch: {
      status: string;
      review_note: string | null;
      reviewed_by: string | null;
      reviewed_at: number;
      result_product_id: string | null;
      updated_at: number;
    },
  ): Promise<ContributionRow | undefined> {
    const rows = await this.sql<ContributionRow[]>`
      UPDATE catalog_contributions SET ${this.sql(patch)}
      WHERE id = ${id} AND status = 'pending'
      RETURNING *
    `;
    return rows[0];
  }
}
