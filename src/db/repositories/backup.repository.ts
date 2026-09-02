import { TenantRepository } from './base.repository.ts';
import { BACKUP_TABLES, type BackupTable, type Col } from '../backup-tables.ts';

/**
 * BackupRepository — mesin backup generik, TenantRepository (paksa business_id).
 *
 * Tenancy berlapis:
 *  - Semua query menyaring `business_id = :jwt` (business: `id = :jwt`).
 *  - UPSERT LWW di-guard `AND table.business_id = :jwt` → tabrakan id lintas-tenant
 *    (UUID) tak bisa menimpa data toko lain.
 *
 * Nama tabel/kolom berasal dari registry (konstanta tepercaya) → aman di-inline;
 * SEMUA nilai baris tetap lewat parameter ($n).
 */

const q = (ident: string) => `"${ident}"`;

/** Deskriptor kolom fisik (urutan insert). */
interface PhysCol {
  db: string;
  wire: string | null; // null untuk kolom standar (id/business_id/created_at/...)
  type: Col['type'] | 'std';
}

function physicalColumns(table: BackupTable): PhysCol[] {
  return [
    { db: 'id', wire: 'id', type: 'std' },
    { db: 'business_id', wire: null, type: 'std' },
    ...table.cols.map((c) => ({ db: c.db, wire: c.wire, type: c.type })),
    { db: 'created_at', wire: 'createdAt', type: 'std' },
    { db: 'updated_at', wire: 'updatedAt', type: 'std' },
    { db: 'deleted_at', wire: 'deletedAt', type: 'std' },
  ];
}

/** Nilai default untuk kolom NOT NULL di tabel legacy (0001) agar insert tak gagal. */
const ROW_DEFAULTS: Record<string, Record<string, unknown>> = {
  users: { name: 'Pengguna', role: 'staff', is_active: true, permissions: [] },
};

export interface UpsertResult {
  appliedIds: Set<string>;
}

export class BackupRepository extends TenantRepository {
  /**
   * Bangun nilai satu baris (urut kolom fisik) + placeholder. json → ::jsonb.
   * `params`/`placeholders` diisi in-place; `paramIdx` dikembalikan.
   */
  private buildRow(
    table: BackupTable,
    row: Record<string, unknown>,
    physCols: PhysCol[],
    params: unknown[],
    startIdx: number,
  ): { placeholder: string; nextIdx: number } {
    const defaults = ROW_DEFAULTS[table.db] ?? {};
    const parts: string[] = [];
    let idx = startIdx;
    for (const c of physCols) {
      let val: unknown;
      if (c.db === 'business_id') {
        val = this.businessId; // DIPAKSA dari JWT (abaikan body)
      } else if (c.db === 'created_at') {
        val = row.createdAt ?? row.updatedAt ?? null;
      } else if (c.db === 'updated_at') {
        val = row.updatedAt ?? null;
      } else if (c.db === 'deleted_at') {
        val = row.deletedAt ?? null;
      } else if (c.db === 'id') {
        val = row.id;
      } else {
        val = row[c.wire as string];
        if (val === undefined || val === null) {
          val = defaults[c.db] ?? null;
        }
      }

      if (c.type === 'json') {
        params.push(JSON.stringify(val ?? []));
        parts.push(`$${idx++}::jsonb`);
      } else {
        params.push(val ?? null);
        parts.push(`$${idx++}`);
      }
    }
    return { placeholder: `(${parts.join(',')})`, nextIdx: idx };
  }

  /** UPSERT LWW batch (mutable). Kembalikan id yang benar-benar diterapkan. */
  async upsertLww(table: BackupTable, rows: Record<string, unknown>[]): Promise<UpsertResult> {
    if (rows.length === 0) return { appliedIds: new Set() };
    const physCols = physicalColumns(table);
    const colList = physCols.map((c) => q(c.db)).join(',');

    const params: unknown[] = [];
    const groups: string[] = [];
    let idx = 1;
    for (const row of rows) {
      const built = this.buildRow(table, row, physCols, params, idx);
      groups.push(built.placeholder);
      idx = built.nextIdx;
    }

    // SET: semua kolom kecuali id & business_id ← excluded; + server_updated_at=now().
    const setCols = physCols.filter((c) => c.db !== 'id' && c.db !== 'business_id');
    const setList =
      setCols.map((c) => `${q(c.db)} = excluded.${q(c.db)}`).join(', ') +
      ', server_updated_at = now()';

    const bidIdx = idx; // param bisnis untuk guard WHERE
    params.push(this.businessId);

    const text = `
      INSERT INTO ${q(table.db)} (${colList})
      VALUES ${groups.join(',')}
      ON CONFLICT (id) DO UPDATE SET ${setList}
      WHERE ${q(table.db)}.business_id = $${bidIdx}
        AND excluded.updated_at > ${q(table.db)}.updated_at
      RETURNING id
    `;
    const applied = await this.sql.unsafe<{ id: string }[]>(text, params as never[]);
    return { appliedIds: new Set(applied.map((r) => r.id)) };
  }

