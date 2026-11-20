import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { storeDb, deleteStoreDb, type Row } from '../src/db/db';
import { recomputeProducts, recomputeVariants, recomputeWallets } from '../src/db/ledger';
import { verifyPin } from '../src/lib/crypto';
import { setSetting } from '../src/pos/repo';
import {
  adjustStock, barcodeOwner, createInstallmentPlan, createProduct, createVariant, deleteProduct, deleteUser, expiryStatus,
  installmentStatus, payDebt, restoreProduct, saveCustomer, saveUser, saveWholesale, splitInstallments, stockIn, updateProduct,
  updateVariant,
} from '../src/manage/repo';

const BID = 'toko-kelola';
let db = storeDb(BID);
beforeEach(async () => {
  await deleteStoreDb(BID);
  db = storeDb(BID);
});

const sumLogs = async (productId: string, variantId?: string) =>
  (await db.t('stock_logs').toArray()).filter((l) => l.productId === productId && (variantId ? l.variantId === variantId : !l.variantId)).reduce((s, l) => s + Number(l.qtyChange), 0);

describe('produk & stok (stok = Σ ledger)', () => {
  it('buat → log initial; ubah stok → log adjustment; null = stok tak disentuh', async () => {
    const id = await createProduct(db, { name: 'Indomie', costPrice: 2800, sellingPrice: 3500, stock: 40, hasVariants: false });
    expect((await db.t('products').get(id))!).toMatchObject({ stock: 40, isActive: true, needsPrice: false, _dirty: 1 });
    await updateProduct(db, id, { name: 'Indomie Goreng', costPrice: 2800, sellingPrice: 3600, stock: 35, hasVariants: false });
    await updateProduct(db, id, { name: 'Indomie Goreng', costPrice: 2800, sellingPrice: 3600, stock: null, hasVariants: false });
    expect((await db.t('products').get(id))!.stock).toBe(35);
    expect(await sumLogs(id)).toBe(35);
    const logs = (await db.t('stock_logs').toArray()).map((l) => [l.type, l.qtyChange, l.refType]);
    expect(logs).toContainEqual(['initial', 40, 'initial']);
    expect(logs).toContainEqual(['adjustment', -5, 'manual']);
    await db.t('products').update(id, { stock: 999 });
    await recomputeProducts(db, [id]);
    expect((await db.t('products').get(id))!.stock).toBe(35);
  });

  it('stok 0 tak membuat log; harga diisi melepas "perlu harga"', async () => {
    const id = await createProduct(db, { name: 'Gula', costPrice: 0, sellingPrice: 0, stock: 0, hasVariants: false });
    expect(await db.t('stock_logs').count()).toBe(0);
    await db.t('products').update(id, { needsPrice: true });
    await updateProduct(db, id, { name: 'Gula', costPrice: 0, sellingPrice: 15000, stock: null, hasVariants: false });
    expect((await db.t('products').get(id))!.needsPrice).toBe(false);
  });

  it('varian, penyesuaian, stok masuk, barcode ganda, hapus/pulihkan', async () => {
    const p = await createProduct(db, { name: 'Kaos', barcode: '111', costPrice: 0, sellingPrice: 50000, stock: 9, hasVariants: true });
    expect((await db.t('products').get(p))!.stock).toBe(0); // produk bervarian: stok di varian
    const v = await createVariant(db, p, { name: 'L', barcode: '222', sellingPrice: 55000, costPrice: 30000, stock: 4 });
    await updateVariant(db, v, { name: 'L', barcode: '222', sellingPrice: 55000, costPrice: 30000, stock: 6 });
    expect(await sumLogs(p, v)).toBe(6);
    await adjustStock(db, p, v, 2, 'rusak');
    expect((await db.t('product_variants').get(v))!.stock).toBe(2);
    await db.t('product_variants').update(v, { stock: 77 });
    await recomputeVariants(db, [v]);
    expect((await db.t('product_variants').get(v))!.stock).toBe(2);

    const q = await createProduct(db, { name: 'Teh', costPrice: 3000, sellingPrice: 4500, stock: 10, hasVariants: false });
    expect(await stockIn(db, [{ productId: q, qty: 12 }, { productId: q, qty: 0 }])).toEqual({ updated: 1, totalQty: 12 });
    expect((await db.t('products').get(q))!.stock).toBe(22);
    expect((await db.t('stock_logs').toArray()).some((l) => l.type === 'in' && l.refType === 'stock_in' && l.qtyChange === 12)).toBe(true);

    expect(await barcodeOwner(db, '111')).toBe('Kaos');
    expect(await barcodeOwner(db, '222')).toBe('Kaos — L');
    expect(await barcodeOwner(db, '111', p)).toBeNull();
    await deleteProduct(db, p);
    expect(await barcodeOwner(db, '111')).toBeNull();
    await restoreProduct(db, p);
    expect((await db.t('products').get(p))!.deletedAt).toBeNull();
  });

  it('grosir: minimal ≥ 2, harga > 0, minQty tak boleh ganda', async () => {
    const p = await createProduct(db, { name: 'Indomie', costPrice: 0, sellingPrice: 3500, stock: 0, hasVariants: false });
    await saveWholesale(db, p, { minQty: 10, price: 3200 });
    await expect(saveWholesale(db, p, { minQty: 10, price: 3100 })).rejects.toThrow(/Sudah ada/);
    await expect(saveWholesale(db, p, { minQty: 1, price: 3100 })).rejects.toThrow(/minimal/);
    expect(await db.t('wholesale_prices').count()).toBe(1);
  });

  it('kedaluwarsa', () => {
    const now = 1_000_000_000_000;
    expect(expiryStatus(null, now)).toBe('none');
    expect(expiryStatus(now - 1, now)).toBe('expired');
    expect(expiryStatus(now + 30 * 86_400_000, now)).toBe('nearExpiry');
    expect(expiryStatus(now + 31 * 86_400_000, now)).toBe('ok');
  });
});

