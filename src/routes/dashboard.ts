import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { env } from '../config/env.js';
import {
  getOverview,
  getCatalogPage,
  getBusinessesPage,
  getTransactionsPage,
  getContributionsPage,
} from '../services/dashboard.service.js';
import {
  renderOverview,
  renderCatalog,
  renderBusinesses,
  renderTransactions,
  renderContributions,
} from '../views/dashboard.view.js';
import * as contributions from '../services/catalog-contribution.service.js';

/**
 * Dashboard admin (HTML/EJS) di `/dashboard`:
 *  - `/`             ringkasan (KPI + kategori + highlight)
 *  - `/catalog`      katalog berpaginasi + foto + cari
 *  - `/businesses`   daftar toko berpaginasi
 *  - `/transactions` daftar transaksi berpaginasi
 * Digerbang Basic Auth bila DASHBOARD_USER & DASHBOARD_PASSWORD diisi. Baca lintas-tenant.
 */
export const dashboardRoutes = new Hono();

if (env.DASHBOARD_USER && env.DASHBOARD_PASSWORD) {
  dashboardRoutes.use('*', basicAuth({ username: env.DASHBOARD_USER, password: env.DASHBOARD_PASSWORD }));
}

const intParam = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : def;
};

dashboardRoutes.get('/', async (c) => c.html(renderOverview(await getOverview())));

dashboardRoutes.get('/catalog', async (c) => {
  const page = intParam(c.req.query('page'), 1);
  const q = c.req.query('q') ?? '';
  return c.html(renderCatalog(await getCatalogPage({ page, limit: 24, q })));
});

const REVIEWER = env.DASHBOARD_USER || 'admin';
const ALLOWED_STATUS = ['pending', 'approved', 'rejected'] as const;

dashboardRoutes.get('/contributions', async (c) => {
  const page = intParam(c.req.query('page'), 1);
  const s = c.req.query('status');
  const status = (ALLOWED_STATUS as readonly string[]).includes(s ?? '')
    ? (s as (typeof ALLOWED_STATUS)[number])
    : 'pending';
  return c.html(renderContributions(await getContributionsPage({ page, limit: 20, status })));
});

dashboardRoutes.post('/contributions/:id/approve', async (c) => {
  await contributions.approve(c.req.param('id'), REVIEWER);
  return c.redirect('/dashboard/contributions?status=pending');
});

dashboardRoutes.post('/contributions/:id/reject', async (c) => {
  const body = await c.req.parseBody();
  const note = typeof body.note === 'string' ? body.note : undefined;
  await contributions.reject(c.req.param('id'), REVIEWER, note);
  return c.redirect('/dashboard/contributions?status=pending');
});

dashboardRoutes.get('/businesses', async (c) => {
  const page = intParam(c.req.query('page'), 1);
  return c.html(renderBusinesses(await getBusinessesPage({ page, limit: 20 })));
});

dashboardRoutes.get('/transactions', async (c) => {
  const page = intParam(c.req.query('page'), 1);
  return c.html(renderTransactions(await getTransactionsPage({ page, limit: 20 })));
});
