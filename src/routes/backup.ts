import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenant.js';
import {
  handleBackupPush,
  handleBackupPull,
  handleBackupStatus,
} from '../handlers/backup.handlers.js';

/**
 * Rute Backup (Fitur 1) — semua Bearer + tenant (khusus konteks toko).
 * Di-mount pada `/v1/backup`.
 */
export const backupRoutes = new Hono<AppEnv>()
  .use('*', requireAuth, requireTenant)
  .post('/push', handleBackupPush)
  .get('/pull', handleBackupPull)
  .get('/status', handleBackupStatus);