describe('hutang & cicilan', () => {
  const W = '55555555-5555-4555-8555-555555555555';
  const tx = (id: string, datetime: number, grandTotal: number, paidTotal: number, customerId: string): Row => ({ id, createdAt: 1, updatedAt: 1, deletedAt: null, datetime, grandTotal, paidTotal, customerId, status: 'partial', _dirty: 0 });

  it('bayar tanpa nota → FIFO ke nota tertua; kelebihan tak tertaut; tunai masuk kas', async () => {
    const c = await saveCustomer(db, null, { name: 'Pak Budi', phone: '0812' });
    await db.t('customers').update(c, { debtBalance: 15000 });
    await db.t('transactions').bulkPut([tx('t-baru', 200, 20000, 10000, c), tx('t-lama', 100, 10000, 5000, c)]);
    await db.t('wallets').put({ id: W, createdAt: 1, updatedAt: 1, deletedAt: null, name: 'Laci', type: 'cash', balance: 0, _dirty: 0 });
    await setSetting(db, 'default_cash_wallet_id', W);
    const r = await payDebt(db, { customerId: c, amount: 18000, method: 'cash' });
    expect(r.newDebtBalance).toBe(0);
    const cps = await db.t('credit_payments').toArray();
    expect(cps.map((x) => [x.transactionId, x.amount]).sort()).toEqual([['t-baru', 10000], ['t-lama', 5000], [null, 3000]].sort());
    expect((await db.t('wallets').get(W))!.balance).toBe(18000);
    expect(await recomputeWallets(db, [W])).toBe(0);
  });

  it('cicilan: bagi rata (sisa di akhir), bayar cicilan menandai lunas, jadwal ulang ditolak bila berjalan', async () => {
    expect(splitInstallments(100000, 3, 0, 30).map((e) => e.amountDue)).toEqual([33333, 33333, 33334]);
    expect(splitInstallments(100000, 3, 0, 30)[2]!.dueDate).toBe(60 * 86_400_000);
    const c = await saveCustomer(db, null, { name: 'Bu Ani' });
    await db.t('customers').update(c, { debtBalance: 100000 });
    await db.t('transactions').put(tx('t1', 1, 100000, 0, c));
    const ids = await createInstallmentPlan(db, 't1', 100000, 3, Date.now() + 86_400_000, 30);
    const again = await createInstallmentPlan(db, 't1', 100000, 2, Date.now() + 86_400_000, 30);
    expect((await db.t('installments').toArray()).filter((i) => i.deletedAt == null)).toHaveLength(2);
    await payDebt(db, { customerId: c, amount: 50000, method: 'transfer', installmentId: again[0] });
    const i0 = (await db.t('installments').get(again[0]!))!;
    expect(i0).toMatchObject({ amountPaid: 50000, status: 'paid' });
    expect(installmentStatus(i0, Date.now())).toBe('paid');
    expect((await db.t('credit_payments').toArray())[0]!.transactionId).toBe('t1');
    await expect(createInstallmentPlan(db, 't1', 100000, 4, 0, 7)).rejects.toThrow(/sudah berjalan/);
    expect(ids).toHaveLength(3);
  });
});

describe('karyawan', () => {
  it('PIN di-hash (cocok dengan verifikasi HP), username unik, admin terakhir dijaga', async () => {
    const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await db.t('users').put({ id: owner, createdAt: 1, updatedAt: 1, deletedAt: null, name: 'Bu Sri', username: 'pemilik', pinHash: '!', role: 'owner', isActive: true, _dirty: 0 });
    const id = await saveUser(db, null, { name: 'Dewi', username: 'dewi', role: 'cashier', permissions: new Set(), isActive: true, pin: '123456' });
    const u = (await db.t('users').get(id))!;
    expect(await verifyPin('123456', String(u.pinHash))).toBe(true);
    expect(u.permissions).toBeNull();
    await expect(saveUser(db, null, { name: 'X', username: 'dewi', role: 'staff', permissions: new Set(), isActive: true, pin: '123456' })).rejects.toThrow(/sudah dipakai/);
    await expect(saveUser(db, null, { name: 'X', username: 'x', role: 'staff', permissions: new Set(), isActive: true, pin: '12' })).rejects.toThrow(/PIN/);
    const custom = await saveUser(db, null, { name: 'Rina', username: 'rina', role: 'custom', permissions: new Set(['transactionList', 'administrator']), isActive: true, pin: '654321' });
    expect((await db.t('users').get(custom))!.permissions).toEqual(['administrator', 'transactionList']);
    // Ubah tanpa PIN → PIN lama tetap.
    await saveUser(db, id, { name: 'Dewi K', username: 'dewi', role: 'cashier', permissions: new Set(), isActive: false, pin: '' });
    expect((await db.t('users').get(id))!).toMatchObject({ name: 'Dewi K', isActive: false, pinHash: u.pinHash });
    // Pemilik: hanya nama.
    await saveUser(db, owner, { name: 'Sri', username: 'ubah', role: 'cashier', permissions: new Set(), isActive: false, pin: '' });
    expect((await db.t('users').get(owner))!).toMatchObject({ name: 'Sri', username: 'pemilik', role: 'owner', isActive: true });
    await expect(deleteUser(db, owner)).rejects.toThrow(/pemilik/);
    await deleteUser(db, custom); // pemilik masih administrator → boleh
    expect((await db.t('users').get(custom))!.deletedAt).toBeTypeOf('number');
  });
});
