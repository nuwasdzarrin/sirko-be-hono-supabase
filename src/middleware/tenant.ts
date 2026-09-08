import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types.js';
import { forbidden, unauthenticated } from '../lib/errors.js';

/**
 * requireTenant — pastikan request terikat ke sebuah toko (businessId ada).
 * Dipasang di endpoint milik-toko (backup/sync nanti). sirko_admin (businessId
 * null) DITOLAK di jalur tenant — ia hanya berurusan dengan tabel global.
 *
 * Guard ini adalah lapisan kedua; penegakan sesungguhnya ada di repository yang
 * memaksa `WHERE business_id`.
 */
export const requireTenant = createMiddleware<AppEnv>(async (c, next) => {
  const auth = c.get('auth');
  if (!auth) throw unauthenticated();
  if (!auth.businessId) {
    throw forbidden('Endpoint ini khusus konteks toko (businessId tidak ada di token)');
  }
  await next();
});
