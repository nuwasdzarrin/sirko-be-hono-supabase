import { randomInt } from 'node:crypto';
import { sql } from '../db/client.js';
import { uuid } from '../lib/uuid.js';
import { nowMs } from '../lib/time.js';
import { AppError, forbidden, notFound, validation } from '../lib/errors.js';
import * as plans from './plan.service.js';
import { notifyAdmin, tgEsc } from '../lib/notify.js';
import type { EffectivePlan, PlanPeriod } from './plan.service.js';

/**
 * Langganan Paket Juragan: QRIS statis + kode unik + konfirmasi admin
 * (JURAGAN.md §3.3, kontrak app §3). Langganan melekat ke AKUN owner (K6);
 * tidak terhubung dengan Poin Sirko (J5).
 */

export const PERIODS = ['monthly', 'yearly'] as const;
const CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000;
const CONFIG_KEY = 'subscription';

export const planUnavailable = () =>
  new AppError('PLAN_UNAVAILABLE', 'Pembayaran langganan belum tersedia. Coba lagi nanti.');

export interface PriceRow {
  plan: string;
  period: PlanPeriod;
  amount: number;
  maxStores: number;
}

export interface PaymentConfig {
  qrisUrl: string | null;
  bankName: string | null;
  accountNo: string | null;
  accountName: string | null;
  note: string | null;
}

export interface Checkout {
  id: string;
  period: PlanPeriod;
  amount: number;
  uniqueCode: number;
  expiresAt: number;
  qrisUrl: string | null;
  status: 'pending' | 'confirmed' | 'rejected' | 'expired';
  note: string | null;
  plan: EffectivePlan | null;
}

// ── Notifikasi admin ──────────────────────────────────────────────────────────

const rupiah = (v: number) => 'Rp' + new Intl.NumberFormat('id-ID').format(v);

/** Telegram ke admin saat ada permintaan bayar baru (notifyAdmin tak pernah melempar). */
export async function notifyPaymentPending(info: {
  amount: number;
  uniqueCode: number;
  period: string;
  accountLabel: string | null;
  businessName: string | null;
}) {
  await notifyAdmin({
    text:
      `👑 <b>Langganan Juragan — pembayaran baru</b>
` +
      `Toko: <b>${tgEsc(info.businessName ?? '—')}</b>${info.accountLabel ? ` (${tgEsc(info.accountLabel)})` : ''}
` +
      `Periode: ${info.period === 'yearly' ? 'Tahunan' : 'Bulanan'}
` +
      `Nominal QRIS: <b>${rupiah(info.amount)}</b> (kode unik ${info.uniqueCode})
` +
      `Cek mutasi lalu konfirmasi di dashboard.`,
    linkPath: '/dashboard/subscriptions',
    linkLabel: 'Buka antrian langganan',
  });
}

// ── Harga & konfigurasi ──────────────────────────────────────────────────────

export async function prices(): Promise<PriceRow[]> {
  const rows = await sql<{ plan: string; period: PlanPeriod; amount: string; max_stores: number }[]>`
    SELECT plan, period, amount, max_stores FROM plan_prices
    WHERE plan = 'juragan' ORDER BY CASE period WHEN 'monthly' THEN 0 ELSE 1 END`;
  return rows.map((r) => ({ plan: r.plan, period: r.period, amount: Number(r.amount), maxStores: r.max_stores }));
}

export async function paymentConfig(): Promise<PaymentConfig> {
  const rows = await sql<{ value: Record<string, unknown> }[]>`SELECT value FROM app_config WHERE key = ${CONFIG_KEY}`;
  const v = rows[0]?.value ?? {};
  const s = (k: string) => (typeof v[k] === 'string' && (v[k] as string).trim() ? (v[k] as string).trim() : null);
  return { qrisUrl: s('qrisUrl'), bankName: s('bankName'), accountNo: s('accountNo'), accountName: s('accountName'), note: s('note') };
}

export async function setPaymentConfig(cfg: Partial<PaymentConfig>, admin: string): Promise<void> {
  await sql`
    INSERT INTO app_config (key, value, updated_by, updated_at)
    VALUES (${CONFIG_KEY}, ${sql.json(cfg as never)}, ${admin}, ${nowMs()})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at`;
}

