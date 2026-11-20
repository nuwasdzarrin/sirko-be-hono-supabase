import { sql as defaultSql, type DbClient } from '../client.js';
import { TenantRepository } from './base.repository.js';

export interface BusinessRow {
  id: string;
  name: string;
  business_type: string | null;
  /** Kode toko per akun (A, B, …) untuk nomor invoice — migrasi 0017. */
  store_code: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * BusinessRepository — pembuatan business (register) bersifat non-tenant karena
 * membuat tenant baru. Pembacaan business memakai TenantRepository (scoped by id
 * yang == businessId dari JWT).
 */
export class BusinessRepository extends TenantRepository {
  /** Baca business milik pengguna (id == businessId dari JWT). */
  async getSelf(): Promise<BusinessRow | undefined> {
    const rows = await this.sql<BusinessRow[]>`
      SELECT id, name, business_type, store_code, created_at, updated_at, deleted_at
      FROM businesses
      WHERE id = ${this.businessId} AND deleted_at IS NULL
      LIMIT 1
    `;
    return rows[0];
  }

  /** Pembuatan tenant baru (register-business). Non-tenant by design. */
  static async create(
    business: {
      id: string;
      name: string;
      businessType: string | null;
      storeCode?: string | null;
      createdAt: number;
      updatedAt: number;
    },
    client: DbClient = defaultSql,
  ): Promise<void> {
    await client`
      INSERT INTO businesses (id, name, business_type, store_code, created_at, updated_at)
      VALUES (${business.id}, ${business.name}, ${business.businessType}, ${business.storeCode ?? 'A'},
              ${business.createdAt}, ${business.updatedAt})
    `;
  }

  /**
   * Kode toko berikutnya untuk akun: huruf pertama yang belum pernah dipakai toko milik akun itu
   * (termasuk toko terhapus, agar nomor invoice lama tetap unik). Panggil di dalam transaksi
   * yang sudah mengunci baris akun (FOR UPDATE).
   */
  static async nextStoreCode(accountId: string, client: DbClient = defaultSql): Promise<string> {
    const rows: { store_code: string | null }[] = await client`
      SELECT DISTINCT b.store_code FROM users u JOIN businesses b ON b.id = u.business_id
      WHERE u.account_id = ${accountId} AND u.role = 'owner'`;
    const used = new Set(rows.map((r) => r.store_code).filter(Boolean));
    for (let n = 1; n <= 26 * 27; n++) {
      const code = storeCodeOf(n);
      if (!used.has(code)) return code;
    }
    throw new Error('Kode toko habis');
  }
}

/** 1 → A, 26 → Z, 27 → AA, 28 → AB, … (sama dengan rumus backfill migrasi 0017). */
export function storeCodeOf(n: number): string {
  const L = (i: number) => String.fromCharCode(65 + i);
  return n <= 26 ? L(n - 1) : L(Math.floor((n - 1) / 26) - 1) + L((n - 1) % 26);
}
