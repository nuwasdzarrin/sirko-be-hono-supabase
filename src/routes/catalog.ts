import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  handleCatalogLookup,
  handleCatalogSearch,
  handleCatalogCreate,
  handleCatalogUpdate,
  handleCatalogDelete,
  handleContributionSubmit,
  handleContributionListMine,
} from '../handlers/catalog.handlers.js';

/**
 * Rute Katalog (Fitur 2) — GLOBAL, di-mount pada `/v1/catalog`.
 * Baca: semua toko terautentikasi. Tulis langsung (`POST /`, `PUT/DELETE /:id`):
 * HANYA sirko_admin. Kontribusi (`/contributions`): semua akun toko (moderasi).
 * BUKAN tenant-scoped (tanpa requireTenant) — sirko_admin ber-businessId null.
 */
export const catalogRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)
  .get('/lookup', handleCatalogLookup)
  .get('/search', handleCatalogSearch)
  // Kontribusi toko biasa (rute statis → didaftarkan sebelum `/:id`).
  .post('/contributions', handleContributionSubmit)
  .get('/contributions', handleContributionListMine)
  // Tulis langsung katalog (admin).
  .post('/', requireRole('sirko_admin'), handleCatalogCreate)
  .put('/:id', requireRole('sirko_admin'), handleCatalogUpdate)
  .delete('/:id', requireRole('sirko_admin'), handleCatalogDelete);
