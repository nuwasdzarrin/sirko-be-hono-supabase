import { sql } from '../db/client.js';
import { nowMs } from '../lib/time.js';

/**
 * Laporan per toko untuk dashboard admin, dihitung dari data cadangan.
 * Rumus MENGIKUTI app (sirko/lib/features/reports/data/report_repository.dart)
 * agar angka dashboard = angka di HP:
 *  - transaksi dihitung bila deleted_at IS NULL & status != 'void', datetime ∈ [from, to)
 *  - Laba §9: pendapatan = Σ lineTotal − Σ diskon transaksi; HPP = Σ costPriceSnapshot·qty
 *  - kas tunai = Σ pembayaran tunai − Σ kembalian; pelunasan = credit_payments per datetime
 * Rentang hari = WIB (Asia/Jakarta).
 */

const TZ = 'Asia/Jakarta';
const DAY_MS = 86_400_000;

export interface ReportRange {
  from: string; // YYYY-MM-DD (WIB, inklusif)
  to: string; // YYYY-MM-DD (WIB, inklusif)
  preset: string; // today | 7d | 30d | month | lastmonth | year | custom
  fromMs: number;
  toMs: number; // eksklusif (awal hari setelah `to`)
}

const ymd = (ms: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
const startOfWib = (d: string) => Date.parse(`${d}T00:00:00+07:00`);
const isYmd = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(startOfWib(s));

export const REPORT_PRESETS: Array<{ key: string; label: string }> = [
  { key: 'today', label: 'Hari ini' },
  { key: '7d', label: '7 hari' },
  { key: '30d', label: '30 hari' },
  { key: 'month', label: 'Bulan ini' },
  { key: 'lastmonth', label: 'Bulan lalu' },
  { key: 'year', label: 'Tahun ini' },
];

/** Tentukan rentang dari query (`preset` atau `from`/`to`). Default: bulan ini. */
export function resolveRange(q: { preset?: string; from?: string; to?: string }, now = nowMs()): ReportRange {
  const today = ymd(now);
  const [y, m] = today.split('-').map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  let from = today;
  let to = today;
  let preset = q.preset ?? '';

  if (isYmd(q.from) && isYmd(q.to) && !q.preset) {
    [from, to] = q.from <= q.to ? [q.from, q.to] : [q.to, q.from];
    preset = 'custom';
  } else {
    switch (preset) {
      case 'today':
        break;
      case '7d':
        from = ymd(startOfWib(today) - 6 * DAY_MS);
        break;
      case '30d':
        from = ymd(startOfWib(today) - 29 * DAY_MS);
        break;
      case 'lastmonth': {
        const ly = m === 1 ? y - 1 : y;
        const lm = m === 1 ? 12 : m - 1;
        from = `${ly}-${pad(lm)}-01`;
        to = `${ly}-${pad(lm)}-${pad(lastDay(ly, lm))}`;
        break;
      }
      case 'year':
        from = `${y}-01-01`;
        break;
      default:
        preset = 'month';
        from = `${y}-${pad(m)}-01`;
    }
  }
  return { from, to, preset, fromMs: startOfWib(from), toMs: startOfWib(to) + DAY_MS };
}

export interface StoreReport {
  range: ReportRange;
  sales: { txCount: number; omzet: number; itemCount: number; avgTicket: number };
  profit: {
    grossSales: number; // Σ lineTotal
    txDiscount: number; // Σ diskon transaksi
    revenue: number; // grossSales − txDiscount
    cogs: number; // HPP
    grossProfit: number;
    marginPct: number | null;
    tax: number; // dipungut, di luar pendapatan
    rounding: number;
    itemsWithoutCost: number;
  };
  status: {
    paid: { count: number; total: number };
    partial: { count: number; total: number };
    credit: { count: number; total: number };
    outstanding: number;
    voidCount: number;
    voidTotal: number;
  };
  cashIn: { byMethod: Array<{ method: string; total: number }>; debtPayments: number; total: number };
  topProducts: Array<{ name: string; qty: number; revenue: number; profit: number }>;
  daily: Array<{ day: string; txCount: number; omzet: number; profit: number }>;
}

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

export async function getStoreReport(businessId: string, range: ReportRange): Promise<StoreReport> {
  const { fromMs, toMs } = range;
  const tx = sql`t.business_id = ${businessId} AND t.deleted_at IS NULL AND t.status <> 'void'
                 AND t.datetime >= ${fromMs} AND t.datetime < ${toMs}`;
  const item = sql`ti.business_id = ${businessId} AND ti.deleted_at IS NULL`;

  const [head, itemsAgg, statusRows, voids, methods, debt, top, daily] = await Promise.all([
    sql<Record<string, string>[]>`
      SELECT count(*) tx_count, coalesce(sum(grand_total),0) omzet, coalesce(sum(discount_total),0) disc,
             coalesce(sum(tax_total),0) tax, coalesce(sum(rounding_adjustment),0) rounding,
             coalesce(sum(change_total),0) change
      FROM transactions t WHERE ${tx}`,
    sql<Record<string, string>[]>`
      SELECT coalesce(sum(ti.qty),0) qty, coalesce(sum(ti.line_total),0) gross,
             coalesce(sum(coalesce(ti.cost_price_snapshot,0) * ti.qty),0) cogs,
             count(*) FILTER (WHERE ti.cost_price_snapshot IS NULL) no_cost
      FROM transaction_items ti JOIN transactions t ON t.id = ti.transaction_id
      WHERE ${item} AND ${tx}`,
    sql<Record<string, string>[]>`
      SELECT t.status, count(*) cnt, coalesce(sum(t.grand_total),0) total,
             coalesce(sum(greatest(t.grand_total - coalesce(t.paid_total,0) - coalesce((
               SELECT sum(cp.amount) FROM credit_payments cp
               WHERE cp.business_id = ${businessId} AND cp.transaction_id = t.id AND cp.deleted_at IS NULL),0), 0)),0) outstanding
      FROM transactions t WHERE ${tx} GROUP BY t.status`,
    sql<Record<string, string>[]>`
      SELECT count(*) cnt, coalesce(sum(grand_total),0) total FROM transactions t
      WHERE t.business_id = ${businessId} AND t.deleted_at IS NULL AND t.status = 'void'
        AND t.datetime >= ${fromMs} AND t.datetime < ${toMs}`,
    sql<{ method: string; total: string }[]>`
      SELECT p.method, coalesce(sum(p.amount),0) total
      FROM payments p JOIN transactions t ON t.id = p.transaction_id
      WHERE p.business_id = ${businessId} AND p.deleted_at IS NULL AND ${tx}
      GROUP BY p.method ORDER BY 2 DESC`,
    sql<Record<string, string>[]>`
      SELECT coalesce(sum(amount),0) total FROM credit_payments
      WHERE business_id = ${businessId} AND deleted_at IS NULL AND datetime >= ${fromMs} AND datetime < ${toMs}`,
    sql<Record<string, string>[]>`
      SELECT coalesce(ti.name_snapshot, '—') AS name, sum(ti.qty) qty, sum(ti.line_total) revenue,
             sum((ti.unit_price - coalesce(ti.cost_price_snapshot,0)) * ti.qty - coalesce(ti.discount,0)) profit
      FROM transaction_items ti JOIN transactions t ON t.id = ti.transaction_id
      WHERE ${item} AND ${tx}
      GROUP BY coalesce(ti.product_id::text, ti.name_snapshot), coalesce(ti.name_snapshot, '—')
      ORDER BY revenue DESC NULLS LAST LIMIT 10`,
    sql<Record<string, string>[]>`
      WITH d AS (
        SELECT t.id, t.grand_total, t.discount_total,
               to_char(to_timestamp(t.datetime / 1000.0) AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day
        FROM transactions t WHERE ${tx}
      ), p AS (
        SELECT ti.transaction_id, sum((ti.unit_price - coalesce(ti.cost_price_snapshot,0)) * ti.qty - coalesce(ti.discount,0)) lp
        FROM transaction_items ti WHERE ${item} GROUP BY ti.transaction_id
      )
      SELECT d.day, count(*) tx_count, coalesce(sum(d.grand_total),0) omzet,
             coalesce(sum(coalesce(p.lp,0) - coalesce(d.discount_total,0)),0) profit
      FROM d LEFT JOIN p ON p.transaction_id = d.id
      GROUP BY d.day ORDER BY d.day DESC`,
  ]);

  const h = head[0] ?? {};
  const it = itemsAgg[0] ?? {};
  const txCount = n(h.tx_count);
  const omzet = n(h.omzet);
  const grossSales = n(it.gross);
  const txDiscount = n(h.disc);
  const revenue = grossSales - txDiscount;
  const cogs = n(it.cogs);
  const grossProfit = revenue - cogs;

  const st = { paid: { count: 0, total: 0 }, partial: { count: 0, total: 0 }, credit: { count: 0, total: 0 } };
  let outstanding = 0;
  for (const r of statusRows) {
    outstanding += n(r.outstanding);
    const key = r.status as keyof typeof st;
    if (st[key]) st[key] = { count: n(r.cnt), total: n(r.total) };
  }

  const byMethod = methods.map((r) => ({
    method: r.method,
    total: n(r.total) - (r.method === 'cash' ? n(h.change) : 0),
  }));
  const debtPayments = n(debt[0]?.total);

  return {
    range,
    sales: { txCount, omzet, itemCount: n(it.qty), avgTicket: txCount ? Math.round(omzet / txCount) : 0 },
    profit: {
      grossSales,
      txDiscount,
      revenue,
      cogs,
      grossProfit,
      marginPct: revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : null,
      tax: n(h.tax),
      rounding: n(h.rounding),
      itemsWithoutCost: n(it.no_cost),
    },
    status: { ...st, outstanding, voidCount: n(voids[0]?.cnt), voidTotal: n(voids[0]?.total) },
    cashIn: {
      byMethod,
      debtPayments,
      total: byMethod.reduce((s, x) => s + x.total, 0) + debtPayments,
    },
    topProducts: top.map((r) => ({ name: r.name ?? '—', qty: n(r.qty), revenue: n(r.revenue), profit: n(r.profit) })),
    daily: daily.map((r) => ({ day: r.day ?? '', txCount: n(r.tx_count), omzet: n(r.omzet), profit: n(r.profit) })),
  };
}

// ── Detail satu transaksi ────────────────────────────────────────────────────

export interface TransactionDetail {
  tx: Record<string, unknown>;
  cashierName: string | null;
  customer: { id: string; name: string | null; phone: string | null } | null;
  items: Array<Record<string, unknown> & { variantName: string | null }>;
  payments: Record<string, unknown>[];
  installments: Record<string, unknown>[];
  creditPayments: Record<string, unknown>[];
  summary: {
    itemsProfit: number;
    profit: number;
    paidAtCheckout: number; // dibayar saat checkout, bersih kembalian
    settled: number; // pelunasan setelahnya
    outstanding: number;
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getTransactionDetail(businessId: string, txId: string): Promise<TransactionDetail | null> {
  if (!UUID_RE.test(businessId) || !UUID_RE.test(txId)) return null;
  const rows = await sql<Record<string, unknown>[]>`
    SELECT * FROM transactions WHERE business_id = ${businessId} AND id = ${txId} LIMIT 1`;
  const tx = rows[0];
  if (!tx) return null;

  const [cashier, customer, items, payments, installments, creditPayments] = await Promise.all([
    tx.cashier_id
      ? sql<{ name: string | null }[]>`SELECT name FROM users WHERE business_id = ${businessId} AND id = ${tx.cashier_id as string}`
      : Promise.resolve([]),
    tx.customer_id
      ? sql<{ id: string; name: string | null; phone: string | null }[]>`
          SELECT id, name, phone FROM customers WHERE business_id = ${businessId} AND id = ${tx.customer_id as string}`
      : Promise.resolve([]),
    sql<Record<string, unknown>[]>`
      SELECT ti.*, v.name AS variant_name FROM transaction_items ti
      LEFT JOIN product_variants v ON v.business_id = ti.business_id AND v.id = ti.variant_id
      WHERE ti.business_id = ${businessId} AND ti.transaction_id = ${txId}
      ORDER BY ti.created_at, ti.id`,
    sql<Record<string, unknown>[]>`
      SELECT * FROM payments WHERE business_id = ${businessId} AND transaction_id = ${txId}
      ORDER BY created_at, id`,
    sql<Record<string, unknown>[]>`
      SELECT * FROM installments WHERE business_id = ${businessId} AND transaction_id = ${txId}
      ORDER BY due_date, id`,
    sql<Record<string, unknown>[]>`
      SELECT * FROM credit_payments WHERE business_id = ${businessId} AND transaction_id = ${txId}
      ORDER BY datetime, id`,
  ]);

  const live = <T extends Record<string, unknown>>(r: T) => r.deleted_at === null || r.deleted_at === undefined;
  const itemsProfit = items
    .filter(live)
    .reduce((s, r) => s + (n(r.unit_price) - n(r.cost_price_snapshot)) * n(r.qty) - n(r.discount), 0);
  const settled = creditPayments.filter(live).reduce((s, r) => s + n(r.amount), 0);
  const grand = n(tx.grand_total);
  const paid = n(tx.paid_total);

  return {
    tx,
    cashierName: cashier[0]?.name ?? null,
    customer: customer[0] ?? null,
    items: items.map((r) => ({ ...r, variantName: (r.variant_name as string | null) ?? null })),
    payments,
    installments,
    creditPayments,
    summary: {
      itemsProfit,
      profit: itemsProfit - n(tx.discount_total),
      paidAtCheckout: Math.min(paid - n(tx.change_total), grand),
      settled,
      outstanding: Math.max(grand - paid - settled, 0),
    },
  };
}
