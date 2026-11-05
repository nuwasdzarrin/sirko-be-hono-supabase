import { sql as defaultSql, type Sql, type DbClient } from '../client.js';
import { TenantRepository } from './base.repository.js';
import type { Role } from '../../lib/permissions.js';

export interface UserRow {
  id: string;
  business_id: string | null;
  account_id: string | null;
  name: string;
  username: string | null;
  role: Role;
  permissions: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * UserRepository — pembacaan user milik-toko WAJIB tersaring `business_id`
 * (via TenantRepository.scope).
 *
 * Pengecualian AUTH-BOOTSTRAP (metode statik di bawah): login/refresh perlu
 * memetakan account_id/user_id → businessId SEBELUM tenancy diketahui. Ini
 * satu-satunya jalur non-tenant, dipakai KHUSUS oleh auth service.
 */
export class UserRepository extends TenantRepository {
  /** Baca user milik toko ini (dipakai /v1/me). */
  async getById(userId: string): Promise<UserRow | undefined> {
    const rows = await this.sql<UserRow[]>`
      SELECT id, business_id, account_id, name, username, role, permissions,
             is_active, created_at, updated_at, deleted_at
      FROM users
      WHERE ${this.scope} AND id = ${userId} AND deleted_at IS NULL
      LIMIT 1
    `;
    return rows[0];
  }

  static async create(
    user: {
      id: string;
      businessId: string | null;
      accountId: string | null;
      name: string;
      username: string | null;
      role: Role;
      permissions: string[];
      createdAt: number;
      updatedAt: number;
    },
    client: DbClient = defaultSql,
  ): Promise<void> {
    await client`
      INSERT INTO users (id, business_id, account_id, name, username, role, permissions,
                         is_active, created_at, updated_at)
      VALUES (${user.id}, ${user.businessId}, ${user.accountId}, ${user.name},
              ${user.username}, ${user.role}, ${JSON.stringify(user.permissions)}::jsonb,
              true, ${user.createdAt}, ${user.updatedAt})
    `;
  }

  // ── AUTH-BOOTSTRAP (non-tenant; hanya auth service) ──────────────────────────

  /** Login: petakan account_id → user (membawa business_id & role). */
  static async findByAccountIdForAuth(
    accountId: string,
    client: Sql = defaultSql,
  ): Promise<UserRow | undefined> {
    const rows = await client<UserRow[]>`
      SELECT id, business_id, account_id, name, username, role, permissions,
             is_active, created_at, updated_at, deleted_at
      FROM users
      WHERE account_id = ${accountId} AND deleted_at IS NULL
      LIMIT 1
    `;
    return rows[0];
  }

  /**
   * Keanggotaan aktif akun (Juragan K3): baris users per toko + nama toko,
   * urut nama toko. Toko terhapus & user nonaktif tak ikut.
   */
  static async listMembershipsForAuth(
    accountId: string,
    client: Sql = defaultSql,
  ): Promise<Array<UserRow & { business_name: string }>> {
    return client<Array<UserRow & { business_name: string }>>`
      SELECT u.id, u.business_id, u.account_id, u.name, u.username, u.role, u.permissions,
             u.is_active, u.created_at, u.updated_at, u.deleted_at, b.name AS business_name
      FROM users u JOIN businesses b ON b.id = u.business_id
      WHERE u.account_id = ${accountId} AND u.deleted_at IS NULL AND u.is_active
        AND b.deleted_at IS NULL
      ORDER BY b.name, b.id
    `;
  }

  /** Satu keanggotaan (akun, toko) — null bila bukan anggota aktif. */
  static async findMembershipForAuth(
    accountId: string,
    businessId: string,
    client: Sql = defaultSql,
  ): Promise<UserRow | undefined> {
    const rows = await client<UserRow[]>`
      SELECT u.id, u.business_id, u.account_id, u.name, u.username, u.role, u.permissions,
             u.is_active, u.created_at, u.updated_at, u.deleted_at
      FROM users u JOIN businesses b ON b.id = u.business_id
      WHERE u.account_id = ${accountId} AND u.business_id = ${businessId}
        AND u.deleted_at IS NULL AND u.is_active AND b.deleted_at IS NULL
      LIMIT 1
    `;
    return rows[0];
  }

  /**
   * Toko UTAMA akun = toko pertama yang ia miliki (owner, terlama). Paket warung
   * hanya boleh membuka toko ini (JURAGAN.md §3.3 switch-business, J7).
   */
  static async primaryBusinessIdOfAccount(accountId: string, client: Sql = defaultSql): Promise<string | null> {
    const rows = await client<{ business_id: string }[]>`
      SELECT u.business_id FROM users u JOIN businesses b ON b.id = u.business_id
      WHERE u.account_id = ${accountId} AND u.role = 'owner' AND u.deleted_at IS NULL
        AND b.deleted_at IS NULL
      ORDER BY u.created_at, u.business_id
      LIMIT 1
    `;
    return rows[0]?.business_id ?? null;
  }

  /** Jumlah toko (hidup) yang DIMILIKI akun (role owner) — untuk kuota maxStores. */
  static async countOwnedBusinesses(accountId: string, client: DbClient = defaultSql): Promise<number> {
    const rows: { c: number }[] = await client`
      SELECT count(*)::int c FROM users u JOIN businesses b ON b.id = u.business_id
      WHERE u.account_id = ${accountId} AND u.role = 'owner' AND u.deleted_at IS NULL
        AND b.deleted_at IS NULL
    `;
    return rows[0]?.c ?? 0;
  }

  /** Refresh: petakan user_id → user untuk menerbitkan access token baru. */
  static async findByIdForAuth(
    userId: string,
    client: Sql = defaultSql,
  ): Promise<UserRow | undefined> {
    const rows = await client<UserRow[]>`
      SELECT id, business_id, account_id, name, username, role, permissions,
             is_active, created_at, updated_at, deleted_at
      FROM users
      WHERE id = ${userId} AND deleted_at IS NULL
      LIMIT 1
    `;
    return rows[0];
  }
}
