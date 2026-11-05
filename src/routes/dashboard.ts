import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
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
  getBusinessDetail,
  getBusinessTable,
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
  renderCatalogForm,
  renderBusinessDetail,
  renderNotFound,
  type Flash,
} from '../views/dashboard.view.js';
import * as catalogAdmin from '../services/catalog-admin.service.js';
import { subscriptionRoutes } from './dashboard-subscriptions.js';
import * as feedback from '../services/feedback.service.js';
import { getStoreReport, getTransactionDetail, resolveRange } from '../services/store-report.service.js';
import { renderStoreReport, renderTransactionDetail } from '../views/business.view.js';
import { renderFeedback } from '../views/feedback.view.js';
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
type DashEnv = { Variables: { admin: string; flash: Flash | null } };
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

// ── Flash (pesan sekali tampil setelah redirect) ─────────────────────────────

const FLASH_COOKIE = 'sirko_flash';

function flash(c: Context, type: Flash['type'], msg: string) {
  setCookie(c, FLASH_COOKIE, JSON.stringify({ type, msg }), {
    path: '/dashboard',
    maxAge: 60,
    sameSite: 'Lax',
    httpOnly: true,
  });
}

dashboardRoutes.use('*', async (c, next) => {
  const raw = getCookie(c, FLASH_COOKIE);
  let f: Flash | null = null;
  if (raw) {
    try {
      f = JSON.parse(raw) as Flash; // getCookie sudah men-decode
    } catch {
      f = null;
    }
    deleteCookie(c, FLASH_COOKIE, { path: '/dashboard' });
  }
  c.set('flash', f);
  await next();
});

dashboardRoutes.route('/subscriptions', subscriptionRoutes); // Juragan — setelah sesi & flash

/** Kirim halaman HTML + sisipkan flash (marker di layout). */
async function sendPage(c: Context<DashEnv>, html: string, status: 200 | 404 | 422 = 200) {
  const fbNew = await feedback.countNew().catch(() => 0);
  html = html.replace('<!--fb-badge-->', fbNew > 0 ? ` <span class="nb">${fbNew}</span>` : '');
  const f = c.get('flash');
  const toast = f
    ? `<div class="flash ${f.type === 'error' ? 'err' : 'ok'}" role="status">${escapeHtml(f.msg)}</div>`
    : '';
  return c.html(html.replace('<!--flash-->', toast), status);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** URL kembali ke daftar katalog (dibatasi ke /dashboard/catalog). */
function safeBack(v: unknown): string {
  const s = typeof v === 'string' ? v : '';
  return /^\/dashboard\/catalog(\?[^\\]*)?$/.test(s) ? s : '/dashboard/catalog';
}

/** Pesan error ramah dari Zod/AppError untuk form. */
function formError(e: unknown): string | null {
  if (e instanceof ZodError) {
    const i = e.issues[0];
    return i ? `${i.path.join('.') || 'Data'}: ${i.message}` : 'Data tidak valid';
  }
  if (e instanceof AppError && e.status < 500) return e.message;
  return null;
}

const categoriesFor = async () => (await getCatalogPage({ page: 1, limit: 1 })).categories;

const intParam = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : def;
};

dashboardRoutes.get('/', async (c) => sendPage(c, renderOverview(await getOverview())));

dashboardRoutes.get('/catalog', async (c) => {
  const page = intParam(c.req.query('page'), 1);
  const pg = await getCatalogPage({
    page,
    limit: 24,
    q: c.req.query('q') ?? '',
    category: c.req.query('category'),
    source: parseSource(c.req.query('source')),
    verified: parseVerified(c.req.query('verified')),
    trash: c.req.query('trash') === '1',
  });
  return sendPage(c, renderCatalog(pg));
});

// ── Kelola produk katalog ────────────────────────────────────────────────────

const BULK_VERB: Record<catalogAdmin.BulkAction, string> = {
  delete: 'dipindah ke Sampah',
  restore: 'dipulihkan',
  verify: 'ditandai terverifikasi',
  unverify: 'ditandai belum verifikasi',
};

