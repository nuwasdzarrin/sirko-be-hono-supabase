import { sql } from '../db/client.js';
import { nowMs } from '../lib/time.js';
import { effective } from './plan.service.js';

/**
 * Dashboard admin → menu "Pengguna": akun (pemilik) yang terdaftar di Sirko, lintas-tenant.
 * Baca saja. Saldo Poin dari point_accounts; paket dari subscriptions (aktif sekarang).
 */

type Row = Record<string, unknown>;

export type UserStatusFilter = 'semua' | 'verified' | 'unverified' | 'juragan' | 'no_store';
export const USER_FILTERS: UserStatusFilter[] = ['semua', 'verified', 'unverified', 'juragan', 'no_store'];

export interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
  pendingVerification: boolean;
  isAdmin: boolean;
  juragan: boolean;
  balance: number;
  stores: Array<{ id: string; name: string; role: string }>;
  createdAt: number;
  lastActiveAt: number | null;
}

const mapRow = (r: Row): UserRow => ({
  id: r.id as string,
  name: (r.name as string) ?? null,
  email: (r.email as string) ?? null,
  phone: (r.phone as string) ?? null,
  emailVerified: r.email_verified_at != null,
  pendingVerification: Boolean(r.pending_verification),
  isAdmin: Boolean(r.is_admin),
  juragan: Boolean(r.juragan),
  balance: Number(r.balance ?? 0),
  stores: (r.stores as UserRow['stores']) ?? [],
  createdAt: Number(r.created_at),
  lastActiveAt: r.last_active == null ? null : Number(r.last_active),
});

function select(now: number) {
  return sql`
    SELECT a.id, a.name, a.email::text AS email, a.phone, a.email_verified_at, a.pending_verification, a.created_at,
      coalesce(pa.balance, 0) AS balance,
      EXISTS (SELECT 1 FROM users u WHERE u.account_id = a.id AND u.role = 'sirko_admin') AS is_admin,
      EXISTS (SELECT 1 FROM subscriptions s WHERE s.account_id = a.id AND s.plan = 'juragan' AND s.cancelled_at IS NULL
              AND s.starts_at <= ${now} AND s.ends_at > ${now}) AS juragan,
      (SELECT coalesce(json_agg(json_build_object('id', b.id, 'name', b.name, 'role', u.role) ORDER BY b.created_at), '[]')
         FROM users u JOIN businesses b ON b.id = u.business_id
        WHERE u.account_id = a.id AND u.deleted_at IS NULL AND b.deleted_at IS NULL) AS stores,
      (SELECT max(rt.created_at) FROM refresh_tokens rt
        WHERE rt.account_id = a.id OR rt.user_id IN (SELECT u.id FROM users u WHERE u.account_id = a.id)) AS last_active`;
}

