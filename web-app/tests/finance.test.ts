import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { storeDb, deleteStoreDb, type Row } from '../src/db/db';
import { recomputeWallets } from '../src/db/ledger';
import { calculate, NO_CONFIG, type CartLine } from '../src/pos/calc';
import { commitSale, setSetting, voidTransaction } from '../src/pos/repo';
import { buildReport, employeeSummary, makeRange, toCsv, walletCashFlow } from '../src/finance/report';
import { createWallet, deleteWallet, deposit, transfer, withdraw } from '../src/finance/wallets';

const BID = 'toko-laporan';
let db = storeDb(BID);
const P = '11111111-1111-4111-8111-111111111111';
const U = '66666666-6666-4666-8666-666666666666';
const C = '44444444-4444-4444-8444-444444444444';

beforeEach(async () => {
  await deleteStoreDb(BID);
  db = storeDb(BID);
  await db.t('products').put({ id: P, createdAt: 1, updatedAt: 1, deletedAt: null, name: 'Indomie', stock: 100, _dirty: 0 });
  await db.t('customers').put({ id: C, createdAt: 1, updatedAt: 1, deletedAt: null, name: 'Budi', debtBalance: 0, _dirty: 0 });
  await db.t('users').put({ id: U, createdAt: 1, updatedAt: 1, deletedAt: null, name: 'Dewi', role: 'cashier', _dirty: 0 });
});

const line = (qty: number, discountValue = 0): CartLine => ({ productId: P, nameSnapshot: 'Indomie', unitPrice: 3500, wholesaleTiers: [], costPriceSnapshot: 3000, qty, discountType: 'nominal', discountValue, availableStock: 100 });

describe('rentang tanggal', () => {
  it('preset & custom (to eksklusif = awal hari berikutnya)', () => {
    const now = new Date(2026, 10, 20, 15, 0);
    const t = makeRange('today', now);
    expect([t.from, t.to, t.days]).toEqual([new Date(2026, 10, 20).getTime(), new Date(2026, 10, 21).getTime(), 1]);
    expect(makeRange('last7', now).days).toBe(7);
    expect(makeRange('thisMonth', now).from).toBe(new Date(2026, 10, 1).getTime());
    const c = makeRange('custom', now, { start: new Date(2026, 10, 10), end: new Date(2026, 10, 5) });
    expect([c.from, c.days]).toEqual([new Date(2026, 10, 5).getTime(), 6]);
  });
});