dashboardRoutes.post('/catalog/bulk', async (c) => {
  const body = await c.req.parseBody({ all: true });
  const back = safeBack(body.back);
  const action = String(body.action ?? '') as catalogAdmin.BulkAction;
  if (!(catalogAdmin.BULK_ACTIONS as readonly string[]).includes(action)) {
    flash(c, 'error', 'Aksi tidak dikenal.');
    return c.redirect(back);
  }
  const ids = ([] as unknown[]).concat(body.ids ?? []).filter((x): x is string => typeof x === 'string');
  if (ids.length === 0) {
    flash(c, 'error', 'Pilih minimal satu produk.');
    return c.redirect(back);
  }
  const r = await catalogAdmin.bulk(action, ids);
  const why = action === 'restore' ? ': barcode sudah dipakai produk lain' : '';
  const skip = r.skipped ? ` (${r.skipped} dilewati${why})` : '';
  flash(c, r.done ? 'ok' : 'error', `${r.done} produk ${BULK_VERB[action]}${skip}.`);
  return c.redirect(back);
});

dashboardRoutes.get('/catalog/new', async (c) => {
  const back = safeBack(c.req.query('back'));
  const product = { verified: true, source: 'admin', keywords: [] };
  return sendPage(c, renderCatalogForm({ mode: 'new', product, back, categories: await categoriesFor(), error: null }));
});

dashboardRoutes.post('/catalog/new', async (c) => {
  const body = await c.req.parseBody();
  const back = safeBack(body.back);
  try {
    const id = await catalogAdmin.createFromForm(body);
    flash(c, 'ok', 'Produk baru ditambahkan.');
    return c.redirect(`/dashboard/catalog/${id}?back=${encodeURIComponent(back)}`);
  } catch (e) {
    const error = formError(e);
    if (!error) throw e;
    const product = catalogAdmin.formEcho(body);
    return sendPage(c, renderCatalogForm({ mode: 'new', product, back, categories: await categoriesFor(), error }), 422);
  }
});

dashboardRoutes.get('/catalog/:id', async (c) => {
  const back = safeBack(c.req.query('back'));
  const product = await catalogAdmin.getProduct(c.req.param('id'));
  if (!product) return sendPage(c, renderNotFound('Produk katalog tidak ditemukan.', back), 404);
  return sendPage(c, renderCatalogForm({ mode: 'edit', product, back, categories: await categoriesFor(), error: null }));
});

dashboardRoutes.post('/catalog/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const back = safeBack(body.back);
  try {
    await catalogAdmin.saveFromForm(id, body);
    flash(c, 'ok', 'Perubahan disimpan.');
    return c.redirect(back);
  } catch (e) {
    const error = formError(e);
    if (!error) throw e;
    const current = await catalogAdmin.getProduct(id);
    if (!current) return sendPage(c, renderNotFound('Produk katalog tidak ditemukan.', back), 404);
    const product = { ...current, ...catalogAdmin.formEcho(body) };
    return sendPage(c, renderCatalogForm({ mode: 'edit', product, back, categories: await categoriesFor(), error }), 422);
  }
});

dashboardRoutes.post('/catalog/:id/delete', async (c) => {
  const back = safeBack((await c.req.parseBody()).back);
  const r = await catalogAdmin.bulk('delete', [c.req.param('id')]);
  flash(c, r.done ? 'ok' : 'error', r.done ? 'Produk dipindah ke Sampah.' : 'Produk tidak ditemukan / sudah terhapus.');
  return c.redirect(back);
});

dashboardRoutes.post('/catalog/:id/restore', async (c) => {
  const id = c.req.param('id');
  const back = safeBack((await c.req.parseBody()).back);
  const r = await catalogAdmin.bulk('restore', [id]);
  flash(
    c,
    r.done ? 'ok' : 'error',
    r.done ? 'Produk dipulihkan.' : 'Gagal memulihkan: barcode sudah dipakai produk lain (ubah barcode produk itu dulu).',
  );
  return c.redirect(`/dashboard/catalog/${id}?back=${encodeURIComponent(back)}`);
});

const ALLOWED_STATUS = ['pending', 'approved', 'rejected'] as const;

