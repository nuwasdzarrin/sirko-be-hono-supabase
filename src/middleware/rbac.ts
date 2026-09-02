import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types.ts';
import { hasPermission, type Permission, type Role } from '../lib/permissions.ts';
import { forbidden, unauthenticated } from '../lib/errors.ts';

/**
 * requirePermission('X') — jaga endpoint dengan permission tertentu.
 * WAJIB dipasang SETELAH requireAuth (butuh context `auth`).
 */
export function requirePermission(permission: Permission) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const auth = c.get('auth');
    if (!auth) throw unauthenticated();
    if (!hasPermission(auth.permissions, permission)) {
      throw forbidden(`Butuh permission: ${permission}`);
    }
    await next();
  });
}

/**
 * requireRole(...roles) — jaga endpoint untuk peran tertentu (mis. `sirko_admin`
 * untuk tulis katalog di Fitur 2).
 */
export function requireRole(...roles: Role[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const auth = c.get('auth');
    if (!auth) throw unauthenticated();
    if (!roles.includes(auth.role)) {
      throw forbidden(`Butuh peran: ${roles.join(' / ')}`);
    }
    await next();
  });
}
