import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { storeDb, deleteStoreDb, type Row } from '../src/db/db';
import {
  applyRounding, calculate, cashSuggestions, percentOf, resolvePayment, NO_CONFIG,
  type CartLine, type DiscountType, type PosConfig,
} from '../src/pos/calc';
import { billSummary, closeBill, commitSale, holdSale, openBill, resumeHeld, setSetting, voidTransaction, PosError } from '../src/pos/repo';
import { recomputeProducts, recomputeWallets } from '../src/db/ledger';

/** Vektor uji disalin dari test Dart (test/pos/*_calculator_test.dart, wholesale_calculation_test.dart). */

const line = (unitPrice: number, qty: number, discountValue = 0, discountType: DiscountType = 'nominal', extra: Partial<CartLine> = {}): CartLine => ({
  productId: 'p', nameSnapshot: 'Item', unitPrice, wholesaleTiers: [], costPriceSnapshot: 0, qty, discountType, discountValue, availableStock: 0, ...extra,
});
const cfg = (c: Partial<PosConfig> = {}): PosConfig => ({ ...NO_CONFIG, ...c });

describe('TransactionCalculator (salinan Dart)', () => {
  it('diskon item nominal / persen / clamp', () => {
    expect(calculate([line(10000, 3, 5000)], 'nominal', 0, cfg()).lineResults[0]!.lineTotal).toBe(25000);
    expect(calculate([line(10000, 3, 10, 'percent')], 'nominal', 0, cfg()).lineResults[0]!.discount).toBe(3000);
    expect(calculate([line(10000, 3, 40000)], 'nominal', 0, cfg()).lineResults[0]).toMatchObject({ discount: 30000, lineTotal: 0 });
    expect(calculate([line(10000, 3, 150, 'percent')], 'nominal', 0, cfg()).lineResults[0]!.lineTotal).toBe(0);
  });
  it('diskon transaksi & pajak', () => {
    expect(calculate([line(10000, 3)], 'nominal', 5000, cfg()).grandTotal).toBe(25000);
    expect(calculate([line(10000, 3)], 'percent', 10, cfg()).discountTotal).toBe(3000);
    expect(calculate([line(10000, 1)], 'nominal', 50000, cfg())).toMatchObject({ discountTotal: 10000, grandTotal: 0 });
    expect(calculate([line(10000, 3)], 'nominal', 0, cfg({ taxEnabled: true, taxPercent: 10 }))).toMatchObject({ taxTotal: 3000, grandTotal: 33000 });
    expect(calculate([line(10000, 3)], 'nominal', 0, cfg({ taxEnabled: true, taxPercent: 10, taxInclusive: true }))).toMatchObject({ taxTotal: 2727, grandTotal: 30000 });
    expect(calculate([line(10000, 3)], 'nominal', 0, cfg({ taxPercent: 10 })).taxTotal).toBe(0);
    expect(calculate([line(10000, 3)], 'nominal', 10000, cfg({ taxEnabled: true, taxPercent: 10 })).grandTotal).toBe(22000);
  });
  it('pembulatan setengah ke atas', () => {
    expect(applyRounding(33049, 'none')).toBe(33049);
    expect(applyRounding(33049, 'nearest100')).toBe(33000);
    expect(applyRounding(33050, 'nearest100')).toBe(33100);
    expect(applyRounding(33249, 'nearest500')).toBe(33000);
    expect(applyRounding(33250, 'nearest500')).toBe(33500);
    expect(applyRounding(33749, 'nearest500')).toBe(33500);
    expect(applyRounding(33750, 'nearest500')).toBe(34000);
    const t = calculate([line(3333, 3)], 'nominal', 0, cfg({ roundingMode: 'nearest100' }));
    expect(t).toMatchObject({ grandTotalBeforeRounding: 9999, grandTotal: 10000, roundingAdjustment: 1 });
    expect([percentOf(105, 10), percentOf(104, 10), percentOf(0, 10), percentOf(1000, 0)]).toEqual([11, 10, 0, 0]);
  });
  it('skenario gabungan §1', () => {
    const t = calculate([line(10000, 2, 2000), line(5000, 3, 10, 'percent')], 'percent', 10, cfg({ taxEnabled: true, taxPercent: 11, roundingMode: 'nearest100' }));
    expect(t).toMatchObject({ subtotal: 31500, discountTotal: 3150, taxTotal: 3119, grandTotalBeforeRounding: 31469, grandTotal: 31500, itemDiscountTotal: 3500 });
  });
  it('grosir: tier tertinggi ≤ qty, sebelum diskon item', () => {
    const tiers = [{ minQty: 5, price: 9000 }, { minQty: 10, price: 8000 }];
    const g = (qty: number, d = 0, dt: DiscountType = 'nominal') => calculate([line(10000, qty, d, dt, { wholesaleTiers: tiers })], 'nominal', 0, cfg()).lineResults[0]!;
    expect(g(3)).toMatchObject({ effectiveUnitPrice: 10000, appliedWholesale: null, lineSubtotal: 30000 });
    expect(g(7)).toMatchObject({ effectiveUnitPrice: 9000, lineSubtotal: 63000 });
    expect(g(12).lineSubtotal).toBe(96000);
    expect(g(10, 5000)).toMatchObject({ effectiveUnitPrice: 8000, discount: 5000, lineTotal: 75000 });
    expect(g(5, 10, 'percent')).toMatchObject({ discount: 4500, lineTotal: 40500 });
  });
});

