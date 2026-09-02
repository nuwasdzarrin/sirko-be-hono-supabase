import { Hono } from 'hono';
import type { AppEnv } from './types.ts';
import { requestLogger } from './middleware/logger.ts';
import { errorHandler } from './middleware/error.ts';
import { fail } from './lib/envelope.ts';
import { authRoutes } from './routes/auth.ts';
import { meRoutes } from './routes/me.ts';
import { healthRoutes } from './routes/health.ts';
import { backupRoutes } from './routes/backup.ts';
import { catalogRoutes } from './routes/catalog.ts';
import { mediaRoutes } from './routes/media.ts';

/**
 * Inisialisasi Hono + middleware global. Diekspor untuk dipakai entrypoint
 * Vercel (`api/[[...route]].ts`) maupun dev-server lokal.
 *
 * Semua rute berada di bawah `/v1` (spec 08 §8). Import sengaja diminimalkan
 * demi cold-start (spec 08 §4.3).
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

  return app;
}

export const app = createApp();
export type App = typeof app;
