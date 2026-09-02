import { sql as defaultSql, type Sql, type DbClient } from '../client.ts';

/**
 * AccountRepository — identitas login cloud (email/phone + password_hash).
 *
 * BUKAN tenant-scoped: akun adalah kredensial global (login memakai email/phone
 * sebelum businessId diketahui). Setelah login, tenancy ditegakkan via JWT.
 */

export interface AccountRow {
  id: string;
  email: string | null;
  phone: string | null;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export class AccountRepository {
  constructor(private readonly sql: Sql = defaultSql) {}

  async existsByEmailOrPhone(email: string | null, phone: string | null): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      SELECT id FROM accounts
      WHERE (${email}::citext IS NOT NULL AND email = ${email}::citext)
         OR (${phone}::text  IS NOT NULL AND phone = ${phone})
      LIMIT 1
    `;
    return rows.length > 0;
  }

  /** Cari akun untuk login. `identifier` cocok ke email (case-insensitive) atau phone. */
  async findByEmailOrPhone(identifier: string): Promise<AccountRow | undefined> {
    const rows = await this.sql<AccountRow[]>`
      SELECT id, email, phone, password_hash, created_at, updated_at
      FROM accounts
      WHERE email = ${identifier}::citext OR phone = ${identifier}
      LIMIT 1
    `;
    return rows[0];
  }

  async create(
    account: {
      id: string;
      email: string | null;
      phone: string | null;
      passwordHash: string;
      createdAt: number;
      updatedAt: number;
    },
    client: DbClient = this.sql,
  ): Promise<void> {
    await client`
      INSERT INTO accounts (id, email, phone, password_hash, created_at, updated_at)
      VALUES (${account.id}, ${account.email}, ${account.phone},
              ${account.passwordHash}, ${account.createdAt}, ${account.updatedAt})
    `;
  }
}