dashboardRoutes.get('/contributions', async (c) => {
  const page = intParam(c.req.query('page'), 1);
  const s = c.req.query('status');
  const status = (ALLOWED_STATUS as readonly string[]).includes(s ?? '')
    ? (s as (typeof ALLOWED_STATUS)[number])
    : 'pending';
  return sendPage(c, renderContributions(await getContributionsPage({ page, limit: 20, status })));
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
  return sendPage(c, renderBusinesses(await getBusinessesPage({ page, limit: 20 })));
});

dashboardRoutes.get('/businesses/:id', async (c) => {
  const id = c.req.param('id');
  const detail = await getBusinessDetail(id);
  if (!detail) return sendPage(c, renderNotFound('Toko tidak ditemukan.', '/dashboard/businesses'), 404);
  const tab = c.req.query('tab') ?? '';
  if (tab === 'report') {
    const range = resolveRange({ preset: c.req.query('preset'), from: c.req.query('from'), to: c.req.query('to') });
    return sendPage(c, renderStoreReport(detail, await getStoreReport(id, range)));
  }
  const table = tab
    ? await getBusinessTable(id, tab, {
        page: intParam(c.req.query('page'), 1),
        limit: 25,
        deleted: c.req.query('deleted') === '1',
      })
    : null;
  return sendPage(c, renderBusinessDetail(detail, table));
});

dashboardRoutes.get('/businesses/:id/transactions/:txId', async (c) => {
  const id = c.req.param('id');
  const [detail, tx] = await Promise.all([getBusinessDetail(id), getTransactionDetail(id, c.req.param('txId'))]);
  if (!detail || !tx) {
    const back = detail ? `/dashboard/businesses/${id}?tab=transactions` : '/dashboard/businesses';
    return sendPage(c, renderNotFound('Transaksi tidak ditemukan.', back), 404);
  }
  return sendPage(c, renderTransactionDetail(detail, tx));
});

// ── Saran pengguna ───────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

dashboardRoutes.get('/feedback', async (c) => {
  const s = c.req.query('status') ?? 'baru';
  const status = (['semua', ...feedback.FEEDBACK_STATUSES] as string[]).includes(s)
    ? (s as feedback.FeedbackStatus | 'semua')
    : 'baru';
  const cat = c.req.query('category');
  const category = (feedback.FEEDBACK_CATEGORIES as readonly string[]).includes(cat ?? '') ? cat : undefined;
  const b = c.req.query('business');
  const businessId = b && UUID_RE.test(b) ? b : undefined;
  const [pg, biz] = await Promise.all([
    feedback.adminList({ page: intParam(c.req.query('page'), 1), limit: 20, status, category, businessId }),
    businessId ? getBusinessDetail(businessId) : Promise.resolve(null),
  ]);
  const business = biz ? { id: String(biz.business.id), name: String(biz.business.name ?? 'Toko') } : null;
  return sendPage(c, renderFeedback(pg, business));
});

dashboardRoutes.post('/feedback/:id', async (c) => {
  const body = await c.req.parseBody();
  const back = typeof body.back === 'string' && /^\/dashboard\/feedback(\?[^\\]*)?$/.test(body.back) ? body.back : '/dashboard/feedback';
  const status = String(body.status ?? '');
  if (!(feedback.FEEDBACK_STATUSES as readonly string[]).includes(status)) {
    flash(c, 'error', 'Status tidak dikenal.');
    return c.redirect(back);
  }
  const note = typeof body.adminNote === 'string' ? body.adminNote.trim().slice(0, 1000) : '';
  const ok = await feedback.adminUpdate(
    c.req.param('id'),
    { status: status as feedback.FeedbackStatus, adminNote: note || null },
    c.get('admin'),
  );
  flash(c, ok ? 'ok' : 'error', ok ? 'Saran diperbarui.' : 'Saran tidak ditemukan.');
  return c.redirect(back);
});

dashboardRoutes.get('/transactions', async (c) => {
  const page = intParam(c.req.query('page'), 1);
  return sendPage(c, renderTransactions(await getTransactionsPage({ page, limit: 20 })));
});