export async function setPrice(period: PlanPeriod, amount: number, maxStores: number): Promise<void> {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw validation('Harga harus angka positif');
  if (!Number.isSafeInteger(maxStores) || maxStores < 1) throw validation('Maks toko minimal 1');
  await sql`
    INSERT INTO plan_prices (plan, period, amount, max_stores, updated_at)
    VALUES ('juragan', ${period}, ${amount}, ${maxStores}, ${nowMs()})
    ON CONFLICT (plan, period) DO UPDATE SET amount = EXCLUDED.amount,
      max_stores = EXCLUDED.max_stores, updated_at = EXCLUDED.updated_at`;
}

/** GET /v1/plans — harga + instruksi bayar + paket akun saat ini. */
export async function listPlans(auth: { userId: string; businessId: string | null }) {
  const accountId = await plans.accountIdOfUser(auth.userId);
  const [p, payment, plan] = await Promise.all([prices(), paymentConfig(), plans.forBusiness(auth.businessId, accountId)]);
  return { prices: p, payment, plan };
}

// ── Checkout ─────────────────────────────────────────────────────────────────

type PaymentRow = Record<string, unknown>;

async function toCheckout(r: PaymentRow, qrisUrl?: string | null): Promise<Checkout> {
  const status = r.status as Checkout['status'];
  return {
    id: r.id as string,
    period: r.period as PlanPeriod,
    amount: Number(r.amount),
    uniqueCode: Number(r.unique_code),
    expiresAt: Number(r.expires_at),
    qrisUrl: qrisUrl === undefined ? (await paymentConfig()).qrisUrl : qrisUrl,
    status,
    note: (r.note as string) ?? null,
    plan: status === 'confirmed' ? await plans.effective(r.account_id as string) : null,
  };
}

/** Tandai pending yang lewat batas waktu sebagai expired (malas, saat dibaca). */
async function expireStale(now: number, accountId?: string) {
  await sql`
    UPDATE subscription_payments SET status = 'expired'
    WHERE status = 'pending' AND expires_at <= ${now}
      ${accountId ? sql`AND account_id = ${accountId}` : sql``}`;
}

async function ownerAccount(auth: { userId: string; role: string }): Promise<string> {
  if (auth.role !== 'owner') throw forbidden('Hanya pemilik toko yang bisa berlangganan.');
  const accountId = await plans.accountIdOfUser(auth.userId);
  if (!accountId) throw forbidden('Hanya pemilik toko yang bisa berlangganan.');
  return accountId;
}

/**
 * POST /v1/plan/checkout — buat permintaan bayar `pending` (harga + kode unik
 * 1–999). Satu pending per akun: yang lama jadi `expired`. Dua pending aktif
 * tak pernah bernominal sama (unique index parsial + coba ulang).
 */
export async function checkout(
  auth: { userId: string; role: string; businessId: string | null },
  period: PlanPeriod,
): Promise<Checkout> {
  const accountId = await ownerAccount(auth);
  const price = (await prices()).find((p) => p.period === period);
  if (!price) throw planUnavailable();
  const payment = await paymentConfig();

  const now = nowMs();
  await expireStale(now);
  let row: PaymentRow | undefined;
  for (let attempt = 0; attempt < 30 && !row; attempt++) {
    const code = randomInt(1, 1000);
    try {
      row = await sql.begin(async (tx) => {
        await tx`UPDATE subscription_payments SET status = 'expired'
                 WHERE account_id = ${accountId} AND status = 'pending'`;
        const [r] = await tx<PaymentRow[]>`
          INSERT INTO subscription_payments
            (id, account_id, business_id, plan, period, base_amount, unique_code, amount,
             status, expires_at, created_at)
          VALUES (${uuid()}, ${accountId}, ${auth.businessId}, 'juragan', ${period}, ${price.amount},
                  ${code}, ${price.amount + code}, 'pending', ${now + CHECKOUT_TTL_MS}, ${now})
          RETURNING *`;
        return r;
      });
    } catch (err) {
      if ((err as { code?: string }).code !== '23505') throw err; // nominal bentrok → kode lain
    }
  }
  if (!row) throw planUnavailable();

  const [[biz], [acc]] = await Promise.all([
    auth.businessId
      ? sql<{ name: string }[]>`SELECT name FROM businesses WHERE id = ${auth.businessId}`
      : Promise.resolve([] as { name: string }[]),
    sql<{ label: string | null }[]>`SELECT coalesce(email::text, phone) AS label FROM accounts WHERE id = ${accountId}`,
  ]);
  await notifyPaymentPending({
    amount: Number(row.amount),
    uniqueCode: Number(row.unique_code),
    period,
    accountLabel: acc?.label ?? null,
    businessName: biz?.name ?? null,
  });
  return toCheckout(row, payment.qrisUrl);
}