  /** INSERT append-only (immutable). DO NOTHING → idempotent murni. */
  async insertAppend(table: BackupTable, rows: Record<string, unknown>[]): Promise<UpsertResult> {
    if (rows.length === 0) return { appliedIds: new Set() };
    const physCols = physicalColumns(table);
    const colList = physCols.map((c) => q(c.db)).join(',');

    const params: unknown[] = [];
    const groups: string[] = [];
    let idx = 1;
    for (const row of rows) {
      const built = this.buildRow(table, row, physCols, params, idx);
      groups.push(built.placeholder);
      idx = built.nextIdx;
    }

    const text = `
      INSERT INTO ${q(table.db)} (${colList})
      VALUES ${groups.join(',')}
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    const inserted = await this.sql.unsafe<{ id: string }[]>(text, params as never[]);
    return { appliedIds: new Set(inserted.map((r) => r.id)) };
  }

  /**
   * Singleton `business`: UPDATE baris tenant (id = JWT), hanya kolom yang HADIR
   * (partial), LWW. id/businessId dari body diabaikan. True bila diterapkan.
   */
  async updateSingletonBusiness(row: Record<string, unknown>): Promise<boolean> {
    const table = BACKUP_TABLES.find((t) => t.wire === 'business')!;
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    for (const c of table.cols) {
      if (row[c.wire] !== undefined) {
        sets.push(`${q(c.db)} = $${idx++}`);
        params.push(row[c.wire] ?? null);
      }
    }
    sets.push(`updated_at = $${idx++}`);
    params.push(row.updatedAt ?? null);
    if (row.deletedAt !== undefined) {
      sets.push(`deleted_at = $${idx++}`);
      params.push(row.deletedAt ?? null);
    }
    sets.push('server_updated_at = now()');

    const bidIdx = idx++;
    params.push(this.businessId);
    const updIdx = idx++;
    params.push(row.updatedAt ?? 0);

    const text = `
      UPDATE businesses SET ${sets.join(', ')}
      WHERE id = $${bidIdx} AND $${updIdx} > businesses.updated_at
      RETURNING id
    `;
    const res = await this.sql.unsafe<{ id: string }[]>(text, params as never[]);
    return res.length > 0;
  }

  /**
   * Pull keyset satu tabel: baris `(server_updated_at, id) > (posTs, posId)`,
   * urut naik, `limit`. Hanya milik business (business: id = JWT). Termasuk tombstone.
   * Kembalikan baris DB mentah + kolom bantu `ssu_ms` (epoch ms) & `ssu_text` (ISO cursor).
   */
  async pullTable(
    table: BackupTable,
    posTs: string,
    posId: string,
    limit: number,
  ): Promise<Record<string, unknown>[]> {
    const tenantFilter = table.kind === 'singleton' ? 'id' : 'business_id';
    // Keyset via MIKRODETIK integer (server_updated_at::text tak round-trip akurat).
    const text = `
      SELECT ${q(table.db)}.*,
             (extract(epoch from server_updated_at) * 1000)::bigint AS ssu_ms,
             (extract(epoch from server_updated_at) * 1000000)::bigint AS ssu_us
      FROM ${q(table.db)}
      WHERE ${q(tenantFilter)} = $1
        AND ((extract(epoch from server_updated_at) * 1000000)::bigint, id) > ($2::bigint, $3::uuid)
      ORDER BY server_updated_at, id
      LIMIT $4
    `;
    return this.sql.unsafe<Record<string, unknown>[]>(text, [
      this.businessId,
      posTs,
      posId,
      limit,
    ] as never[]);
  }

  /** Ringkasan status: count baris hidup per tabel + waktu backup terakhir (epoch ms). */
  async statusSummary(): Promise<{ counts: Record<string, number>; lastBackupAt: number | null }> {
    const selects = BACKUP_TABLES.map((t) => {
      const tenantFilter = t.kind === 'singleton' ? 'id' : 'business_id';
      return `SELECT '${t.wire}' AS wire,
                     count(*) FILTER (WHERE deleted_at IS NULL) AS n,
                     (extract(epoch from max(server_updated_at)) * 1000)::bigint AS last_ms
              FROM ${q(t.db)} WHERE ${q(tenantFilter)} = $1`;
    });
    const text = selects.join('\nUNION ALL\n');
    const rows = await this.sql.unsafe<{ wire: string; n: string; last_ms: string | null }[]>(
      text,
      [this.businessId] as never[],
    );

    const counts: Record<string, number> = {};
    let lastBackupAt: number | null = null;
    for (const r of rows) {
      counts[r.wire] = Number(r.n);
      if (r.last_ms != null) {
        const ms = Number(r.last_ms);
        if (lastBackupAt === null || ms > lastBackupAt) lastBackupAt = ms;
      }
    }
    return { counts, lastBackupAt };
  }

  // ── Idempotency-Key (opsional) ───────────────────────────────────────────────

  async findIdempotent(key: string): Promise<unknown | undefined> {
    const rows = await this.sql<{ response: unknown }[]>`
      SELECT response FROM backup_idempotency
      WHERE business_id = ${this.businessId} AND key = ${key}
      LIMIT 1
    `;
    return rows[0]?.response;
  }

  async saveIdempotent(key: string, response: unknown, createdAt: number): Promise<void> {
    await this.sql`
      INSERT INTO backup_idempotency (business_id, key, response, created_at)
      VALUES (${this.businessId}, ${key}, ${this.sql.json(response as never)}, ${createdAt})
      ON CONFLICT (business_id, key) DO NOTHING
    `;
  }
}
