import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { AppError } from '../lib/errors.ts';
import { fail } from '../lib/envelope.ts';
import { env } from '../config/env.ts';

/**
 * Error handler global (dipasang via app.onError). Memetakan semua error ke
 * envelope `{ error: { code, message, details } }` (spec 10 §0) dengan HTTP tepat.
 *
 * - AppError    → kode & status apa adanya.
 * - ZodError    → 422 VALIDATION + details field bermasalah.
 * - HTTPException→ pertahankan status Hono.
 * - lainnya     → 500 INTERNAL (detail disembunyikan di production).
 */
export function errorHandler(err: unknown, c: Context) {
  if (err instanceof AppError) {
    return c.json(fail(err.code, err.message, err.details), err.status as ContentfulStatusCode);
  }

  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return c.json(fail('VALIDATION', 'Validasi gagal', details), 422);
  }

  if (err instanceof HTTPException) {
    return c.json(
      fail('INTERNAL', err.message || 'Kesalahan permintaan'),
      err.status as ContentfulStatusCode,
    );
  }

  // Tak terduga → 500. Log lengkap di server, sembunyikan detail dari klien produksi.
  const requestId = c.get('requestId');
  console.error(`[${requestId ?? '-'}] Unhandled error:`, err);
  const message =
    env.APP_ENV === 'production'
      ? 'Terjadi kesalahan server'
      : err instanceof Error
        ? err.message
        : String(err);
  return c.json(fail('INTERNAL', message), 500);
}
