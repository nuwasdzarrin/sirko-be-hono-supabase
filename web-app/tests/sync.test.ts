import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { storeDb, deleteStoreDb, type Row } from '../src/db/db';
import { applyPulled, pull, push, type Call } from '../src/sync/sync';

/** Mesin sync terhadap server palsu yang meniru /v1/backup/push & /pull. */

const BID = 'toko-uji';
let db = storeDb(BID);

beforeEach(async () => {
  await deleteStoreDb(BID);
  db = storeDb(BID);
});

const prod = (id: string, updatedAt: number, extra: Record<string, unknown> = {}): Row => ({ id, updatedAt, deletedAt: null, name: `P ${id}`, stock: 0, ...extra });
const log = (id: string, productId: string, qtyChange: number, extra: Record<string, unknown> = {}): Row => ({ id, updatedAt: 1, deletedAt: null, productId, variantId: null, type: 'sale', qtyChange, ...extra });

describe('pull', () => {
  it('LWW: remote lebih baru menimpa; lokal belum di-push yang lebih baru dipertahankan', async () => {
    await db.t('products').bulkPut([prod('a', 100, { _dirty: 0 }), prod('b', 300, { name: 'lokal', _dirty: 1 })]);
    await applyPulled(db, { products: [prod('a', 200, { name: 'remote' }), prod('b', 250, { name: 'remote' }), prod('c', 50)] });
    expect((await db.t('products').get('a'))!.name).toBe('remote');
    expect((await db.t('products').get('b'))!).toMatchObject({ name: 'lokal', _dirty: 1 });
    expect((await db.t('products').get('c'))!._dirty).toBe(0);
  });

  it('stok & saldo dihitung ulang dari ledger (tidak ditandai dirty)', async () => {
    await applyPulled(db, {
      products: [prod('p', 1, { stock: 999 })],
      stock_logs: [log('l1', 'p', 10, { type: 'initial' }), log('l2', 'p', -3), log('l3', 'p', -2, { deletedAt: 5 })],
      wallets: [{ id: 'w1', updatedAt: 1, deletedAt: null, name: 'Laci', balance: 0, type: 'cash' }, { id: 'w2', updatedAt: 1, deletedAt: null, name: 'Bank', balance: 0, type: 'bank' }],
      wallet_transactions: [
        { id: 't1', updatedAt: 1, deletedAt: null, walletId: 'w1', type: 'in', amount: 50_000 },
        { id: 't2', updatedAt: 1, deletedAt: null, walletId: 'w1', type: 'out', amount: 5_000 },
        { id: 't3', updatedAt: 1, deletedAt: null, walletId: 'w1', targetWalletId: 'w2', type: 'transfer', amount: 20_000 },
      ],
    });
    expect((await db.t('products').get('p'))!).toMatchObject({ stock: 7, _dirty: 0 });
    expect((await db.t('wallets').get('w1'))!.balance).toBe(25_000);
    expect((await db.t('wallets').get('w2'))!.balance).toBe(20_000);
  });

  it('dua kasir offline menjual barang sama → stok konvergen', async () => {
    await applyPulled(db, { products: [prod('p', 1)], stock_logs: [log('i', 'p', 5, { type: 'initial' })] });
    await db.t('stock_logs').put({ ...log('lokal', 'p', -1), _dirty: 1 });
    await applyPulled(db, { stock_logs: [log('lain', 'p', -2)] });
    expect((await db.t('products').get('p'))!.stock).toBe(2); // 5 − 1 (lokal) − 2 (kasir lain)
  });

  it('kursor disimpan & halaman diikuti sampai habis', async () => {
    const pages = [
      { data: { serverTime: 1, tables: { products: [prod('x', 1)] } }, meta: { nextCursor: 'c1', hasMore: true } },
      { data: { serverTime: 2, tables: { products: [prod('y', 1)] } }, meta: { nextCursor: 'c2', hasMore: false } },
    ];
    const seen: string[] = [];
    const call = (async (_m: string, path: string) => {
      seen.push(path);
      return pages.shift()!;
    }) as Call;
    expect(await pull(db, call)).toBe(2);
    expect(seen[1]).toContain('cursor=c1');
    expect(await db.meta('syncCursor')).toBe('c2');
  });
});

describe('push', () => {
  it('kirim dirty, bersihkan yang diterima/STALE, parkir yang ditolak, sisakan yang diubah lagi', async () => {
    await db.t('products').bulkPut([prod('ok', 10, { _dirty: 1 }), prod('stale', 10, { _dirty: 1 }), prod('bad', 10, { _dirty: 1 }), prod('clean', 10, { _dirty: 0 })]);
    let body: any;
    const call = (async (_m: string, _p: string, b: unknown) => {
      body = b;
      // Saat request "di jalan", produk 'ok' diubah lagi oleh kasir.
      await db.t('products').update('ok', { updatedAt: 11, name: 'diubah' });
      return { data: { serverTime: 1, applied: { products: 1 }, skipped: [{ table: 'products', id: 'stale', reason: 'STALE' }], rejected: [{ table: 'products', id: 'bad', code: 'VALIDATION', message: 'harga minus' }] } };
    }) as Call;
    const r = await push(db, call);
    expect(Object.keys(body.tables)).toEqual(['products']);
    expect(body.tables.products.map((p: Row) => p.id).sort()).toEqual(['bad', 'ok', 'stale']);
    expect(body.tables.products[0]).not.toHaveProperty('_dirty');
    expect(body.clientInfo).toMatchObject({ appVersion: 'web-0.1.0', schemaVersion: 10 });
    expect(r).toEqual({ sent: 2, rejected: 1 });
    expect((await db.t('products').get('ok'))!._dirty).toBe(1); // berubah lagi → push berikutnya
    expect((await db.t('products').get('stale'))!._dirty).toBe(0);
    expect((await db.t('products').get('bad'))!).toMatchObject({ _dirty: 2, _syncError: 'VALIDATION: harga minus' });
    expect(await db.pending()).toEqual({ dirty: 1, rejected: 1 });
  });

  it('tanpa perubahan → tidak memanggil server', async () => {
    let calls = 0;
    await push(db, (async () => {
      calls++;
      return { data: {} };
    }) as Call);
    expect(calls).toBe(0);
  });
});
