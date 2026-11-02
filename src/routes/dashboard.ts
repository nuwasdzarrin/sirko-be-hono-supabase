import { Hono } from 'hono';
import {
  checkCredentials,
  dashboardAuthEnabled,
  endSession,
  safeNext,
  sessionUser,
  startSession,
} from '../lib/dashboard-session.js';
import { parseVerified } from '../services/catalog.service.js';
import {
  getOverview,
  getCatalogPage,
  parseSource,
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
  renderLogin,
} from '../views/dashboard.view.js';
import * as contributions from '../services/catalog-contribution.service.js';

/**
 * Dashboard admin (HTML/EJS) di `/dashboard`:
 *  - `/`             ringkasan (KPI + kategori + highlight)
 *  - `/catalog`      katalog berpaginasi + foto + cari
 *  - `/businesses`   daftar toko berpaginasi
 *  - `/transactions` daftar transaksi berpaginasi
 *  - `/login`        halaman login (sesi cookie) · `POST /logout`
 * Digerbang login bila DASHBOARD_USER & DASHBOARD_PASSWORD diisi. Baca lintas-tenant.
 */
type DashEnv = { Variables: { admin: string } };
export const dashboardRoutes = new Hono<DashEnv>();

dashboardRoutes.get('/login', async (c) => {
  const next = safeNext(c.req.query('next'));
  if (!dashboardAuthEnabled || (await sessionUser(c))) return c.redirect(next);
  return c.html(renderLogin({ next, error: null, user: '' }));
});

dashboardRoutes.post('/login', async (c) => {
  const body = await c.req.parseBody();
  const user = typeof body.user === 'string' ? body.user.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const next = safeNext(typeof body.next === 'string' ? body.next : undefined);
  if (!checkCredentials(user, password)) {
    // Perlambat tebakan beruntun (murah, tanpa state).
    await new Promise((r) => setTimeout(r, 600));
    return c.html(renderLogin({ next, error: 'Username atau password salah.', user }), 401);
  }
  await startSession(c, user, body.remember === 'on');
  return c.redirect(next);
});

dashboardRoutes.post('/logout', (c) => {
  endSession(c);
  return c.redirect('/dashboard/login');
});

// Gerbang sesi untuk semua halaman lain.
dashboardRoutes.use('*', async (c, next) => {
  if (!dashboardAuthEnabled) {
    c.set('admin', 'dev');
    return next();
  }
  const admin = await sessionUser(c);
  if (!admin) {
    const url = new URL(c.req.url);
    const target = safeNext(url.pathname + url.search);
    return c.redirect(`/dashboard/login?next=${encodeURIComponent(target)}`);
  }
  c.set('admin', admin);
  return next();
});

const intParam = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : def;
};

dashboardRoutes.get('/', async (c) => c.html(renderOverview(await getOverview())));

dashboardRoutes.get('/catalog', async (c) => {
  const page = intParam(c.req.query('page'), 1);
  const pg = await getCatalogPage({
    page,
    limit: 24,
    q: c.req.query('q') ?? '',
    category: c.req.query('category'),
    source: parseSource(c.req.query('source')),
    verified: parseVerified(c.req.query('verified')),
  });
  return c.html(renderCatalog(pg));
});

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
  await contributions.approve(c.req.param('id'), c.get('admin'));
  return c.redirect('/dashboard/contributions?status=pending');
});

dashboardRoutes.post('/contributions/:id/reject', async (c) => {
  const body = await c.req.parseBody();
  const note = typeof body.note === 'string' ? body.note : undefined;
  await contributions.reject(c.req.param('id'), c.get('admin'), note);
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
