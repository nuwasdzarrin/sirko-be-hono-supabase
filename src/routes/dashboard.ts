import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { env } from '../config/env.ts';
import { getDashboardData } from '../services/dashboard.service.ts';
import { renderDashboard } from '../views/dashboard.view.ts';

/**
 * Halaman dashboard admin (HTML/EJS) — di-mount pada `/dashboard`.
 * Digerbang Basic Auth bila DASHBOARD_USER & DASHBOARD_PASSWORD diisi;
 * bila kosong (dev) → terbuka. Data lintas-tenant (mode admin).
 */
export const dashboardRoutes = new Hono();

if (env.DASHBOARD_USER && env.DASHBOARD_PASSWORD) {
  dashboardRoutes.use(
    '*',
    basicAuth({ username: env.DASHBOARD_USER, password: env.DASHBOARD_PASSWORD }),
  );
}

dashboardRoutes.get('/', async (c) => {
  const data = await getDashboardData();
  return c.html(renderDashboard(data));
});
