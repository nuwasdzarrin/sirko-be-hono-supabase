import { sql as defaultSql, type Sql } from '../db/client.js';
import { nowMs } from '../lib/time.js';

/**
 * PlanService — paket efektif sebuah AKUN (JURAGAN.md K6/K7, §3.2).
 *
 * Paket = `juragan` bila ada `subscriptions` dengan `starts_at <= now < ends_at`,
 * selain itu `warung`. Tidak disimpan sebagai kolom (tak bisa basi). Server =
 * sumber kebenaran; app meng-cache objek ini untuk keputusan offline.
 */

export const PLAN_FEATURES = ['multi_store', 'staff', 'advanced_reports', 'receipt_branding'] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];
export type PlanPeriod = 'monthly' | 'yearly';

const DEFAULT_JURAGAN_MAX_STORES = 3;

export interface EffectivePlan {
  name: 'warung' | 'juragan';
  period: PlanPeriod | null;
  /** Akhir rantai langganan yang bersambung (epoch ms); null untuk warung. */
  expiresAt: number | null;
  maxStores: number;
  features: PlanFeature[];
  /** Jangkar jam untuk app saat offline (K7). */
  serverTime: number;
}

export function warungPlan(now = nowMs()): EffectivePlan {
  return { name: 'warung', period: null, expiresAt: null, maxStores: 1, features: [], serverTime: now };
}

interface SubRow {
  period: PlanPeriod;
  starts_at: string;
  ends_at: string;
}

/**
 * Paket efektif akun pada `now`. `accountId` null (mis. user tanpa login cloud)
 * → warung. Perpanjangan disambung dari `ends_at` sebelumnya, jadi `expiresAt`
 * = ujung rantai baris yang saling menyambung mulai dari baris aktif.
 */
export async function effective(
  accountId: string | null,
  now = nowMs(),
  client: Sql = defaultSql,
): Promise<EffectivePlan> {
  if (!accountId) return warungPlan(now);
  const rows = await client<SubRow[]>`
    SELECT period, starts_at, ends_at FROM subscriptions
    WHERE account_id = ${accountId} AND plan = 'juragan' AND ends_at > ${now}
    ORDER BY starts_at, ends_at`;
  const subs = rows.map((r) => ({ period: r.period, start: Number(r.starts_at), end: Number(r.ends_at) }));
  const active = subs.find((s) => s.start <= now && now < s.end);
  if (!active) return warungPlan(now);

  let expiresAt = active.end;
  for (const s of subs) if (s.start <= expiresAt && s.end > expiresAt) expiresAt = s.end;

  const price = await client<{ max_stores: number }[]>`
    SELECT max_stores FROM plan_prices WHERE plan = 'juragan' AND period = ${active.period}`;
  return {
    name: 'juragan',
    period: active.period,
    expiresAt,
    maxStores: price[0]?.max_stores ?? DEFAULT_JURAGAN_MAX_STORES,
    features: [...PLAN_FEATURES],
    serverTime: now,
  };
}

export function hasFeature(plan: EffectivePlan, feature: PlanFeature): boolean {
  return plan.features.includes(feature);
}

/** account_id pemilik user (baris users) — token hanya membawa userId. */
export async function accountIdOfUser(userId: string, client: Sql = defaultSql): Promise<string | null> {
  const rows = await client<{ account_id: string | null }[]>`
    SELECT account_id FROM users WHERE id = ${userId} AND deleted_at IS NULL LIMIT 1`;
  return rows[0]?.account_id ?? null;
}
