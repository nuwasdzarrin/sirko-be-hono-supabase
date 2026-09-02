import { createMiddleware } from 'hono/factory';
import { randomUUID } from 'node:crypto';
import type { AppEnv } from '../types.ts';

/**
 * requestLogger — beri tiap request `requestId`, catat metode/path/status/durasi.
 * Ringan (structured log ke stdout) — cocok untuk Vercel logs.
 */
export const requestLogger = createMiddleware<AppEnv>(async (c, next) => {
  const requestId = c.req.header('x-request-id') ?? randomUUID();
  c.set('requestId', requestId);
  c.header('x-request-id', requestId);

  const start = performance.now();
  await next();
  const ms = Math.round(performance.now() - start);

  console.log(
    JSON.stringify({
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms,
    }),
  );
});
