import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { requireAuth } from '../middleware/auth.ts';
import { requireTenant } from '../middleware/tenant.ts';
import {
  handleBackupPush,
  handleBackupPull,
  handleBackupStatus,
} from '../handlers/backup.handlers.ts';

/**
 * Rute Backup (Fitur 1) — semua Bearer + tenant (khusus konteks toko).
 * Di-mount pada `/v1/backup`.
 */
export const backupRoutes = new Hono<AppEnv>()
  .use('*', requireAuth, requireTenant)
  .post('/push', handleBackupPush)
  .get('/pull', handleBackupPull)
  .get('/status', handleBackupStatus);
