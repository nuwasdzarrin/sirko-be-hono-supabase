import { sql as defaultSql, type DbClient } from '../client.ts';
import { TenantRepository } from './base.repository.ts';

export interface BusinessRow {
  id: string;
  name: string;
  business_type: string | null;
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
      SELECT id, name, business_type, created_at, updated_at, deleted_at
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
      createdAt: number;
      updatedAt: number;
    },
    client: DbClient = defaultSql,
  ): Promise<void> {
    await client`
      INSERT INTO businesses (id, name, business_type, created_at, updated_at)
      VALUES (${business.id}, ${business.name}, ${business.businessType},
              ${business.createdAt}, ${business.updatedAt})
    `;
  }
}
