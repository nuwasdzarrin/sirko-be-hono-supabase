import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types.ts';
import { verifyAccessToken } from '../lib/jwt.ts';
import { effectivePermissions } from '../lib/permissions.ts';
import { unauthenticated } from '../lib/errors.ts';

/**
 * requireAuth — verifikasi JWT sendiri lalu inject {userId, businessId, role,
 * permissions} ke context. `businessId`/`role` SELALU dari token terverifikasi,
 * tak pernah dari body (spec 08 §6.3).
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    throw unauthenticated('Header Authorization Bearer tidak ada');
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) throw unauthenticated('Token kosong');

  const claims = await verifyAccessToken(token);

  // Permission efektif dihitung dari role. Untuk `custom`, daftar detail diambil
  // dari DB saat dibutuhkan; access token hanya membawa role (tetap ramping).
  const permissions = effectivePermissions(claims.role);

  c.set('auth', {
    userId: claims.userId,
    businessId: claims.businessId,
    role: claims.role,
    permissions,
  });

  await next();
});
