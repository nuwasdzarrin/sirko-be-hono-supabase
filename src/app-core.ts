import { Hono } from 'hono';
import type { AppEnv } from './types.js';
import { requestLogger } from './middleware/logger.js';
import { errorHandler } from './middleware/error.js';
import { fail } from './lib/envelope.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { healthRoutes } from './routes/health.js';
import { backupRoutes } from './routes/backup.js';
import { catalogRoutes } from './routes/catalog.js';
import { mediaRoutes } from './routes/media.js';
import { dashboardRoutes } from './routes/dashboard.js';

/**
 * Aplikasi Hono inti + middleware global. Modul ini melakukan kerja berat saat
 * load (validasi env, buat koneksi DB via import transitif). Sengaja dipisah dari
 * `app.ts` agar `app.ts` bisa membungkusnya & menampilkan error boot sebagai HTTP.
 *
 * Semua rute API di bawah `/v1` (spec 08 §8).
 */
export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('*', requestLogger);
  app.onError(errorHandler);
  app.notFound((c) => c.json(fail('NOT_FOUND', `Rute tidak ditemukan: ${c.req.path}`), 404));

  const v1 = new Hono<AppEnv>();
  v1.route('/auth', authRoutes);
  v1.route('/backup', backupRoutes);
  v1.route('/catalog', catalogRoutes);
  v1.route('/media', mediaRoutes);
  v1.route('/', meRoutes);
  v1.route('/', healthRoutes);

  app.route('/v1', v1);

  // Halaman admin (HTML) — di luar /v1. `/` diarahkan ke dashboard.
  app.route('/dashboard', dashboardRoutes);
  app.get('/', (c) => c.redirect('/dashboard'));

  return app;
}

export const app = createApp();
export type App = typeof app;
