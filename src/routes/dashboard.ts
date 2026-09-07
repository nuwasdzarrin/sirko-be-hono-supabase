import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { env } from '../config/env.ts';
import {
  getOverview,
  getCatalogPage,
  getBusinessesPage,
  getTransactionsPage,
} from '../services/dashboard.service.ts';
import {
  renderOverview,
  renderCatalog,
  renderBusinesses,
  renderTransactions,
} from '../views/dashboard.view.ts';

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

dashboardRoutes.get('/businesses', async (c) => {
  const page = intParam(c.req.query('page'), 1);
  return c.html(renderBusinesses(await getBusinessesPage({ page, limit: 20 })));
});

dashboardRoutes.get('/transactions', async (c) => {
  const page = intParam(c.req.query('page'), 1);
  return c.html(renderTransactions(await getTransactionsPage({ page, limit: 20 })));
});
