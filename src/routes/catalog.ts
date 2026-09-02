import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { requireAuth } from '../middleware/auth.ts';
import { requireRole } from '../middleware/rbac.ts';
import {
  handleCatalogLookup,
  handleCatalogSearch,
  handleCatalogCreate,
  handleCatalogUpdate,
  handleCatalogDelete,
} from '../handlers/catalog.handlers.ts';

/**
 * Rute Katalog (Fitur 2) — GLOBAL, di-mount pada `/v1/catalog`.
 * Baca: semua toko terautentikasi. Tulis: HANYA sirko_admin (else 403).
 * BUKAN tenant-scoped (tanpa requireTenant) — sirko_admin ber-businessId null.
 */
export const catalogRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)
  .get('/lookup', handleCatalogLookup)
  .get('/search', handleCatalogSearch)
  .post('/', requireRole('sirko_admin'), handleCatalogCreate)
  .put('/:id', requireRole('sirko_admin'), handleCatalogUpdate)
  .delete('/:id', requireRole('sirko_admin'), handleCatalogDelete);