/** GET /v1/plan/checkout/:id — status terbaru (hanya milik akun pelaku; selain itu 404). */
export async function getCheckout(auth: { userId: string }, id: string): Promise<Checkout> {
  const accountId = await plans.accountIdOfUser(auth.userId);
  if (!accountId || !/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Pembayaran tidak ditemukan');
  await expireStale(nowMs(), accountId);
  const [r] = await sql<PaymentRow[]>`
    SELECT * FROM subscription_payments WHERE id = ${id} AND account_id = ${accountId}`;
  if (!r) throw notFound('Pembayaran tidak ditemukan');
  return toCheckout(r);
}

/** POST /v1/plan/checkout/:id/proof — lampirkan bukti transfer (URL media). */
export async function attachProof(auth: { userId: string; role: string }, id: string, mediaPath: string): Promise<Checkout> {
  const accountId = await ownerAccount(auth);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Pembayaran tidak ditemukan');
  const [r] = await sql<PaymentRow[]>`
    UPDATE subscription_payments SET proof_path = ${mediaPath}
    WHERE id = ${id} AND account_id = ${accountId} AND status = 'pending'
    RETURNING *`;
  if (!r) throw notFound('Pembayaran tidak ditemukan atau sudah diproses');
  return toCheckout(r);
}

// ── Admin: konfirmasi / tolak ────────────────────────────────────────────────

/** Tambah periode kalender (UTC); tanggal yang tak ada (31 → Feb) dijepit ke akhir bulan. */
export function addPeriod(ms: number, period: PlanPeriod): number {
  const d = new Date(ms);
  const months = period === 'monthly' ? 1 : 12;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

/**
 * Konfirmasi pembayaran: status `confirmed` + baris `subscriptions` dalam satu
 * transaksi. Perpanjangan: `starts_at = max(now, ends_at langganan terakhir)` →
 * bayar sebelum habis tak menghanguskan sisa hari. Pending yang sudah `expired`
 * tetap boleh dikonfirmasi (dana masuk terlambat). Konfirmasi ganda ditolak.
 */
export async function confirmPayment(id: string, admin: string): Promise<{ startsAt: number; endsAt: number }> {
  const now = nowMs();
  return sql.begin(async (tx) => {
    const [p] = await tx<PaymentRow[]>`
      SELECT * FROM subscription_payments WHERE id = ${id} FOR UPDATE`;
    if (!p) throw notFound('Pembayaran tidak ditemukan');
    if (p.status !== 'pending' && p.status !== 'expired') {
      throw validation(`Pembayaran sudah ${p.status === 'confirmed' ? 'dikonfirmasi' : 'ditolak'}`);
    }
    const accountId = p.account_id as string;
    await tx`SELECT id FROM accounts WHERE id = ${accountId} FOR UPDATE`;
    const [last] = await tx<{ ends_at: string | null }[]>`
      SELECT max(ends_at) AS ends_at FROM subscriptions
      WHERE account_id = ${accountId} AND ends_at > ${now} AND cancelled_at IS NULL`;
    const startsAt = Math.max(now, Number(last?.ends_at ?? 0));
    const endsAt = addPeriod(startsAt, p.period as PlanPeriod);
    await tx`UPDATE subscription_payments
             SET status = 'confirmed', reviewed_by = ${admin}, reviewed_at = ${now}
             WHERE id = ${id}`;
    await tx`INSERT INTO subscriptions (id, account_id, plan, period, starts_at, ends_at, payment_id, created_by, created_at)
             VALUES (${uuid()}, ${accountId}, 'juragan', ${p.period as string}, ${startsAt}, ${endsAt}, ${id}, 'payment', ${now})`;
    return { startsAt, endsAt };
  });
}

/** Tolak pembayaran (catatan wajib — tampil ke pengguna). */
export async function rejectPayment(id: string, admin: string, note: string): Promise<void> {
  const reason = note.trim();
  if (!reason) throw validation('Alasan penolakan wajib diisi');
  const rows = await sql`
    UPDATE subscription_payments
    SET status = 'rejected', note = ${reason}, reviewed_by = ${admin}, reviewed_at = ${nowMs()}
    WHERE id = ${id} AND status IN ('pending', 'expired') RETURNING id`;
  if (rows.length === 0) throw notFound('Pembayaran tidak ditemukan atau sudah diproses');
}
