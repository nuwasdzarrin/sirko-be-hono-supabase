import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { storeDb, deleteStoreDb } from '../src/db/db';
import { recomputeProducts, recomputeVariants, recomputeWallets } from '../src/db/ledger';
import { setSetting } from '../src/pos/repo';
import { createWallet } from '../src/finance/wallets';
import { createOpname, deleteSupplier, finalizeOpname, nextCost, opnameSummary, paySupplierDebt, receivePurchase, saveSupplier, setPhysical } from '../src/buy/repo';
import { push, type Call } from '../src/sync/sync';

const BID = 'toko-beli';
let db = storeDb(BID);
const P = '11111111-1111-4111-8111-111111111111';
const K = '22222222-2222-4222-8222-222222222222';
const V = '33333333-3333-4333-8333-333333333333';

beforeEach(async () => {
  await deleteStoreDb(BID);
  db = storeDb(BID);
  const base = { createdAt: 1, updatedAt: 1, deletedAt: null, _dirty: 0, isActive: true };
  await db.t('products').bulkPut([
    { id: P, ...base, name: 'Indomie', stock: 10, costPrice: 2800, hasVariants: false },
    { id: K, ...base, name: 'Kaos', stock: 0, costPrice: 0, hasVariants: true },
  ]);
  await db.t('product_variants').put({ id: V, ...base, productId: K, name: 'L', stock: 2, costPrice: 30000 });
  await db.t('stock_logs').bulkPut([
    { id: 'l1', ...base, productId: P, variantId: null, type: 'initial', qtyChange: 10 },
    { id: 'l2', ...base, productId: K, variantId: V, type: 'initial', qtyChange: 2 },
  ]);
});

describe('harga modal (CostingPolicy)', () => {
  it('last cost & rata-rata bergerak setengah ke atas', () => {
    expect(nextCost('last_cost', 10, 2800, 20, 3100)).toBe(3100);
    expect(nextCost('moving_average', 10, 2800, 20, 3100)).toBe(3000);
    expect(nextCost('moving_average', 1, 100, 2, 101)).toBe(101); // 302/3 = 100.67 → 101
    expect(nextCost('moving_average', -5, 100, 5, 200)).toBe(200);
  });
});

describe('pembelian & hutang supplier', () => {
  it('terima barang: stok & modal naik, log in, hutang supplier, bayar dari dompet', async () => {
    const s = await saveSupplier(db, null, { name: 'Agen Sembako' });
    const w = await createWallet(db, 'Laci', 'cash', 100000);
    await setSetting(db, 'costing_method', 'moving_average');
    const r = await receivePurchase(db, {
      supplierId: s, refNo: 'NOTA-1', discountTotal: 2000, paidTotal: 50000, walletId: w,
      lines: [{ productId: P, nameSnapshot: 'Indomie', qty: 20, costPrice: 3100 }, { productId: K, variantId: V, nameSnapshot: 'Kaos L', qty: 2, costPrice: 32000 }],
    });
    expect(r).toMatchObject({ status: 'partial', grandTotal: 62000 + 64000 - 2000, debtAdded: 124000 - 50000 });
    expect((await db.t('products').get(P))!).toMatchObject({ stock: 30, costPrice: 3000 });
    expect((await db.t('product_variants').get(V))!).toMatchObject({ stock: 4, costPrice: 31000 });
    expect(await recomputeProducts(db, [P])).toBe(0);
    expect(await recomputeVariants(db, [V])).toBe(0);
    expect((await db.t('suppliers').get(s))!.debtBalance).toBe(74000);
    expect((await db.t('wallets').get(w))!.balance).toBe(50000);
    expect(await recomputeWallets(db, [w])).toBe(0);
    await expect(deleteSupplier(db, s)).rejects.toThrow(/masih punya hutang/);
    await expect(paySupplierDebt(db, s, 100000, w)).rejects.toThrow(/tak cukup/); // 74.000 > saldo 50.000
    expect(await paySupplierDebt(db, s, 50000, w)).toBe(24000);
  });

  it('bayar hutang supplier dibatasi hutang; saldo dompet kurang ditolak (atomik)', async () => {
    const s = await saveSupplier(db, null, { name: 'Agen' });
    await db.t('suppliers').update(s, { debtBalance: 30000 });
    const w = await createWallet(db, 'Laci', 'cash', 10000);
    await expect(paySupplierDebt(db, s, 20000, w)).rejects.toThrow(/tak cukup/);
    expect((await db.t('suppliers').get(s))!.debtBalance).toBe(30000);
    expect(await paySupplierDebt(db, s, 99999)).toBe(0);
    await deleteSupplier(db, s);
  });

  it('kredit tanpa supplier ditolak', async () => {
    await expect(receivePurchase(db, { lines: [{ productId: P, nameSnapshot: 'Indomie', qty: 1, costPrice: 1000 }] })).rejects.toThrow(/supplier/);
  });
});

describe('stok opname', () => {
  it('draft lokal (tak di-push) → hitung → final: stok = fisik, log adjustment ref opname, item terkirim', async () => {
    const id = await createOpname(db, null, 'OP-1');
    const items = await db.t('stock_opname_items').where('opnameId').equals(id).toArray();
    expect(items.map((i) => i.nameSnapshot).sort()).toEqual(['Indomie', 'Kaos / L']);
    const sent: Record<string, unknown[]> = {};
    const call: Call = async (_m, _p, body) => {
      for (const [t, rows] of Object.entries((body as { tables: Record<string, unknown[]> }).tables)) sent[t] = [...(sent[t] ?? []), ...rows];
      return { data: { serverTime: 0, applied: {}, skipped: [], rejected: [] } as never };
    };
    await push(db, call);
    expect(sent.stock_opname_items).toBeUndefined();
    const indomie = items.find((i) => i.productId === P)!;
    await setPhysical(db, indomie.id, 7);
    // Penjualan terjadi saat opname berjalan: stok 10 → 9. Selisih dihitung terhadap stok terkini.
    await db.t('products').update(P, { stock: 9 });
    expect(await opnameSummary(db, id)).toEqual({ changed: 1, surplus: 0, shortage: 3, loss: 3 * 2800 });
    expect(await finalizeOpname(db, id)).toBe(1);
    expect((await db.t('products').get(P))!.stock).toBe(7);
    const log = (await db.t('stock_logs').toArray()).find((l) => l.refType === 'opname')!;
    expect(log).toMatchObject({ type: 'adjustment', qtyChange: -2, stockAfter: 7, refId: id });
    await push(db, call);
    expect(sent.stock_opname_items).toHaveLength(2);
    expect((sent.stock_opname_items as Array<{ physicalQty: number }>).some((i) => i.physicalQty === 7)).toBe(true);
    await expect(setPhysical(db, indomie.id, 1)).rejects.toThrow(/difinalisasi/);
  });
});
