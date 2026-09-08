import { sql as defaultSql, type Sql, type DbClient } from '../client.js';

/**
 * RefreshTokenRepository — mencatat `jti` refresh token untuk rotasi & revoke.
 * Non-tenant (kunci = jti/user_id); dipakai auth service saja.
 */
export class RefreshTokenRepository {
  constructor(private readonly sql: Sql = defaultSql) {}

  async create(
    token: { jti: string; userId: string; expiresAt: number; createdAt: number },
    client: DbClient = this.sql,
  ): Promise<void> {
    await client`
      INSERT INTO refresh_tokens (jti, user_id, expires_at, revoked, created_at)
      VALUES (${token.jti}, ${token.userId}, ${token.expiresAt}, false, ${token.createdAt})
    `;
  }

  /** True bila jti aktif (ada, milik user, belum revoked, belum kedaluwarsa). */
  async isActive(jti: string, userId: string, nowMs: number): Promise<boolean> {
    const rows = await this.sql<{ jti: string }[]>`
      SELECT jti FROM refresh_tokens
      WHERE jti = ${jti} AND user_id = ${userId}
        AND revoked = false AND expires_at > ${nowMs}
      LIMIT 1
    `;
    return rows.length > 0;
  }

  /** Revoke satu jti (rotasi: token lama dicabut saat menerbitkan yang baru). */
  async revoke(jti: string, client: DbClient = this.sql): Promise<void> {
    await client`UPDATE refresh_tokens SET revoked = true WHERE jti = ${jti}`;
  }
}