describe('PaymentCalculator (salinan Dart)', () => {
  const cash = (amount: number) => ({ method: 'cash' as const, amount });
  const qris = (amount: number) => ({ method: 'qris' as const, amount });
  it('lunas / kembalian / partial / kredit', () => {
    expect(resolvePayment(33000, [cash(33000)])).toMatchObject({ status: 'paid', change: 0, remaining: 0 });
    expect(resolvePayment(33000, [cash(50000)]).change).toBe(17000);
    expect(resolvePayment(33000, [cash(10000)])).toMatchObject({ status: 'partial', remaining: 23000, change: 0 });
    expect(resolvePayment(33000, [])).toMatchObject({ status: 'credit', paidTotal: 0, remaining: 33000 });
  });
  it('kembalian HANYA dari kelebihan tunai', () => {
    expect(resolvePayment(33000, [cash(5000), qris(30000)]).change).toBe(2000);
    expect(resolvePayment(33000, [cash(2000), qris(40000)]).change).toBe(2000);
    expect(resolvePayment(33000, [cash(20000), qris(20000)]).change).toBe(7000);
    expect(resolvePayment(33000, [qris(33000)]).change).toBe(0);
  });
  it('saran uang tunai', () => {
    expect(cashSuggestions(33000)).toEqual([35000, 40000, 50000, 100000]);
    expect(cashSuggestions(50000)).toEqual([60000, 100000]);
  });
});

// ── Commit / void / shift di IndexedDB ──────────────────────────────────────

const BID = 'toko-pos';
let db = storeDb(BID);
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const V1 = '33333333-3333-4333-8333-333333333333';
const C1 = '44444444-4444-4444-8444-444444444444';
const W1 = '55555555-5555-4555-8555-555555555555';
const U1 = '66666666-6666-4666-8666-666666666666';

const base = (id: string, extra: Record<string, unknown>): Row => ({ id, createdAt: 1, updatedAt: 1, deletedAt: null, _dirty: 0, ...extra });

beforeEach(async () => {
  await deleteStoreDb(BID);
  db = storeDb(BID);
  await db.t('products').bulkPut([
    base(P1, { name: 'Indomie', sellingPrice: 3500, costPrice: 3000, stock: 10, hasVariants: false }),
    base(P2, { name: 'Kaos', sellingPrice: 50000, costPrice: 30000, stock: 0, hasVariants: true }),
  ]);
  await db.t('product_variants').put(base(V1, { productId: P2, name: 'L', sellingPrice: 55000, costPrice: 32000, stock: 2 }));
  await db.t('customers').put(base(C1, { name: 'Bu Sri', debtBalance: 1000 }));
  await db.t('wallets').put(base(W1, { name: 'Laci', type: 'cash', balance: 0 }));
  await setSetting(db, 'default_cash_wallet_id', W1, 1);
});

