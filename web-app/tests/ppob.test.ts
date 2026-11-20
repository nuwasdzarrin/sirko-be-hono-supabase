import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { storeDb, deleteStoreDb } from '../src/db/db';
import { ApiError, NetworkError } from '../src/lib/api';
import { processLine, receiptName, sellPriceFor, type PpobLine, type PpobOrder } from '../src/cloud/ppob';
import { calculate, NO_CONFIG, type CartLine } from '../src/pos/calc';
import { commitSale } from '../src/pos/repo';

const line: PpobLine = { clientRef: 'ref-1', productId: 'TSEL10', category: 'pulsa', productName: 'Telkomsel 10rb', customerNo: '081234567890', cost: 10200 };
const order = (status: string, extra: Partial<PpobOrder> = {}): PpobOrder => ({ id: 'abcdef1234567890', clientRef: 'ref-1', category: 'pulsa', productName: 'Telkomsel 10rb', customerNo: '081234567890', price: 10150, status, refunded: false, sn: null, plnName: null, message: null, createdAt: 1, ...extra });

describe('PpobCheckout.process (salinan HP)', () => {
  it('sukses → di nota dengan SN & #ref; modal mengikuti order', async () => {
    const o = await processLine(line, async () => order('success', { sn: 'SN123' }));
    expect(o.kind).toBe('success');
    expect(o.line.cost).toBe(10150);
    expect(receiptName(o.line)).toBe('Telkomsel 10rb · 081234567890 · SN SN123 · #abcdef12');
  });
  it('diterima (pending) → tetap di nota bertanda DIPROSES; token PLN menyusul', async () => {
    const o = await processLine({ ...line, category: 'pln' }, async () => order('pending', { category: 'pln', plnName: 'BUDI' }));
    expect(o.kind).toBe('accepted');
    expect(receiptName(o.line)).toBe('Telkomsel 10rb · 081234567890 · a.n. BUDI · DIPROSES, token menyusul · #abcdef12');
  });
  it('gagal / 4xx → keluar nota; 5xx / jaringan / timeout → belum jelas (pending); nomor sama masih diproses', async () => {
    expect((await processLine(line, async () => order('failed'))).kind).toBe('failed');
    expect((await processLine(line, async () => { throw new ApiError(422, 'INSUFFICIENT_POINTS', 'Poin kurang'); })).kind).toBe('failed');
    expect((await processLine(line, async () => { throw new ApiError(502, 'UPSTREAM', 'x'); })).kind).toBe('pending');
    expect((await processLine(line, async () => { throw new ApiError(503, 'PPOB_UNAVAILABLE', 'mati'); })).kind).toBe('failed');
    expect((await processLine(line, async () => { throw new NetworkError('timeout'); })).kind).toBe('pending');
    const same = await processLine(line, async () => { throw new ApiError(409, 'PENDING_SAME_TARGET', 'x', { orderId: 'o9' }); });
    expect(same).toMatchObject({ kind: 'pending', orderId: 'o9' });
  });
  it('sudah punya order (bayar diulang) → tidak dikirim ulang', async () => {
    let calls = 0;
    const o = await processLine({ ...line, orderId: 'x1', status: 'success' }, async () => { calls++; return order('success'); });
    expect([o.kind, calls]).toEqual(['success', 0]);
  });
  it('harga jual otomatis = pembulatan ke atas (modal + markup), override menang', () => {
    const pr = { markups: { pulsa: 2000, data: 2000, pln: 2500 }, rounding: 500, overrides: { X: 15000 }, isDefault: false };
    const p = { id: 'TSEL10', category: 'pulsa' as const, brand: '', name: '', description: null, price: 10150, sellPrice: 0, margin: 0, customPrice: false, available: true, unavailableReason: null };
    expect(sellPriceFor(pr, p)).toBe(12500);
    expect(sellPriceFor(pr, { ...p, id: 'X' })).toBe(15000);
  });
});

describe('nota dengan item PPOB', () => {
  const BID = 'toko-ppob';
  let db = storeDb(BID);
  beforeEach(async () => {
    await deleteStoreDb(BID);
    db = storeDb(BID);
  });
  it('tanpa stok & tanpa stock_logs; productId null; laba dari modal order', async () => {
    const ppob = { ...line, orderId: 'abcdef1234567890', status: 'success', sn: 'SN1', cost: 10150 };
    const l: CartLine = { productId: '', variantId: null, nameSnapshot: receiptName(ppob), unitPrice: 12000, wholesaleTiers: [], costPriceSnapshot: 10150, qty: 1, discountType: 'nominal', discountValue: 0, availableStock: 0, ppob };
    const r = await commitSale(db, { totals: calculate([l], 'nominal', 0, NO_CONFIG), payments: [{ method: 'qris', amount: 12000 }], note: 'PPOB abcdef1234567890' });
    const items = await db.t('transaction_items').where('transactionId').equals(r.transactionId).toArray();
    expect(items[0]).toMatchObject({ productId: null, costPriceSnapshot: 10150, unitPrice: 12000, nameSnapshot: 'Telkomsel 10rb · 081234567890 · SN SN1 · #abcdef12' });
    expect(await db.t('stock_logs').count()).toBe(0);
    expect((await db.t('transactions').get(r.transactionId))!.note).toBe('PPOB abcdef1234567890');
  });
});