export async function listUsers(opts: { page: number; limit: number; q?: string; status?: UserStatusFilter }) {
  const now = nowMs();
  const q = (opts.q ?? '').trim();
  const like = `%${q}%`;
  const search = q
    ? sql`AND (a.email::text ILIKE ${like} OR a.phone ILIKE ${like} OR a.name ILIKE ${like} OR EXISTS (
        SELECT 1 FROM users u2 JOIN businesses b2 ON b2.id = u2.business_id
        WHERE u2.account_id = a.id AND (b2.name ILIKE ${like} OR u2.name ILIKE ${like})))`
    : sql``;
  const hasStore = sql`EXISTS (SELECT 1 FROM users u3 JOIN businesses b3 ON b3.id = u3.business_id
                        WHERE u3.account_id = a.id AND u3.deleted_at IS NULL AND b3.deleted_at IS NULL)`;
  const st = opts.status ?? 'semua';
  const status =
    st === 'verified'
      ? sql`AND a.email_verified_at IS NOT NULL`
      : st === 'unverified'
        ? sql`AND a.pending_verification`
        : st === 'juragan'
          ? sql`AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.account_id = a.id AND s.plan = 'juragan' AND s.cancelled_at IS NULL
                            AND s.starts_at <= ${now} AND s.ends_at > ${now})`
          : st === 'no_store'
            ? sql`AND NOT ${hasStore}`
            : sql``;
  const where = () => sql`FROM accounts a LEFT JOIN point_accounts pa ON pa.account_id = a.id WHERE true ${search} ${status}`;
  const total = (await sql<{ c: number }[]>`SELECT count(*)::int c ${where()}`)[0]?.c ?? 0;
  const pages = Math.max(1, Math.ceil(total / opts.limit));
  const page = Math.min(Math.max(1, opts.page), pages);
  const rows = await sql<Row[]>`${select(now)} ${where()} ORDER BY a.created_at DESC LIMIT ${opts.limit} OFFSET ${(page - 1) * opts.limit}`;
  const counts = (
    await sql<Row[]>`
      SELECT count(*)::int AS semua,
        count(*) FILTER (WHERE a.email_verified_at IS NOT NULL)::int AS verified,
        count(*) FILTER (WHERE a.pending_verification)::int AS unverified,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM subscriptions s WHERE s.account_id = a.id AND s.plan = 'juragan'
          AND s.cancelled_at IS NULL AND s.starts_at <= ${now} AND s.ends_at > ${now}))::int AS juragan,
        count(*) FILTER (WHERE NOT ${hasStore})::int AS no_store,
        count(*) FILTER (WHERE a.created_at >= ${now - 7 * 86_400_000})::int AS new7d
      FROM accounts a`
  )[0]!;
  return {
    items: rows.map(mapRow),
    total,
    page,
    pages,
    q,
    status: st,
    counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v)])) as Record<UserStatusFilter | 'new7d', number>,
  };
}

export interface UserDetail {
  user: UserRow;
  plan: Awaited<ReturnType<typeof effective>>;
  ledger: Array<{ type: string; amount: number; note: string | null; createdAt: number }>;
  locked: boolean;
}

export async function userDetail(id: string): Promise<UserDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const now = nowMs();
  const r = await sql<Row[]>`${select(now)} FROM accounts a LEFT JOIN point_accounts pa ON pa.account_id = a.id WHERE a.id = ${id}`;
  if (!r[0]) return null;
  const user = mapRow(r[0]);
  const [plan, ledger, lock] = await Promise.all([
    effective(id, now),
    sql<Row[]>`SELECT type, amount, note, created_at FROM point_ledger WHERE account_id = ${id} ORDER BY created_at DESC LIMIT 10`,
    sql<Row[]>`SELECT 1 FROM auth_throttle WHERE key = ${`acct:${id}`} AND locked_until > ${now}`,
  ]);
  return {
    user,
    plan,
    ledger: ledger.map((l) => ({ type: l.type as string, amount: Number(l.amount), note: (l.note as string) ?? null, createdAt: Number(l.created_at) })),
    locked: lock.length > 0,
  };
}

/** Buka kunci login akun (5× salah password) oleh admin. */
export async function unlockUser(id: string): Promise<void> {
  await sql`DELETE FROM auth_throttle WHERE key = ${`acct:${id}`}`;
}

/** Tabel yang DISIMPAN saat hapus akun (catatan keuangan wajib simpan / ledger tak boleh diubah). */
const RETAINED = new Set(['ppob_orders', 'point_ledger', 'point_topups', 'subscription_payments']);

/**
 * Hapus akun pemilik + data toko miliknya (permintaan /hapus-akun, kebijakan privasi §Hak Anda).
 * - Toko milik akun: semua data toko dihapus. Baris toko ikut dihapus bila tak ada catatan PPOB;
 *   bila masih dirujuk catatan keuangan yang disimpan, baris toko dianonimkan (nama/alamat/telepon/logo
 *   dikosongkan) & ditandai terhapus. Usulan katalog dari toko ikut dihapus.
 * - Akun dianonimkan (email/WA/nama/password diganti, sesi & OTP dihapus) — tak bisa dipakai login lagi.
 * - Disimpan: ppob_orders, point_ledger, point_topups, subscription_payments (kewajiban hukum/pajak).
 * `confirm` harus sama dengan email/WA akun (cegah salah klik). Atomik.
 */
