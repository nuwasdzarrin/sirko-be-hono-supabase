import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { requireAuth } from '../middleware/auth.ts';
import { handleSignUpload } from '../handlers/media.handlers.ts';

/**
 * Rute Media (Fitur 2) — di-mount pada `/v1/media`. Bearer (semua toko).
 * scope `catalog` khusus sirko_admin (dijaga di service).
 */
export const mediaRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)
  .post('/sign-upload', handleSignUpload);