describe('laporan (salinan ReportRepository)', () => {
  it('omzet, laba §9, status & piutang, arus kas, produk, harian, karyawan; void diabaikan', async () => {
    const W = await createWallet(db, 'Laci', 'cash');
    await setSetting(db, 'default_cash_wallet_id', W);
    // A: 4 × 3500 diskon item 1000 → 13000, diskon transaksi 1000 → 12000, tunai 20000 (kembali 8000).
    await commitSale(db, { totals: calculate([line(4, 1000)], 'nominal', 1000, NO_CONFIG), payments: [{ method: 'cash', amount: 20000 }], cashierId: U });
    // B: 2 × 3500 = 7000, QRIS 7000.
    await commitSale(db, { totals: calculate([line(2)], 'nominal', 0, NO_CONFIG), payments: [{ method: 'qris', amount: 7000 }], cashierId: U });
    // C: kasbon 3 × 3500 = 10500, bayar 500 tunai → sisa 10000; lalu pelunasan 4000.
    await commitSale(db, { totals: calculate([line(3)], 'nominal', 0, NO_CONFIG), payments: [{ method: 'cash', amount: 500 }], customerId: C, allowCredit: true });
    const credit = (await db.t('transactions').toArray()).find((t) => t.status === 'partial')!;
    await db.t('credit_payments').put({ id: 'cp1', createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null, customerId: C, transactionId: credit.id, amount: 4000, datetime: Date.now(), method: 'cash', _dirty: 0 });
    // D: dibatalkan → tak dihitung.
    const d = await commitSale(db, { totals: calculate([line(10)], 'nominal', 0, NO_CONFIG), payments: [{ method: 'cash', amount: 35000 }] });
    await voidTransaction(db, d.transactionId);

    const r = await buildReport(db, makeRange('today'));
    expect(r.sales).toEqual({ transactionCount: 3, grossRevenue: 12000 + 7000 + 10500, itemCount: 9, averageTicket: Math.floor(29500 / 3) });
    expect(r.profit.revenue).toBe(13000 + 7000 + 10500 - 1000);
    expect(r.profit.cost).toBe(9 * 3000);
    expect(r.profit.grossProfit).toBe(29500 - 27000);
    expect(r.status).toMatchObject({ paidCount: 2, paidTotal: 19000, partialCount: 1, partialTotal: 10500, outstanding: 6000 });
    expect(r.cashFlow.salesByMethod).toEqual({ cash: 20000 - 8000 + 500, qris: 7000 });
    expect(r.cashFlow.debtPaymentsReceived).toBe(4000);
    expect(r.cashFlow.totalIn).toBe(12500 + 7000 + 4000);
    expect(r.stockFlow.qtyByType.sale).toBe(-19);
    expect(r.stockFlow.qtyByType.void).toBe(10);
    expect(r.productsSold).toEqual([{ productId: P, name: 'Indomie', qty: 9, revenue: 30500, profit: (3500 - 3000) * 9 - 1000 }]);
    expect(r.daily).toHaveLength(1);
    expect(r.daily[0]).toMatchObject({ revenue: 29500, count: 3 });

    const e = await employeeSummary(db, makeRange('today'));
    expect(e.find((x) => x.userId === U)).toMatchObject({ name: 'Dewi', count: 2, revenue: 19000, profit: 500 * 6 - 1000 - 1000 });
    expect(e.find((x) => x.userId === null)).toMatchObject({ name: 'Tanpa kasir', count: 1 });

    expect(await buildReport(db, makeRange('custom', new Date(), { start: new Date(2020, 0, 1), end: new Date(2020, 0, 2) }))).toMatchObject({ sales: { transactionCount: 0 } });
  });

  it('CSV: titik koma, kutip, BOM', () => {
    expect(toCsv([['a', 'b;c'], [1, 'x"y']])).toBe('﻿a;"b;c"\r\n1;"x""y"');
  });
});

describe('kas & dompet (salinan WalletRepository)', () => {
  it('saldo awal, setor, tarik (saldo kurang ditolak), transfer, arus kas, hapus hanya bila 0', async () => {
    const a = await createWallet(db, 'Laci', 'cash', 100000);
    const b = await createWallet(db, 'BCA', 'bank');
    await deposit(db, a, 50000, 'modal');
    await withdraw(db, a, 20000, 'operasional', 'beli plastik');
    await expect(withdraw(db, b, 1, 'x')).rejects.toThrow(/Saldo tak cukup/);
    await transfer(db, a, b, 30000);
    await expect(transfer(db, a, a, 1)).rejects.toThrow(/tidak boleh sama/);
    const bal = async (id: string) => Number((await db.t('wallets').get(id))!.balance);
    expect([await bal(a), await bal(b)]).toEqual([100000, 30000]);
    expect(await recomputeWallets(db, [a, b])).toBe(0); // saldo = Σ ledger
    const flows = await walletCashFlow(db, makeRange('today'));
    expect(flows.find((f) => f.walletId === a)).toMatchObject({ totalIn: 150000, totalOut: 20000, transferOut: 30000, net: 100000 });
    expect(flows.find((f) => f.walletId === b)).toMatchObject({ transferIn: 30000, net: 30000 });
    await expect(deleteWallet(db, b)).rejects.toThrow(/masih punya saldo/);
    await withdraw(db, b, 30000);
    await deleteWallet(db, b);
    expect(((await db.t('wallets').get(b)) as Row).deletedAt).toBeTypeOf('number');
  });
});
