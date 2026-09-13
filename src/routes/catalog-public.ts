import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { env } from '../config/env.js';
import { ok } from '../lib/envelope.js';
import { getCatalogPage } from '../services/dashboard.service.js';
import { parseVerified } from '../services/catalog.service.js';

/**
 * `GET /v1/catalog.json?q=&page=&limit=` — versi JSON katalog yang mudah dibuka
 * di BROWSER (digerbang Basic Auth yang sama dengan dashboard, BUKAN Bearer JWT).
 * Untuk admin/inspeksi cepat. Paginasi berbasis halaman (page/pages/total).
 * Bila DASHBOARD_USER/PASSWORD tak diset → terbuka (dev).
 */
export const catalogPublicRoutes = new Hono();

if (env.DASHBOARD_USER && env.DASHBOARD_PASSWORD) {
  catalogPublicRoutes.use('/catalog.json', basicAuth({ username: env.DASHBOARD_USER, password: env.DASHBOARD_PASSWORD }));
}

const intParam = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : def;
};

catalogPublicRoutes.get('/catalog.json', async (c) => {
  const page = intParam(c.req.query('page'), 1);
  const limit = Math.min(intParam(c.req.query('limit'), 50), 200);
  const q = c.req.query('q') ?? '';
  const verified = parseVerified(c.req.query('verified'));
  const pg = await getCatalogPage({ page, limit, q, verified });
  return c.json(
    ok(pg.items, { total: pg.total, page: pg.page, pages: pg.pages, limit: pg.limit, q: pg.q }),
  );
});
