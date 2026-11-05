import { Hono, type Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { AppError } from '../lib/errors.js';
import * as feedback from '../services/feedback.service.js';
import * as points from '../services/points.service.js';
import * as ppob from '../services/ppob.service.js';
import * as subscriptions from '../services/subscription.service.js';
import * as admin from '../services/subscription-admin.service.js';
import { renderNotFound, type Flash } from '../views/dashboard.view.js';
import {
  renderAccountDetail,
  renderAccounts,
  renderPayments,
  renderQueue,
  renderSettings,
} from '../views/subscriptions.view.js';

/**
 * Dashboard admin Langganan Juragan — di-mount di `/dashboard/subscriptions`
 * SETELAH middleware sesi & flash di routes/dashboard.ts (halaman terlindungi,
 * `admin` & `flash` sudah ada di context). File sendiri (brief §5.3).
 *
 *  GET  /                              antrian pembayaran pending (FIFO)
 *  GET  /payments?status=&q=&page=     riwayat pembayaran
 *  POST /payments/:id/confirm|reject   konfirmasi (aktifkan) / tolak (catatan wajib)
 *  GET  /accounts?q=  ·  /accounts/:id riwayat langganan per akun
 *  POST /accounts/:id/extend|cancel    perpanjang / potong manual (catatan wajib)
 *  GET  /settings  ·  POST /settings/price|payment   harga & data QRIS
 */

type Env = { Variables: { admin: string; flash: Flash | null } };
export const subscriptionRoutes = new Hono<Env>();

// Format cookie sama dengan routes/dashboard.ts → dibaca middleware flash di sana.
function flash(c: Context, type: Flash['type'], msg: string) {
  setCookie(c, 'sirko_flash', JSON.stringify({ type, msg }), {
    path: '/dashboard',
    maxAge: 60,
    sameSite: 'Lax',
    httpOnly: true,
  });
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const badge = (n: number) => (n > 0 ? ` <span class="nb">${n}</span>` : '');

/** Badge nav Langganan — dipakai juga oleh sendPage di routes/dashboard.ts. */
export async function withSubscriptionBadge(html: string): Promise<string> {
  return html.replace('<!--sub-badge-->', badge(await admin.countPending().catch(() => 0)));
}

async function sendPage(c: Context<Env>, html: string, status: 200 | 404 = 200) {
  const [fbNew, ptPending, ppAttention] = await Promise.all([
    feedback.countNew().catch(() => 0),
    points.countPendingTopups().catch(() => 0),
    ppob.countNeedsAttention().catch(() => 0),
  ]);
  const f = c.get('flash');
  const toast = f ? `<div class="flash ${f.type === 'error' ? 'err' : 'ok'}" role="status">${escapeHtml(f.msg)}</div>` : '';
  html = (await withSubscriptionBadge(html))
    .replace('<!--fb-badge-->', badge(fbNew))
    .replace('<!--pt-badge-->', badge(ptPending))
    .replace('<!--pp-badge-->', badge(ppAttention))
    .replace('<!--flash-->', toast);
  return c.html(html, status);
}

const intParam = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : def;
};

/** URL kembali dibatasi ke halaman langganan (cegah open redirect). */
function safeBack(v: unknown): string {
  const s = typeof v === 'string' ? v : '';
  return /^\/dashboard\/subscriptions(\/[\w-]*)*(\?[^\\]*)?$/.test(s) ? s : '/dashboard/subscriptions';
}

/** Error domain (validasi/tidak ditemukan) → flash; error lain dilempar. */
async function act(c: Context<Env>, back: string, ok: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    flash(c, 'ok', ok);
  } catch (e) {
    if (e instanceof AppError && e.status < 500) flash(c, 'error', e.message);
    else throw e;
  }
  return c.redirect(back);
}

