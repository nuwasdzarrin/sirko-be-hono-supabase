import type { Row, StoreDb } from '../db/db';
import type { PaymentMethod } from '../pos/calc';

/**
 * Laporan — salinan ReportRepository (lib/features/reports/data/report_repository.dart) +
 * WalletRepository.cashFlow, dihitung dari data toko di browser (seperti HP menghitung dari
 * SQLite lokal; tetap jalan offline). Filter nota: tak terhapus, bukan void, datetime ∈ [from, to).
 */

export type Preset = 'today' | 'last7' | 'last30' | 'thisMonth' | 'custom';

export interface DateRange {
  preset: Preset;
  /** Awal hari pertama (lokal). */
  from: number;
  /** Awal hari SETELAH hari terakhir (eksklusif). */
  to: number;
  days: number;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const addDays = (ms: number, n: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
};

export function makeRange(preset: Preset, now = new Date(), custom?: { start: Date; end: Date }): DateRange {
  const today = startOfDay(now);
  let from = today;
  let last = today;
  if (preset === 'last7') from = addDays(today, -6);
  else if (preset === 'last30') from = addDays(today, -29);
  else if (preset === 'thisMonth') from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  else if (preset === 'custom' && custom) {
    from = startOfDay(custom.start);
    last = startOfDay(custom.end);
    if (last < from) [from, last] = [last, from];
  }
  const to = addDays(last, 1);
  return { preset, from, to, days: Math.round((to - from) / 86_400_000) };
}

export interface ReportBundle {
  range: DateRange;
  sales: { transactionCount: number; grossRevenue: number; itemCount: number; averageTicket: number };
  profit: { revenue: number; cost: number; grossProfit: number; marginPercent: number };
  status: { paidCount: number; paidTotal: number; partialCount: number; partialTotal: number; creditCount: number; creditTotal: number; outstanding: number };
  cashFlow: { salesByMethod: Partial<Record<PaymentMethod, number>>; debtPaymentsReceived: number; salesTotal: number; totalIn: number };
  stockFlow: { qtyByType: Record<string, number>; entryCount: number };
  productsSold: Array<{ productId: string | null; name: string; qty: number; revenue: number; profit: number }>;
  daily: Array<{ day: number; revenue: number; count: number }>;
}

const n = (v: unknown) => Number(v ?? 0);

/** Nota dalam rentang (sama dengan `_txFilter`). */
export async function txInRange(db: StoreDb, r: DateRange): Promise<Row[]> {
  return (await db.t('transactions').where('datetime').between(r.from, r.to, true, false).toArray()).filter((t) => t.deletedAt == null && t.status !== 'void');
}

async function itemsOf(db: StoreDb, txs: Row[]): Promise<Map<string, Row[]>> {
  const ids = txs.map((t) => t.id);
  const items = ids.length ? await db.t('transaction_items').where('transactionId').anyOf(ids).toArray() : [];
  const m = new Map<string, Row[]>();
  for (const it of items) m.set(String(it.transactionId), [...(m.get(String(it.transactionId)) ?? []), it]);
  return m;
}

export async function buildReport(db: StoreDb, r: DateRange): Promise<ReportBundle> {
  const txs = await txInRange(db, r);
  const items = await itemsOf(db, txs);
  const allItems = [...items.values()].flat();

  // Penjualan
  const grossRevenue = txs.reduce((s, t) => s + n(t.grandTotal), 0);
  const itemCount = allItems.reduce((s, i) => s + n(i.qty), 0);

  // Laba §9: pendapatan = Σ lineTotal − Σ diskon transaksi; HPP = Σ modal·qty.
  const lineRevenue = allItems.reduce((s, i) => s + n(i.lineTotal), 0);
  const txDiscount = txs.reduce((s, t) => s + n(t.discountTotal), 0);
  const cost = allItems.reduce((s, i) => s + n(i.costPriceSnapshot) * n(i.qty), 0);
  const revenue = lineRevenue - txDiscount;

  // Status + piutang sisa (total − dibayar − pelunasan tertaut).
  const status = { paidCount: 0, paidTotal: 0, partialCount: 0, partialTotal: 0, creditCount: 0, creditTotal: 0, outstanding: 0 };
  const credTx = txs.filter((t) => t.status === 'credit' || t.status === 'partial');
  const cps = credTx.length ? await db.t('credit_payments').where('transactionId').anyOf(credTx.map((t) => t.id)).toArray() : [];
  const paidByTx = new Map<string, number>();
  for (const c of cps) if (c.deletedAt == null) paidByTx.set(String(c.transactionId), (paidByTx.get(String(c.transactionId)) ?? 0) + n(c.amount));
  for (const t of txs) {
    const g = n(t.grandTotal);
    if (t.status === 'paid') {
      status.paidCount++;
      status.paidTotal += g;
    } else if (t.status === 'partial' || t.status === 'credit') {
      if (t.status === 'partial') {
        status.partialCount++;
        status.partialTotal += g;
      } else {
        status.creditCount++;
        status.creditTotal += g;
      }
      status.outstanding += Math.max(g - n(t.paidTotal) - (paidByTx.get(t.id) ?? 0), 0);
    }
  }

  // Arus kas: pembayaran per metode (tunai − kembalian) + pelunasan hutang dalam rentang.
  const salesByMethod: Partial<Record<PaymentMethod, number>> = {};
  const pays = txs.length ? await db.t('payments').where('transactionId').anyOf(txs.map((t) => t.id)).toArray() : [];
  for (const p of pays) salesByMethod[p.method as PaymentMethod] = (salesByMethod[p.method as PaymentMethod] ?? 0) + n(p.amount);
  if (salesByMethod.cash != null) salesByMethod.cash -= txs.reduce((s, t) => s + n(t.changeTotal), 0);
  const debtPaymentsReceived = (await db.t('credit_payments').toArray())
    .filter((c) => c.deletedAt == null && n(c.datetime) >= r.from && n(c.datetime) < r.to)
    .reduce((s, c) => s + n(c.amount), 0);
  const salesTotal = Object.values(salesByMethod).reduce((s, v) => s + (v ?? 0), 0);

  // Mutasi stok per jenis (berdasarkan createdAt log).
  const qtyByType: Record<string, number> = {};
  let entryCount = 0;
  await db.t('stock_logs').each((l) => {
    if (l.deletedAt != null || n(l.createdAt) < r.from || n(l.createdAt) >= r.to) return;
    qtyByType[String(l.type)] = (qtyByType[String(l.type)] ?? 0) + n(l.qtyChange);
    entryCount++;
  });

  // Produk terjual (dikelompokkan per nama snapshot), urut qty lalu omzet.
  const prod = new Map<string, { productId: string | null; name: string; qty: number; revenue: number; profit: number }>();
  for (const i of allItems) {
    const k = String(i.nameSnapshot);
    const cur = prod.get(k) ?? { productId: (i.productId as string) ?? null, name: k, qty: 0, revenue: 0, profit: 0 };
    cur.qty += n(i.qty);
    cur.revenue += n(i.lineTotal);
    cur.profit += (n(i.unitPrice) - n(i.costPriceSnapshot)) * n(i.qty) - n(i.discount);
    prod.set(k, cur);
  }
  const productsSold = [...prod.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);

  // Omzet harian (setiap hari dalam rentang, termasuk hari kosong).
  const daily: ReportBundle['daily'] = [];
  for (let d = r.from; d < r.to; d = addDays(d, 1)) daily.push({ day: d, revenue: 0, count: 0 });
  for (const t of txs) {
    const day = startOfDay(new Date(n(t.datetime)));
    const pt = daily.find((x) => x.day === day);
    if (pt) {
      pt.revenue += n(t.grandTotal);
      pt.count++;
    }
  }

  return {
    range: r,
    sales: { transactionCount: txs.length, grossRevenue, itemCount, averageTicket: txs.length ? Math.floor(grossRevenue / txs.length) : 0 },
    profit: { revenue, cost, grossProfit: revenue - cost, marginPercent: revenue ? ((revenue - cost) * 100) / revenue : 0 },
    status,
    cashFlow: { salesByMethod, debtPaymentsReceived, salesTotal, totalIn: salesTotal + debtPaymentsReceived },
    stockFlow: { qtyByType, entryCount },
    productsSold,
    daily,
  };
}

export interface EmployeeRow {
  userId: string | null;
  name: string;
  count: number;
  revenue: number;
  profit: number;
}

/** Ringkasan per kasir: laba = Σ laba item − diskon transaksi kasir itu (§9). */
export async function employeeSummary(db: StoreDb, r: DateRange): Promise<EmployeeRow[]> {
  const txs = await txInRange(db, r);
  const items = await itemsOf(db, txs);
  const users = new Map((await db.t('users').toArray()).map((u) => [u.id, String(u.name)]));
  const m = new Map<string | null, EmployeeRow>();
  for (const t of txs) {
    const uid = (t.cashierId as string) ?? null;
    const row = m.get(uid) ?? { userId: uid, name: (uid && users.get(uid)) || 'Tanpa kasir', count: 0, revenue: 0, profit: 0 };
    row.count++;
    row.revenue += n(t.grandTotal);
    row.profit -= n(t.discountTotal);
    for (const i of items.get(t.id) ?? []) row.profit += (n(i.unitPrice) - n(i.costPriceSnapshot)) * n(i.qty) - n(i.discount);
    m.set(uid, row);
  }
  return [...m.values()].sort((a, b) => b.revenue - a.revenue);
}

export interface WalletFlow {
  walletId: string;
  name: string;
  type: string;
  balance: number;
  totalIn: number;
  totalOut: number;
  transferIn: number;
  transferOut: number;
  net: number;
}

/** Arus kas per wallet dalam rentang (WalletRepository.cashFlow). */
export async function walletCashFlow(db: StoreDb, r: DateRange): Promise<WalletFlow[]> {
  const wallets = (await db.t('wallets').toArray()).filter((w) => w.deletedAt == null).sort((a, b) => n(a.createdAt) - n(b.createdAt));
  const muts = (await db.t('wallet_transactions').toArray()).filter((x) => x.deletedAt == null && n(x.datetime) >= r.from && n(x.datetime) < r.to);
  return wallets.map((w) => {
    const own = muts.filter((x) => x.walletId === w.id);
    const sum = (rows: Row[]) => rows.reduce((s, x) => s + n(x.amount), 0);
    const f = {
      walletId: w.id,
      name: String(w.name),
      type: String(w.type),
      balance: n(w.balance),
      totalIn: sum(own.filter((x) => x.type === 'in')),
      totalOut: sum(own.filter((x) => x.type === 'out')),
      transferOut: sum(own.filter((x) => x.type === 'transfer')),
      transferIn: sum(muts.filter((x) => x.type === 'transfer' && x.targetWalletId === w.id)),
      net: 0,
    };
    f.net = f.totalIn + f.transferIn - (f.totalOut + f.transferOut);
    return f;
  });
}

/** CSV (pemisah ; agar Excel berbahasa Indonesia langsung rapi) + BOM UTF-8. */
export function toCsv(rows: Array<Array<string | number>>): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
}

export function download(filename: string, content: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
