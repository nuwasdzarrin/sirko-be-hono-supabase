import { z } from 'zod';
import { sql, type DbClient } from '../db/client.js';
import { uuid } from '../lib/uuid.js';
import { nowMs } from '../lib/time.js';
import { AppError, forbidden, notFound, validation } from '../lib/errors.js';
import type { Role } from '../lib/permissions.js';
import { notifyAdmin, tgEsc } from '../lib/notify.js';

const rupiah = (v: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(v);

/**
 * Poin Sirko — saldo prabayar per AKUN PEMILIK, hanya untuk membeli PPOB.
 * Server = satu-satunya sumber kebenaran. Setiap perubahan saldo lewat
 * {@link applyLedger}: UPDATE saldo + INSERT ledger dalam SATU transaksi DB.
 * Tidak ada transfer antar-akun & tidak ada penarikan (desain §3).
 * Rancangan: docs/superpowers/specs/2026-11-02-ppob-poin-design.md
 */

type Row = Record<string, unknown>;
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Konfigurasi (app_config.points, bisa diubah admin) ───────────────────────

export interface PointsConfig {
  minTopup: number;
  maxTopup: number;
  expiryHours: number;
  maxPendingTopups: number;
  bankName: string;
  accountNo: string;
  accountName: string;
  /** URL gambar QRIS statis (opsional). */
  qrisImageUrl: string;
  /** Catatan tambahan untuk instruksi transfer. */
  note: string;
}

export const DEFAULT_POINTS_CONFIG: PointsConfig = {
  minTopup: 20_000,
  maxTopup: 5_000_000,
  expiryHours: 24,
  maxPendingTopups: 3,
  bankName: '',
  accountNo: '',
  accountName: '',
  qrisImageUrl: '',
  note: 'Transfer TEPAT sesuai nominal (termasuk 3 digit kode unik) agar cepat dikonfirmasi.',
};

export async function getConfig(db: DbClient = sql): Promise<PointsConfig> {
  const rows = await db<{ value: Partial<PointsConfig> }[]>`SELECT value FROM app_config WHERE key = 'points'`;
  return { ...DEFAULT_POINTS_CONFIG, ...(rows[0]?.value ?? {}) };
}

export const configSchema = z.object({
  minTopup: z.coerce.number().int().min(1_000).max(100_000_000),
  maxTopup: z.coerce.number().int().min(1_000).max(100_000_000),
  expiryHours: z.coerce.number().int().min(1).max(168),
  maxPendingTopups: z.coerce.number().int().min(1).max(20),
  bankName: z.string().trim().max(60),
  accountNo: z.string().trim().max(40),
  accountName: z.string().trim().max(80),
  qrisImageUrl: z.union([z.literal(''), z.string().trim().url().max(500)]),
  note: z.string().trim().max(300),
}).refine((c) => c.minTopup <= c.maxTopup, { message: 'Minimal top-up harus ≤ maksimal', path: ['minTopup'] });

export async function saveConfig(input: unknown, admin: string): Promise<PointsConfig> {
  const cfg = configSchema.parse(input);
  await sql`
    INSERT INTO app_config (key, value, updated_by, updated_at)
    VALUES ('points', ${sql.json(cfg)}, ${admin}, ${nowMs()})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`;
  return cfg;
}

// ── Akun pemilik ─────────────────────────────────────────────────────────────

/** Akun pemilik toko: baris users ber-role owner dengan account_id (hanya diisi server). */
export async function ownerAccountId(businessId: string, db: DbClient = sql): Promise<string | null> {
  if (!UUID_RE.test(businessId)) return null;
  const rows = await db<{ account_id: string }[]>`
    SELECT account_id FROM users
    WHERE business_id = ${businessId} AND role = 'owner' AND account_id IS NOT NULL AND deleted_at IS NULL
    ORDER BY created_at, id LIMIT 1`;
  return rows[0]?.account_id ?? null;
}

async function requireOwnerAccount(businessId: string): Promise<string> {
  const acc = await ownerAccountId(businessId);
  if (!acc) {
    throw new AppError('OWNER_ACCOUNT_MISSING', 'Toko ini belum punya akun pemilik (login cloud) — Poin Sirko tidak tersedia.');
  }
  return acc;
}

// ── Ledger (satu-satunya jalan mengubah saldo) ───────────────────────────────

export type LedgerType = 'topup' | 'purchase' | 'refund' | 'adjustment';

export interface LedgerEntryInput {
  accountId: string;
  businessId: string | null;
  type: LedgerType;
  amount: number; // + masuk, − keluar
  refType: 'topup' | 'ppob_order' | 'manual' | null;
  refId: string | null;
  note?: string | null;
  createdBy: string;
}

/**
 * Ubah saldo + catat ledger. WAJIB dipanggil di dalam transaksi (`sql.begin`).
 * Potongan hanya terjadi bila saldo cukup (atomik di UPDATE) → else
 * INSUFFICIENT_POINTS. Ref ganda ditolak unique index (23505).
 */
export async function applyLedger(tx: DbClient, e: LedgerEntryInput): Promise<{ id: string; balanceAfter: number }> {
  if (!Number.isSafeInteger(e.amount) || e.amount === 0) throw validation('Jumlah poin tidak valid');
  const ts = nowMs();
  await tx`
    INSERT INTO point_accounts (account_id, balance, created_at, updated_at)
    VALUES (${e.accountId}, 0, ${ts}, ${ts}) ON CONFLICT (account_id) DO NOTHING`;
  const upd = await tx<{ balance: string }[]>`
    UPDATE point_accounts SET balance = balance + ${e.amount}, updated_at = ${ts}
    WHERE account_id = ${e.accountId} AND balance + ${e.amount} >= 0
    RETURNING balance`;
  if (!upd[0]) {
    const cur = await tx<{ balance: string }[]>`SELECT balance FROM point_accounts WHERE account_id = ${e.accountId}`;
    throw new AppError('INSUFFICIENT_POINTS', 'Poin tidak cukup.', { balance: n(cur[0]?.balance), required: -e.amount });
  }
  const id = uuid();
  const balanceAfter = n(upd[0].balance);
  await tx`
    INSERT INTO point_ledger ${tx({
      id,
      account_id: e.accountId,
      business_id: e.businessId,
      type: e.type,
      amount: e.amount,
      balance_after: balanceAfter,
      ref_type: e.refType,
      ref_id: e.refId,
      note: e.note ?? null,
      created_by: e.createdBy,
      created_at: ts,
    })}`;
  return { id, balanceAfter };
}

// ── Baca saldo & mutasi ──────────────────────────────────────────────────────

export interface LedgerItem {
  id: string;
  businessId: string | null;
  businessName: string | null;
  type: LedgerType;
  amount: number;
  balanceAfter: number;
  refType: string | null;
  refId: string | null;
  note: string | null;
  createdBy: string;
  createdAt: number;
}

function ledgerItem(r: Row): LedgerItem {
  return {
    id: r.id as string,
    businessId: (r.business_id as string) ?? null,
    businessName: (r.business_name as string) ?? null,
    type: r.type as LedgerType,
    amount: n(r.amount),
    balanceAfter: n(r.balance_after),
    refType: (r.ref_type as string) ?? null,
    refId: (r.ref_id as string) ?? null,
    note: (r.note as string) ?? null,
    createdBy: r.created_by as string,
    createdAt: n(r.created_at),
  };
}

export async function balanceOf(accountId: string): Promise<number> {
  const r = await sql<{ balance: string }[]>`SELECT balance FROM point_accounts WHERE account_id = ${accountId}`;
  return n(r[0]?.balance);
}

function encodeCursor(ts: number, id: string) {
  return Buffer.from(`${ts}|${id}`, 'utf8').toString('base64url');
}
function decodeCursor(c: string | undefined): { ts: number; id: string } | null {
  if (!c) return null;
  const [ts, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
  if (!ts || !id || !UUID_RE.test(id) || !Number.isFinite(Number(ts))) throw validation('Cursor tidak valid');
  return { ts: Number(ts), id };
}

export async function listLedger(
  accountId: string,
  opts: { cursor?: string; limit?: number } = {},
): Promise<{ items: LedgerItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const cur = decodeCursor(opts.cursor);
  const rows = await sql<Row[]>`
    SELECT l.*, b.name AS business_name FROM point_ledger l
    LEFT JOIN businesses b ON b.id = l.business_id
    WHERE l.account_id = ${accountId}
      ${cur ? sql`AND (l.created_at, l.id) < (${cur.ts}, ${cur.id})` : sql``}
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT ${limit + 1}`;
  const items = rows.slice(0, limit).map(ledgerItem);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
}

// ── Top-up ───────────────────────────────────────────────────────────────────

export type TopupStatus = 'pending' | 'paid' | 'rejected' | 'expired' | 'cancelled';

export interface Topup {
  id: string;
  accountId: string;
  businessId: string | null;
  businessName: string | null;
  ownerEmail: string | null;
  amount: number;
  uniqueCode: number;
  transferAmount: number;
  status: TopupStatus;
  requestedBy: string;
  adminNote: string | null;
  confirmedBy: string | null;
  paidAt: number | null;
  expiresAt: number;
  createdAt: number;
}

function topupItem(r: Row): Topup {
  return {
    id: r.id as string,
    accountId: r.account_id as string,
    businessId: (r.business_id as string) ?? null,
    businessName: (r.business_name as string) ?? null,
    ownerEmail: (r.owner_email as string) ?? null,
    amount: n(r.amount),
    uniqueCode: n(r.unique_code),
    transferAmount: n(r.transfer_amount),
    status: r.status as TopupStatus,
    requestedBy: r.requested_by as string,
    adminNote: (r.admin_note as string) ?? null,
    confirmedBy: (r.confirmed_by as string) ?? null,
    paidAt: r.paid_at == null ? null : n(r.paid_at),
    expiresAt: n(r.expires_at),
    createdAt: n(r.created_at),
  };
}

const topupSelect = () => sql`
  SELECT t.*, b.name AS business_name, a.email::text AS owner_email
  FROM point_topups t
  LEFT JOIN businesses b ON b.id = t.business_id
  LEFT JOIN accounts a ON a.id = t.account_id`;

/** Tandai top-up menunggu yang lewat batas waktu sebagai expired (dipanggil saat dibaca). */
export async function expireStale(): Promise<number> {
  const ts = nowMs();
  const r = await sql`UPDATE point_topups SET status = 'expired', updated_at = ${ts}
                      WHERE status = 'pending' AND expires_at < ${ts} RETURNING id`;
  return r.length;
}

export const topupCreateSchema = z.object({ amount: z.number().int() });

export interface TopupInstructions {
  topup: Topup;
  instructions: {
    transferAmount: number;
    bankName: string;
    accountNo: string;
    accountName: string;
    qrisImageUrl: string | null;
    note: string;
    expiresAt: number;
  };
}

function instructionsFor(t: Topup, cfg: PointsConfig): TopupInstructions {
  return {
    topup: t,
    instructions: {
      transferAmount: t.transferAmount,
      bankName: cfg.bankName,
      accountNo: cfg.accountNo,
      accountName: cfg.accountName,
      qrisImageUrl: cfg.qrisImageUrl || null,
      note: cfg.note,
      expiresAt: t.expiresAt,
    },
  };
}

/** Pemilik/admin toko mengajukan top-up → kode unik & instruksi transfer. */
export async function createTopup(auth: { businessId: string; userId: string; role: Role }, amount: number): Promise<TopupInstructions> {
  if (auth.role !== 'owner' && auth.role !== 'admin') throw forbidden('Hanya pemilik/admin toko yang bisa top-up Poin.');
  const accountId = await requireOwnerAccount(auth.businessId);
  const cfg = await getConfig();
  if (!Number.isSafeInteger(amount) || amount < cfg.minTopup || amount > cfg.maxTopup) {
    throw validation(`Nominal top-up harus antara ${cfg.minTopup} dan ${cfg.maxTopup}.`, {
      min: cfg.minTopup,
      max: cfg.maxTopup,
    });
  }
  await expireStale();
  const pending = await sql<{ c: number }[]>`
    SELECT count(*)::int c FROM point_topups WHERE account_id = ${accountId} AND status = 'pending'`;
  if ((pending[0]?.c ?? 0) >= cfg.maxPendingTopups) {
    throw new AppError('CONFLICT', 'Masih ada top-up yang menunggu konfirmasi. Selesaikan atau batalkan dulu.');
  }

  const ts = nowMs();
  // Kode unik acak 1–999; nominal transfer harus unik di antara top-up pending.
  for (let attempt = 0; attempt < 25; attempt++) {
    const code = 1 + Math.floor(Math.random() * 999);
    try {
      const rows = await sql<Row[]>`
        INSERT INTO point_topups ${sql({
          id: uuid(),
          account_id: accountId,
          business_id: auth.businessId,
          amount,
          unique_code: code,
          transfer_amount: amount + code,
          status: 'pending',
          requested_by: `app:${auth.userId}`,
          expires_at: ts + cfg.expiryHours * 3_600_000,
          created_at: ts,
          updated_at: ts,
        })}
        RETURNING id`;
      const t = (await getTopup(rows[0]!.id as string))!;
      void notifyAdmin({
        text:
          `💰 <b>Top-up Poin baru</b>
` +
          `Toko: <b>${tgEsc(t.businessName ?? '—')}</b>${t.ownerEmail ? ` (${tgEsc(t.ownerEmail)})` : ''}
` +
          `Transfer: <b>${rupiah(t.transferAmount)}</b> (kode unik ${t.uniqueCode})
` +
          `Cek mutasi rekening lalu konfirmasi di dashboard.`,
        linkPath: '/dashboard/points?tab=topups',
        linkLabel: 'Konfirmasi top-up',
      });
      return instructionsFor(t, cfg);
    } catch (e) {
      if ((e as { code?: string }).code !== '23505') throw e;
    }
  }
  throw new AppError('CONFLICT', 'Gagal membuat kode unik, coba lagi sebentar.');
}

export async function getTopup(id: string): Promise<Topup | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await sql<Row[]>`${topupSelect()} WHERE t.id = ${id}`;
  return rows[0] ? topupItem(rows[0]) : null;
}

export async function listTopupsForAccount(accountId: string, limit = 30): Promise<Topup[]> {
  await expireStale();
  const rows = await sql<Row[]>`${topupSelect()} WHERE t.account_id = ${accountId} ORDER BY t.created_at DESC LIMIT ${limit}`;
  return rows.map(topupItem);
}

/** Pemilik membatalkan top-up miliknya yang masih menunggu. */
export async function cancelTopup(businessId: string, id: string): Promise<Topup> {
  const accountId = await requireOwnerAccount(businessId);
  const t = await getTopup(id);
  if (!t || t.accountId !== accountId) throw notFound('Top-up tidak ditemukan');
  const ts = nowMs();
  await sql`UPDATE point_topups SET status = 'cancelled', updated_at = ${ts} WHERE id = ${id} AND status = 'pending'`;
  return (await getTopup(id))!;
}

// ── Untuk app: ringkasan ─────────────────────────────────────────────────────

export async function summaryForBusiness(businessId: string) {
  const accountId = await requireOwnerAccount(businessId);
  const [balance, ledger, topups, cfg] = await Promise.all([
    balanceOf(accountId),
    listLedger(accountId, { limit: 20 }),
    listTopupsForAccount(accountId, 10),
    getConfig(),
  ]);
  return {
    balance,
    ledger: ledger.items,
    nextCursor: ledger.nextCursor,
    pendingTopups: topups.filter((t) => t.status === 'pending').map((t) => instructionsFor(t, cfg)),
    limits: { minTopup: cfg.minTopup, maxTopup: cfg.maxTopup },
  };
}

export async function accountIdForBusiness(businessId: string): Promise<string> {
  return requireOwnerAccount(businessId);
}

// ── Admin ────────────────────────────────────────────────────────────────────

/**
 * Admin mengonfirmasi dana masuk → kredit Poin sebesar nominal transfer.
 * Idempoten: hanya top-up pending/expired yang diproses; ledger punya unique ref.
 */
export async function adminConfirmTopup(id: string, admin: string, note?: string | null): Promise<{ ok: boolean; message: string }> {
  const t = await getTopup(id);
  if (!t) return { ok: false, message: 'Top-up tidak ditemukan.' };
  return sql.begin(async (tx) => {
    const ts = nowMs();
    const upd = await tx`
      UPDATE point_topups SET status = 'paid', paid_at = ${ts}, confirmed_by = ${admin},
        admin_note = coalesce(${note ?? null}, admin_note), updated_at = ${ts}
      WHERE id = ${id} AND status IN ('pending', 'expired') RETURNING id`;
    if (upd.length === 0) return { ok: false, message: `Top-up sudah berstatus "${t.status}" — tidak diproses ulang.` };
    const r = await applyLedger(tx, {
      accountId: t.accountId,
      businessId: t.businessId,
      type: 'topup',
      amount: t.transferAmount,
      refType: 'topup',
      refId: id,
      note: `Top-up ${rupiah(t.transferAmount)} (kode unik ${t.uniqueCode})`,
      createdBy: `admin:${admin}`,
    });
    return { ok: true, message: `Top-up dikonfirmasi: +${rupiah(t.transferAmount).replace('Rp ', '')} Poin untuk ${t.businessName ?? 'toko'} (saldo ${rupiah(r.balanceAfter).replace('Rp ', '')}).` };
  });
}

export async function adminRejectTopup(id: string, admin: string, note: string | null): Promise<{ ok: boolean; message: string }> {
  const ts = nowMs();
  const r = await sql`
    UPDATE point_topups SET status = 'rejected', confirmed_by = ${admin}, admin_note = ${note}, updated_at = ${ts}
    WHERE id = ${id} AND status IN ('pending', 'expired') RETURNING id`;
  return r.length
    ? { ok: true, message: 'Top-up ditolak.' }
    : { ok: false, message: 'Top-up tidak ditemukan atau sudah diproses.' };
}

/** Koreksi manual saldo oleh admin (catatan wajib, tercatat di ledger). */
export async function adminAdjust(
  accountId: string,
  amount: number,
  note: string,
  admin: string,
  businessId: string | null,
): Promise<{ balanceAfter: number }> {
  if (!UUID_RE.test(accountId)) throw notFound('Akun tidak ditemukan');
  if (!note.trim()) throw validation('Catatan koreksi wajib diisi.');
  if (!Number.isSafeInteger(amount) || amount === 0) throw validation('Jumlah koreksi harus bilangan bulat ≠ 0.');
  const acc = await sql`SELECT 1 FROM accounts WHERE id = ${accountId}`;
  if (!acc.length) throw notFound('Akun tidak ditemukan');
  return sql.begin((tx) =>
    applyLedger(tx, {
      accountId,
      businessId,
      type: 'adjustment',
      amount,
      refType: 'manual',
      refId: null,
      note: note.trim(),
      createdBy: `admin:${admin}`,
    }),
  );
}

export async function adminListTopups(opts: { status: TopupStatus | 'semua'; page: number; limit: number }) {
  await expireStale();
  const where = opts.status === 'semua' ? sql`true` : sql`t.status = ${opts.status}`;
  const [totalRows, countRows] = await Promise.all([
    sql<{ c: number }[]>`SELECT count(*)::int c FROM point_topups t WHERE ${where}`,
    sql<{ status: string; c: number }[]>`SELECT status, count(*)::int c FROM point_topups GROUP BY status`,
  ]);
  const total = totalRows[0]?.c ?? 0;
  const pages = Math.max(1, Math.ceil(total / opts.limit));
  const page = Math.min(Math.max(1, opts.page), pages);
  const rows = await sql<Row[]>`${topupSelect()} WHERE ${where}
    ORDER BY (t.status = 'pending') DESC, t.created_at DESC LIMIT ${opts.limit} OFFSET ${(page - 1) * opts.limit}`;
  const counts: Record<string, number> = { pending: 0, paid: 0, rejected: 0, expired: 0, cancelled: 0 };
  for (const r of countRows) counts[r.status] = r.c;
  counts.semua = Object.values(counts).reduce((a, b) => a + b, 0);
  return { items: rows.map(topupItem), total, page, pages, counts };
}

/** Total Poin beredar = kewajiban Sirko ke pengguna (Σ saldo semua akun). */
export async function totalOutstanding(): Promise<number> {
  const r = await sql<{ s: string }[]>`SELECT coalesce(sum(balance), 0) s FROM point_accounts`;
  return n(r[0]?.s);
}

export async function countPendingTopups(): Promise<number> {
  const r = await sql<{ c: number }[]>`
    SELECT count(*)::int c FROM point_topups WHERE status = 'pending' AND expires_at >= ${nowMs()}`;
  return r[0]?.c ?? 0;
}

export interface PointAccountRow {
  accountId: string;
  email: string | null;
  phone: string | null;
  ownerName: string | null;
  balance: number;
  stores: Array<{ id: string; name: string }>;
  lastActivityAt: number | null;
}

/** Semua akun pemilik yang punya saldo/riwayat Poin (atau semua pemilik bila `all`). */
export async function adminListAccounts(opts: { page: number; limit: number; q?: string }) {
  const q = (opts.q ?? '').trim();
  const like = `%${q}%`;
  const filter = q
    ? sql`AND (a.email::text ILIKE ${like} OR a.phone ILIKE ${like} OR EXISTS (
        SELECT 1 FROM users u2 JOIN businesses b2 ON b2.id = u2.business_id
        WHERE u2.account_id = a.id AND (b2.name ILIKE ${like} OR u2.name ILIKE ${like})))`
    : sql``;
  const base = () => sql`
    FROM accounts a
    LEFT JOIN point_accounts pa ON pa.account_id = a.id
    WHERE EXISTS (SELECT 1 FROM users u WHERE u.account_id = a.id AND u.role = 'owner' AND u.deleted_at IS NULL) ${filter}`;
  const totalRows = await sql<{ c: number }[]>`SELECT count(*)::int c ${base()}`;
  const total = totalRows[0]?.c ?? 0;
  const pages = Math.max(1, Math.ceil(total / opts.limit));
  const page = Math.min(Math.max(1, opts.page), pages);
  const rows = await sql<Row[]>`
    SELECT a.id, a.email::text AS email, a.phone, coalesce(pa.balance, 0) AS balance,
      (SELECT max(created_at) FROM point_ledger l WHERE l.account_id = a.id) AS last_ms,
      (SELECT u.name FROM users u WHERE u.account_id = a.id AND u.role = 'owner' AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1) AS owner_name,
      (SELECT coalesce(json_agg(json_build_object('id', b.id, 'name', b.name) ORDER BY b.name), '[]')
         FROM users u JOIN businesses b ON b.id = u.business_id
        WHERE u.account_id = a.id AND u.role = 'owner' AND u.deleted_at IS NULL AND b.deleted_at IS NULL) AS stores
    ${base()}
    ORDER BY coalesce(pa.balance, 0) DESC, a.created_at DESC
    LIMIT ${opts.limit} OFFSET ${(page - 1) * opts.limit}`;
  return {
    items: rows.map(
      (r): PointAccountRow => ({
        accountId: r.id as string,
        email: (r.email as string) ?? null,
        phone: (r.phone as string) ?? null,
        ownerName: (r.owner_name as string) ?? null,
        balance: n(r.balance),
        stores: (r.stores as Array<{ id: string; name: string }>) ?? [],
        lastActivityAt: r.last_ms == null ? null : n(r.last_ms),
      }),
    ),
    total,
    page,
    pages,
    q,
  };
}

/** Data tab Poin di halaman toko (akun pemilik toko itu). */
export async function adminPointsForBusiness(businessId: string) {
  const accountId = await ownerAccountId(businessId);
  if (!accountId) return null;
  const [balance, ledger, topups, stores] = await Promise.all([
    balanceOf(accountId),
    listLedger(accountId, { limit: 50 }),
    listTopupsForAccount(accountId, 20),
    sql<{ id: string; name: string }[]>`
      SELECT b.id, b.name FROM users u JOIN businesses b ON b.id = u.business_id
      WHERE u.account_id = ${accountId} AND u.role = 'owner' AND u.deleted_at IS NULL AND b.deleted_at IS NULL
      ORDER BY b.name`,
  ]);
  return { accountId, balance, ledger: ledger.items, topups, stores };
}
