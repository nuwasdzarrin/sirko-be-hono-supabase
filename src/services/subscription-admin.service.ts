import { sql } from '../db/client.js';
import { uuid } from '../lib/uuid.js';
import { nowMs } from '../lib/time.js';
import { notFound, validation } from '../lib/errors.js';
import * as plans from './plan.service.js';
import type { EffectivePlan, PlanPeriod } from './plan.service.js';
import { addPeriod } from './subscription.service.js';

/**
 * Pembacaan & aksi admin untuk langganan Juragan (dashboard /dashboard/subscriptions).
 * Lintas-akun by design (admin). Semua aksi tercatat siapa (`reviewed_by` /
 * `created_by` / `cancelled_by`).
 */

export const PAYMENT_STATUSES = ['pending', 'confirmed', 'rejected', 'expired'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface PaymentItem {
  id: string;
  accountId: string;
  accountLabel: string;
  businessId: string | null;
  businessName: string | null;
  period: PlanPeriod;
  baseAmount: number;
  uniqueCode: number;
  amount: number;
  status: PaymentStatus;
  proofPath: string | null;
  reviewedBy: string | null;
  reviewedAt: number | null;
  note: string | null;
  expiresAt: number;
  createdAt: number;
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toPayment(r: Record<string, unknown>): PaymentItem {
  return {
    id: r.id as string,
    accountId: r.account_id as string,
    accountLabel: (r.email as string) ?? (r.phone as string) ?? '—',
    businessId: (r.business_id as string) ?? null,
    businessName: (r.business_name as string) ?? null,
    period: r.period as PlanPeriod,
    baseAmount: Number(r.base_amount),
    uniqueCode: Number(r.unique_code),
    amount: Number(r.amount),
    status: r.status as PaymentStatus,
    proofPath: (r.proof_path as string) ?? null,
    reviewedBy: (r.reviewed_by as string) ?? null,
    reviewedAt: n(r.reviewed_at),
    note: (r.note as string) ?? null,
    expiresAt: Number(r.expires_at),
    createdAt: Number(r.created_at),
  };
}

/** Tandai pending kedaluwarsa (malas, saat dibaca). */
async function expireStale(now: number) {
  await sql`UPDATE subscription_payments SET status = 'expired' WHERE status = 'pending' AND expires_at <= ${now}`;
}

export async function statusCounts(): Promise<Record<PaymentStatus, number>> {
  await expireStale(nowMs());
  const rows = await sql<{ status: PaymentStatus; c: number }[]>`
    SELECT status, count(*)::int c FROM subscription_payments GROUP BY status`;
  const out = Object.fromEntries(PAYMENT_STATUSES.map((s) => [s, 0])) as Record<PaymentStatus, number>;
  for (const r of rows) out[r.status] = r.c;
  return out;
}

export interface PaymentsPage {
  items: PaymentItem[];
  total: number;
  page: number;
  pages: number;
  status: PaymentStatus | 'all';
  q: string;
  counts: Record<PaymentStatus, number>;
}

/** Daftar pembayaran (antrian/riwayat). `q` cocok ke email/telepon/nama toko/nominal. */
export async function paymentsPage(opts: {
  status: PaymentStatus | 'all';
  q?: string;
  page: number;
  limit: number;
}): Promise<PaymentsPage> {
  const counts = await statusCounts();
  const q = (opts.q ?? '').trim();
  const conds = [sql`true`];
  if (opts.status !== 'all') conds.push(sql`p.status = ${opts.status}`);
  if (q) {
    const like = `%${q}%`;
    const amount = /^\d+$/.test(q.replace(/\./g, '')) ? Number(q.replace(/\./g, '')) : -1;
    conds.push(sql`(a.email::text ILIKE ${like} OR a.phone ILIKE ${like} OR b.name ILIKE ${like} OR p.amount = ${amount})`);
  }
  const where = conds.reduce((x, c) => sql`${x} AND ${c}`);
  const [{ c: total } = { c: 0 }] = await sql<{ c: number }[]>`
    SELECT count(*)::int c FROM subscription_payments p
    JOIN accounts a ON a.id = p.account_id LEFT JOIN businesses b ON b.id = p.business_id
    WHERE ${where}`;
  const pages = Math.max(1, Math.ceil(total / opts.limit));
  const page = Math.min(Math.max(1, opts.page), pages);
  // Antrian pending: terlama dulu (FIFO); riwayat: terbaru dulu.
  const order = opts.status === 'pending' ? sql`p.created_at ASC` : sql`p.created_at DESC`;
  const rows = await sql<Record<string, unknown>[]>`
    SELECT p.*, a.email::text AS email, a.phone, b.name AS business_name
    FROM subscription_payments p
    JOIN accounts a ON a.id = p.account_id LEFT JOIN businesses b ON b.id = p.business_id
    WHERE ${where} ORDER BY ${order}, p.id
    LIMIT ${opts.limit} OFFSET ${(page - 1) * opts.limit}`;
  return { items: rows.map(toPayment), total, page, pages, status: opts.status, q, counts };
}

// ── Akun ─────────────────────────────────────────────────────────────────────

export interface AccountItem {
  id: string;
  label: string;
  ownedStores: number;
  plan: EffectivePlan;
  lastPaymentAt: number | null;
  createdAt: number;
}

export interface AccountsPage {
  items: AccountItem[];
  total: number;
  page: number;
  pages: number;
  q: string;
}

/**
 * Akun pemilik toko (punya ≥ 1 toko sebagai owner) — dicari via email/telepon/
 * nama toko. Akun berlangganan & yang pernah bayar ditampilkan lebih dulu.
 */
export async function accountsPage(opts: { q?: string; page: number; limit: number }): Promise<AccountsPage> {
  const q = (opts.q ?? '').trim();
  const like = `%${q}%`;
  const filter = q
    ? sql`AND (a.email::text ILIKE ${like} OR a.phone ILIKE ${like} OR EXISTS (
          SELECT 1 FROM users u2 JOIN businesses b2 ON b2.id = u2.business_id
          WHERE u2.account_id = a.id AND b2.name ILIKE ${like}))`
    : sql``;
  const base = sql`
    FROM accounts a
    WHERE EXISTS (SELECT 1 FROM users u WHERE u.account_id = a.id AND u.role = 'owner' AND u.deleted_at IS NULL)
    ${filter}`;
  const [{ c: total } = { c: 0 }] = await sql<{ c: number }[]>`SELECT count(*)::int c ${base}`;
  const pages = Math.max(1, Math.ceil(total / opts.limit));
  const page = Math.min(Math.max(1, opts.page), pages);
  const rows = await sql<Record<string, unknown>[]>`
    SELECT a.id, a.email::text AS email, a.phone, a.created_at,
      (SELECT count(*)::int FROM users u JOIN businesses b ON b.id = u.business_id
        WHERE u.account_id = a.id AND u.role = 'owner' AND u.deleted_at IS NULL AND b.deleted_at IS NULL) AS owned,
      (SELECT max(created_at) FROM subscription_payments p WHERE p.account_id = a.id) AS last_pay,
      (SELECT max(ends_at) FROM subscriptions s WHERE s.account_id = a.id AND s.cancelled_at IS NULL) AS last_end
    ${base}
    ORDER BY last_end DESC NULLS LAST, last_pay DESC NULLS LAST, a.created_at DESC
    LIMIT ${opts.limit} OFFSET ${(page - 1) * opts.limit}`;
  const now = nowMs();
  const items = await Promise.all(
    rows.map(async (r) => ({
      id: r.id as string,
      label: (r.email as string) ?? (r.phone as string) ?? '—',
      ownedStores: Number(r.owned),
      plan: await plans.effective(r.id as string, now),
      lastPaymentAt: n(r.last_pay),
      createdAt: Number(r.created_at),
    })),
  );
  return { items, total, page, pages, q };
}

export interface SubscriptionItem {
  id: string;
  period: PlanPeriod;
  startsAt: number;
  endsAt: number;
  paymentId: string | null;
  createdBy: string | null;
  note: string | null;
  createdAt: number;
  cancelledAt: number | null;
  cancelledBy: string | null;
}

export interface AccountDetail {
  id: string;
  email: string | null;
  phone: string | null;
  createdAt: number;
  plan: EffectivePlan;
  stores: Array<{ id: string; name: string; role: string; createdAt: number }>;
  subscriptions: SubscriptionItem[];
  payments: PaymentItem[];
}

export async function accountDetail(accountId: string): Promise<AccountDetail | null> {
  if (!UUID_RE.test(accountId)) return null;
  const [acc] = await sql<Record<string, unknown>[]>`SELECT id, email::text AS email, phone, created_at FROM accounts WHERE id = ${accountId}`;
  if (!acc) return null;
  const [plan, stores, subs, pays] = await Promise.all([
    plans.effective(accountId),
    sql<Record<string, unknown>[]>`
      SELECT b.id, b.name, u.role, u.created_at FROM users u JOIN businesses b ON b.id = u.business_id
      WHERE u.account_id = ${accountId} AND u.deleted_at IS NULL AND b.deleted_at IS NULL
      ORDER BY u.created_at`,
    sql<Record<string, unknown>[]>`SELECT * FROM subscriptions WHERE account_id = ${accountId} ORDER BY starts_at DESC, created_at DESC`,
    sql<Record<string, unknown>[]>`
      SELECT p.*, a.email::text AS email, a.phone, b.name AS business_name
      FROM subscription_payments p JOIN accounts a ON a.id = p.account_id LEFT JOIN businesses b ON b.id = p.business_id
      WHERE p.account_id = ${accountId} ORDER BY p.created_at DESC LIMIT 50`,
  ]);
  return {
    id: acc.id as string,
    email: (acc.email as string) ?? null,
    phone: (acc.phone as string) ?? null,
    createdAt: Number(acc.created_at),
    plan,
    stores: stores.map((s) => ({ id: s.id as string, name: s.name as string, role: s.role as string, createdAt: Number(s.created_at) })),
    subscriptions: subs.map((s) => ({
      id: s.id as string,
      period: s.period as PlanPeriod,
      startsAt: Number(s.starts_at),
      endsAt: Number(s.ends_at),
      paymentId: (s.payment_id as string) ?? null,
      createdBy: (s.created_by as string) ?? null,
      note: (s.note as string) ?? null,
      createdAt: Number(s.created_at),
      cancelledAt: n(s.cancelled_at),
      cancelledBy: (s.cancelled_by as string) ?? null,
    })),
    payments: pays.map(toPayment),
  };
}

/** Perpanjang manual (tanpa pembayaran) — menyambung dari ujung langganan aktif. */
export async function manualExtend(accountId: string, period: PlanPeriod, note: string, admin: string) {
  const reason = note.trim();
  if (!reason) throw validation('Catatan wajib diisi (alasan perpanjangan manual)');
  const now = nowMs();
  return sql.begin(async (tx) => {
    const [acc] = await tx`SELECT id FROM accounts WHERE id = ${accountId} FOR UPDATE`;
    if (!acc) throw notFound('Akun tidak ditemukan');
    const [last] = await tx<{ ends_at: string | null }[]>`
      SELECT max(ends_at) AS ends_at FROM subscriptions
      WHERE account_id = ${accountId} AND ends_at > ${now} AND cancelled_at IS NULL`;
    const startsAt = Math.max(now, Number(last?.ends_at ?? 0));
    const endsAt = addPeriod(startsAt, period);
    await tx`INSERT INTO subscriptions (id, account_id, plan, period, starts_at, ends_at, created_by, note, created_at)
             VALUES (${uuid()}, ${accountId}, 'juragan', ${period}, ${startsAt}, ${endsAt}, ${`admin:${admin}`}, ${reason}, ${now})`;
    return { startsAt, endsAt };
  });
}

/**
 * Potong langganan: semua baris yang belum habis ditandai `cancelled` (riwayat
 * tetap ada). Paket langsung kembali warung. Data toko tak tersentuh (§5.7).
 */
export async function cancelActive(accountId: string, note: string, admin: string): Promise<number> {
  const reason = note.trim();
  if (!reason) throw validation('Catatan wajib diisi (alasan pemotongan)');
  const now = nowMs();
  const rows = await sql`
    UPDATE subscriptions
    SET cancelled_at = ${now}, cancelled_by = ${`admin:${admin}`},
        note = CASE WHEN note IS NULL THEN ${`Dipotong: ${reason}`} ELSE note || ${` · Dipotong: ${reason}`} END
    WHERE account_id = ${accountId} AND ends_at > ${now} AND cancelled_at IS NULL
    RETURNING id`;
  return rows.length;
}

const QRIS_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Unggah gambar QRIS statis ke bucket (presigned PUT, server-side) → URL publik HTTPS. */
export async function uploadQris(file: File): Promise<string> {
  const ext = QRIS_TYPES[file.type];
  if (!ext) throw validation('Gambar QRIS harus PNG, JPG, atau WebP');
  if (file.size > 2 * 1024 * 1024) throw validation('Gambar QRIS maksimal 2 MB');
  const { getStorage } = await import('../lib/storage.js');
  const storage = getStorage();
  const key = `config/qris-langganan-${Date.now()}.${ext}`;
  const res = await fetch(storage.signPut(key, file.type), {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: Buffer.from(await file.arrayBuffer()),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw validation(`Unggah QRIS gagal (HTTP ${res.status}). Isi URL gambar secara manual.`);
  return storage.publicUrl(key);
}
