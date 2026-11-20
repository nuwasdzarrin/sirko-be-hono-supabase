import { Hono, type Context, type Next } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import type { AppEnv } from '../types.js';

/**
 * Sirko web app (SPA SolidJS + Dexie, offline-first) di `/app`. Kode: `web-app/`, hasil build:
 * `public/app` (dibangun scripts/update.sh). Data toko di IndexedDB browser, sinkron lewat
 * `/v1/backup/*` — sama dengan aplikasi HP.
 *
 * - `/app/assets/*` : file ber-hash → cache 1 tahun (immutable).
 * - `/app/sw.js`, manifest, ikon : tanpa cache panjang (service worker wajib selalu terbaru).
 * - Path lain (`/app/kasir`, …) : index.html (routing di browser).
 */

const ROOT = 'public';
const INDEX = `${ROOT}/app/index.html`;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

async function securityHeaders(c: Context<AppEnv>, next: Next) {
  await next();
  c.header('Content-Security-Policy', CSP);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Robots-Tag', 'noindex');
  // Kamera untuk scan barcode (Fase 2) — hanya situs ini.
  c.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
}

function indexHtml(c: Context<AppEnv>) {
  if (!existsSync(INDEX)) {
    return c.text('Sirko web app belum dibangun di server ini (npm --prefix web-app run build).', 503);
  }
  c.header('Cache-Control', 'no-cache');
  return c.html(readFileSync(INDEX, 'utf8'));
}

export const webAppRoutes = new Hono<AppEnv>();

webAppRoutes.use('*', securityHeaders);
// `/app` & `/app/` sama-sama beranda (router browser memakai `/app` untuk beranda).
webAppRoutes.get('/', indexHtml);
webAppRoutes.use(
  '/assets/*',
  async (c, next) => {
    await next();
    if (c.res.status === 200) c.header('Cache-Control', 'public, max-age=31536000, immutable');
  },
  serveStatic({ root: ROOT }),
);
webAppRoutes.use(
  '/:file{(sw\\.js|manifest\\.webmanifest|icon\\.svg|assets\\.json)}',
  async (c, next) => {
    await next();
    if (c.res.status === 200) {
      c.header('Cache-Control', 'no-cache');
      // sw.js ada di /app/ tetapi mengatur /app (beranda) juga.
      if (c.req.path.endsWith('/sw.js')) c.header('Service-Worker-Allowed', '/app');
    }
  },
  serveStatic({ root: ROOT }),
);
webAppRoutes.get('/assets/*', (c) => c.notFound());
webAppRoutes.get('*', indexHtml);
