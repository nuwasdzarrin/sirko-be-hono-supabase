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