const fmtRp = (v: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(v);
const fmtDate = (ms: number) =>
  new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' }).format(new Date(ms));

// ── Antrian & riwayat ────────────────────────────────────────────────────────

subscriptionRoutes.get('/', async (c) =>
  sendPage(c, renderQueue(await admin.paymentsPage({ status: 'pending', page: intParam(c.req.query('page'), 1), limit: 20 }))),
);

subscriptionRoutes.get('/payments', async (c) => {
  const s = c.req.query('status') ?? 'all';
  const status = (admin.PAYMENT_STATUSES as readonly string[]).includes(s) ? (s as admin.PaymentStatus) : 'all';
  const pg = await admin.paymentsPage({ status, q: c.req.query('q'), page: intParam(c.req.query('page'), 1), limit: 25 });
  return sendPage(c, renderPayments(pg));
});

subscriptionRoutes.post('/payments/:id/confirm', async (c) => {
  const back = safeBack((await c.req.parseBody()).back);
  try {
    const r = await subscriptions.confirmPayment(c.req.param('id'), c.get('admin'));
    flash(c, 'ok', `Pembayaran dikonfirmasi — Juragan aktif s/d ${fmtDate(r.endsAt)}.`);
  } catch (e) {
    if (e instanceof AppError && e.status < 500) flash(c, 'error', e.message);
    else throw e;
  }
  return c.redirect(back);
});

subscriptionRoutes.post('/payments/:id/reject', async (c) => {
  const body = await c.req.parseBody();
  const note = typeof body.note === 'string' ? body.note : '';
  return act(c, safeBack(body.back), 'Pembayaran ditolak.', () =>
    subscriptions.rejectPayment(c.req.param('id'), c.get('admin'), note),
  );
});

// ── Akun ─────────────────────────────────────────────────────────────────────

subscriptionRoutes.get('/accounts', async (c) => {
  const [pg, counts] = await Promise.all([
    admin.accountsPage({ q: c.req.query('q'), page: intParam(c.req.query('page'), 1), limit: 25 }),
    admin.statusCounts(),
  ]);
  return sendPage(c, renderAccounts(pg, counts.pending));
});

subscriptionRoutes.get('/accounts/:id', async (c) => {
  const [d, counts] = await Promise.all([admin.accountDetail(c.req.param('id')), admin.statusCounts()]);
  if (!d) return sendPage(c, renderNotFound('Akun tidak ditemukan.', '/dashboard/subscriptions/accounts'), 404);
  return sendPage(c, renderAccountDetail(d, counts.pending));
});

subscriptionRoutes.post('/accounts/:id/extend', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const period = body.period === 'yearly' ? 'yearly' : 'monthly';
  const note = typeof body.note === 'string' ? body.note : '';
  return act(c, `/dashboard/subscriptions/accounts/${id}`, `Langganan diperpanjang (+1 ${period === 'yearly' ? 'tahun' : 'bulan'}).`, () =>
    admin.manualExtend(id, period, note, c.get('admin')),
  );
});

subscriptionRoutes.post('/accounts/:id/cancel', async (c) => {
  const id = c.req.param('id');
  const note = String((await c.req.parseBody()).note ?? '');
  return act(c, `/dashboard/subscriptions/accounts/${id}`, 'Langganan dipotong — paket kembali ke Warung.', () =>
    admin.cancelActive(id, note, c.get('admin')),
  );
});

// ── Harga & QRIS ─────────────────────────────────────────────────────────────

subscriptionRoutes.get('/settings', async (c) => {
  const [prices, payment, counts] = await Promise.all([subscriptions.prices(), subscriptions.paymentConfig(), admin.statusCounts()]);
  return sendPage(c, renderSettings(prices, payment, counts.pending));
});

subscriptionRoutes.post('/settings/price', async (c) => {
  const body = await c.req.parseBody();
  const period = body.period === 'yearly' ? 'yearly' : 'monthly';
  const amount = Number(body.amount);
  const maxStores = Number(body.maxStores);
  return act(c, '/dashboard/subscriptions/settings', `Harga ${period === 'yearly' ? 'tahunan' : 'bulanan'} disimpan: ${fmtRp(amount)}.`, () =>
    subscriptions.setPrice(period, amount, maxStores),
  );
});

subscriptionRoutes.post('/settings/payment', async (c) => {
  const body = await c.req.parseBody();
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');
  return act(c, '/dashboard/subscriptions/settings', 'Data pembayaran disimpan.', async () => {
    let qrisUrl = str('qrisUrl') || null;
    const file = body.qrisFile;
    if (file instanceof File && file.size > 0) qrisUrl = await admin.uploadQris(file);
    if (qrisUrl && !/^https:\/\//i.test(qrisUrl)) {
      throw new AppError('VALIDATION', 'URL QRIS harus diawali https:// (aplikasi mengunduh gambar ini).');
    }
    await subscriptions.setPaymentConfig(
      {
        qrisUrl,
        bankName: str('bankName') || null,
        accountNo: str('accountNo') || null,
        accountName: str('accountName') || null,
        note: str('note') || null,
      },
      c.get('admin'),
    );
  });
});
