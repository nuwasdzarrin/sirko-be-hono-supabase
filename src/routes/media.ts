import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { handleDirectUpload, handleSignUpload } from '../handlers/media.handlers.js';

/**
 * Rute Media (Fitur 2) — di-mount pada `/v1/media`. Bearer (semua toko).
 * scope `catalog` khusus sirko_admin (dijaga di service).
 */
export const mediaRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)
  .post('/sign-upload', handleSignUpload)
  // Web app (browser): unggah lewat server — CSP & CORS mencegah PUT langsung ke bucket.
  .post('/upload', handleDirectUpload);