export async function deleteAccount(id: string, confirm: string, admin: string): Promise<{ stores: number }> {
  const { validation } = await import('../lib/errors.js');
  const { randomBytes } = await import('node:crypto');
  const { hashPassword } = await import('../lib/password.js');
  const acc = (await sql<Row[]>`SELECT id, email::text AS email, phone FROM accounts WHERE id = ${id}`)[0];
  if (!acc) throw validation('Akun tidak ditemukan.');
  const c = confirm.trim().toLowerCase();
  if (!c || (c !== String(acc.email ?? '').toLowerCase() && c !== String(acc.phone ?? ''))) {
    throw validation('Ketik email atau nomor WA akun persis untuk konfirmasi.');
  }
  const pw = await hashPassword(randomBytes(24).toString('hex'));
  const ts = nowMs();
  return sql.begin(async (tx) => {
    const biz = (
      await tx<{ id: string }[]>`SELECT DISTINCT business_id AS id FROM users WHERE account_id = ${id} AND role = 'owner' AND business_id IS NOT NULL`
    ).map((r) => r.id);
    if (biz.length) {
      // Semua (tabel, kolom) yang merujuk businesses dengan ON DELETE CASCADE — nama kolom dari katalog.
      const refs = (
        await tx<{ t: string; col: string }[]>`
          SELECT c.conrelid::regclass::text AS t, a.attname AS col FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.contype = 'f' AND c.confrelid = 'businesses'::regclass AND c.confdeltype = 'c'`
      ).filter((r) => !RETAINED.has(r.t));
      // Hapus berulang sampai tuntas (urutan FK antar-tabel toko tak perlu diketahui).
      let left = [...refs];
      for (let pass = 0; pass < 8 && left.length; pass++) {
        const next: typeof refs = [];
        for (const r of left) {
          try {
            await tx.savepoint((sp) => sp`DELETE FROM ${sp(r.t)} WHERE ${sp(r.col)} IN ${sp(biz)}`);
          } catch {
            next.push(r);
          }
        }
        left = next;
      }
      // Usulan katalog dari toko (tanpa FK) ikut dihapus.
      await tx`DELETE FROM catalog_contributions WHERE business_id IN ${tx(biz)}`;
      if (left.length) throw new Error(`Gagal menghapus data toko: ${left.map((r) => `${r.t}.${r.col}`).join(', ')}`);
      for (const b of biz) {
        // Catatan keuangan yang disimpan masih merujuk toko → baris toko dianonimkan, bukan dihapus.
        const kept = await tx`
          SELECT 1 FROM ppob_orders WHERE business_id = ${b}
          UNION ALL SELECT 1 FROM point_ledger WHERE business_id = ${b}
          UNION ALL SELECT 1 FROM point_topups WHERE business_id = ${b}
          UNION ALL SELECT 1 FROM subscription_payments WHERE business_id = ${b}
          LIMIT 1`;
        if (kept.length) {
          await tx`UPDATE businesses SET name = 'Toko dihapus', address = NULL, phone = NULL, logo_path = NULL, deleted_at = ${ts}, updated_at = ${ts} WHERE id = ${b}`;
        } else {
          await tx`DELETE FROM businesses WHERE id = ${b}`;
        }
      }
    }
    await tx`UPDATE users SET account_id = NULL, deleted_at = coalesce(deleted_at, ${ts}), updated_at = ${ts} WHERE account_id = ${id}`;
    await tx`DELETE FROM refresh_tokens WHERE account_id = ${id}`;
    await tx`DELETE FROM auth_otps WHERE account_id = ${id}`;
    await tx`DELETE FROM auth_throttle WHERE key = ${`acct:${id}`}`;
    await tx`
      UPDATE accounts SET email = ${`dihapus-${id.slice(0, 8)}@sirkopos.invalid`}, phone = NULL, name = NULL,
        password_hash = ${pw}, offline_salt = NULL, offline_hash = NULL, offline_iter = NULL,
        pending_verification = false, last_business_id = NULL, updated_at = ${ts}
      WHERE id = ${id}`;
    await tx`
      UPDATE site_leads SET status = 'done', handled_at = ${ts}, handled_by = ${admin}
      WHERE kind = 'delete_account' AND status = 'new' AND (lower(contact) = ${String(acc.email ?? '').toLowerCase()} OR contact = ${String(acc.phone ?? '')})`;
    return { stores: biz.length };
  });
}