const cartOf = (lines: CartLine[], txd = 0) => calculate(lines, 'nominal', txd, NO_CONFIG);
const indomie = (qty: number) => line(3500, qty, 0, 'nominal', { productId: P1, nameSnapshot: 'Indomie', costPriceSnapshot: 3000 });
const kaosL = (qty: number) => line(55000, qty, 0, 'nominal', { productId: P2, variantId: V1, nameSnapshot: 'Kaos — L', costPriceSnapshot: 32000 });

describe('commitSale', () => {
  it('tunai: nota+item+bayar, stok & ledger, kas laci bersih, semua dirty', async () => {
    const r = await commitSale(db, { totals: cartOf([indomie(3), kaosL(1)]), payments: [{ method: 'cash', amount: 100000 }], cashierId: U1 });
    expect(r.invoiceNo).toMatch(/^INV-\d{8}-0001$/);
    expect(r.change).toBe(100000 - 65500);
    const tx = (await db.t('transactions').get(r.transactionId))!;
    expect(tx).toMatchObject({ status: 'paid', isCredit: false, grandTotal: 65500, paidTotal: 100000, changeTotal: 34500, cashierId: U1, _dirty: 1 });
    expect(await db.t('transaction_items').where('transactionId').equals(r.transactionId).count()).toBe(2);
    expect((await db.t('products').get(P1))!).toMatchObject({ stock: 7, _dirty: 1 });
    expect((await db.t('product_variants').get(V1))!.stock).toBe(1);
    const logs = await db.t('stock_logs').where('refId').equals(r.transactionId).toArray();
    expect(logs.map((l) => [l.type, l.qtyChange]).sort()).toEqual([['sale', -1], ['sale', -3]]);
    expect((await db.t('wallets').get(W1))!.balance).toBe(65500);
    const wt = await db.t('wallet_transactions').where('refId').equals(r.transactionId).toArray();
    expect(wt).toHaveLength(1);
    expect(wt[0]).toMatchObject({ type: 'in', amount: 65500, category: 'penjualan', refType: 'transaction' });
    // Ledger konsisten dengan saldo yang ditulis (hitung ulang tak mengubah apa pun).
    await db.t('stock_logs').put(base('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { productId: P1, variantId: null, type: 'initial', qtyChange: 10 }));
    expect(await recomputeProducts(db, [P1])).toBe(0);
    expect(await recomputeWallets(db, [W1])).toBe(0);
  });

  it('nomor invoice berurutan & melanjutkan nota hari ini yang sudah ada', async () => {
    const a = await commitSale(db, { totals: cartOf([indomie(1)]), payments: [{ method: 'qris', amount: 3500 }] });
    const ymd = a.invoiceNo.slice(4, 12);
    await db.t('transactions').put(base('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { invoiceNo: `INV-${ymd}-0007`, status: 'paid' }));
    const b = await commitSale(db, { totals: cartOf([indomie(1)]), payments: [{ method: 'qris', amount: 3500 }] });
    expect(b.invoiceNo).toBe(`INV-${ymd}-0008`);
    // Non-tunai tidak menyentuh kas.
    expect((await db.t('wallets').get(W1))!.balance).toBe(0);
  });

  it('stok kurang ditolak (kecuali allow_negative_stock) — tanpa efek samping', async () => {
    await expect(commitSale(db, { totals: cartOf([kaosL(3)]), payments: [{ method: 'cash', amount: 165000 }] })).rejects.toThrow(/tidak cukup/);
    expect(await db.t('transactions').count()).toBe(0);
    await setSetting(db, 'allow_negative_stock', 'true');
    await commitSale(db, { totals: cartOf([kaosL(3)]), payments: [{ method: 'cash', amount: 165000 }] });
    expect((await db.t('product_variants').get(V1))!.stock).toBe(-1);
  });

  it('kasbon: wajib pelanggan & izin kredit; sisa menambah hutang', async () => {
    const totals = cartOf([indomie(2)]);
    await expect(commitSale(db, { totals, payments: [{ method: 'cash', amount: 2000 }] })).rejects.toThrow(PosError);
    await expect(commitSale(db, { totals, payments: [{ method: 'cash', amount: 2000 }], allowCredit: true })).rejects.toThrow(/pelanggan/);
    const r = await commitSale(db, { totals, payments: [{ method: 'cash', amount: 2000 }], allowCredit: true, customerId: C1 });
    expect((await db.t('transactions').get(r.transactionId))!).toMatchObject({ status: 'partial', isCredit: true, paidTotal: 2000, changeTotal: 0 });
    expect((await db.t('customers').get(C1))!).toMatchObject({ debtBalance: 1000 + 5000, _dirty: 1 });
    expect((await db.t('wallets').get(W1))!.balance).toBe(2000);
  });

  it('non-tunai melebihi total ditolak', async () => {
    await expect(commitSale(db, { totals: cartOf([indomie(1)]), payments: [{ method: 'qris', amount: 5000 }] })).rejects.toThrow(/non-tunai/);
  });

  it('tanpa setting wallet → buat "Kas Utama"/pakai wallet cash pertama', async () => {
    await db.t('app_settings').clear();
    await commitSale(db, { totals: cartOf([indomie(1)]), payments: [{ method: 'cash', amount: 3500 }] });
    expect((await db.t('wallets').get(W1))!.balance).toBe(3500);
  });
});

describe('voidTransaction', () => {
  it('kembalikan stok, balik kas, kurangi hutang sisa, tandai void + soft delete', async () => {
    const r = await commitSale(db, { totals: cartOf([indomie(2), kaosL(1)]), payments: [{ method: 'cash', amount: 30000 }], allowCredit: true, customerId: C1 });
    await db.t('credit_payments').put(base('cccccccc-cccc-4ccc-8ccc-cccccccccccc', { customerId: C1, transactionId: r.transactionId, amount: 10000 }));
    const v = await voidTransaction(db, r.transactionId);
    expect(v.debtReversed).toBe(62000 - 30000 - 10000);
    expect((await db.t('products').get(P1))!.stock).toBe(10);
    expect((await db.t('product_variants').get(V1))!.stock).toBe(2);
    expect((await db.t('wallets').get(W1))!.balance).toBe(0);
    expect((await db.t('customers').get(C1))!.debtBalance).toBe(1000 + 32000 - 22000);
    const tx = (await db.t('transactions').get(r.transactionId))!;
    expect(tx.status).toBe('void');
    expect(tx.deletedAt).toBeTypeOf('number');
    const voidLogs = (await db.t('stock_logs').where('refId').equals(r.transactionId).toArray()).filter((l) => l.type === 'void');
    expect(voidLogs.map((l) => l.qtyChange).sort()).toEqual([1, 2]);
    await expect(voidTransaction(db, r.transactionId)).rejects.toThrow(/sudah dibatalkan/);
  });
});

describe('shift & tunda', () => {
  it('expectedCash = awal + tunai masuk − kembalian; selisih', async () => {
    const billId = await openBill(db, U1, 100000);
    await expect(openBill(db, U1, 0)).rejects.toThrow(/shift terbuka/);
    await commitSale(db, { totals: cartOf([indomie(2)]), payments: [{ method: 'cash', amount: 10000 }], billId });
    await commitSale(db, { totals: cartOf([indomie(1)]), payments: [{ method: 'qris', amount: 3500 }], billId });
    const s = await billSummary(db, billId);
    expect(s).toMatchObject({ cashIn: 10000, changeGiven: 3000, netCashSales: 7000, expectedCash: 107000, txCount: 2 });
    const b = await closeBill(db, billId, 106000);
    expect(b).toMatchObject({ status: 'closed', expectedCash: 107000, variance: -1000, cashSalesTotal: 7000, _dirty: 1 });
  });

  it('tunda lalu lanjutkan (lokal, tak ikut sync)', async () => {
    const snap = { lines: [indomie(2)], txDiscountType: 'nominal' as const, txDiscountValue: 0, customerId: null, note: '' };
    const before = (await db.pending()).dirty;
    const id = await holdSale(db, snap, 7000, U1);
    expect((await db.held_sales.get(id))!.label).toMatch(/^Tunda #1 • \d\d:\d\d$/);
    expect((await db.pending()).dirty).toBe(before);
    expect(await resumeHeld(db, id)).toEqual(snap);
    expect(await db.held_sales.count()).toBe(0);
  });
});
