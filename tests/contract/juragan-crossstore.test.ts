import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { uuid } from '../../src/lib/uuid.js';
import { req, register, makeJuragan } from './juragan-helpers.js';

/**
 * Contract test fitur lintas-toko Juragan (JURAGAN.md §3.5, §6): laporan
 * gabungan, salin produk, mutasi stok. Butuh Postgres; skip bila tak tersambung.
 */

let dbUp = false;
try {
  await sql`SELECT 1`;
  dbUp = true;
} catch (err) {
  console.warn(`[contract] DB tak tersambung — suite di-skip: ${(err as Error).message}`);
}
const suite = dbUp ? describe : describe.skip;

const T = Date.parse('2026-10-15T10:00:00+07:00');

async function ledger(businessId: string, productId: string, variantId: string | null = null) {
  const [r] = await sql<{ v: string }[]>`
    SELECT coalesce(sum(qty_change), 0) v FROM stock_logs
    WHERE business_id = ${businessId} AND product_id = ${productId} AND deleted_at IS NULL
      AND ${variantId ? sql`variant_id = ${variantId}` : sql`variant_id IS NULL`}`;
  return Number(r!.v);
}

suite('Juragan — fitur lintas-toko', () => {
  // Akun A (Juragan) punya toko utama S1 + cabang S2; akun B punya toko X.
  let A: Awaited<ReturnType<typeof register>>;
  let s2Token = '';
  let s2 = '';
  let B: Awaited<ReturnType<typeof register>>;
  const cat = uuid();
  const unit = uuid();
  const kopi = uuid();
  const teh = uuid();
  const tehVar = uuid();

  beforeAll(async () => {
    await runMigrations(sql);
    A = await register('jx');
    B = await register('jx');
    await makeJuragan(A.token);
    const c = await req('POST', '/v1/businesses', { name: 'Cabang Pasar' }, A.token);
    s2 = c.json.data.business.id;
    s2Token = c.json.data.accessToken;

    // Data toko S1: master + stok awal + 2 nota (1 lunas, 1 hutang sebagian) + kas.
    const tx1 = uuid();
    const tx2 = uuid();
    const wallet = uuid();
    await req('POST', '/v1/backup/push', {
      tables: {
        categories: [{ id: cat, name: 'Minuman', color: '#0af', updatedAt: T }],
        units: [{ id: unit, name: 'Sachet', updatedAt: T }],
        products: [
          { id: kopi, name: 'Kopi Kapal Api', barcode: '8991002101234', categoryId: cat, unitId: unit, costPrice: 1200, sellingPrice: 1500, stock: 10, updatedAt: T },
          { id: teh, name: 'Teh Gelas', barcode: '8996001600269', categoryId: cat, costPrice: 800, sellingPrice: 1000, stock: 5, hasVariants: true, updatedAt: T },
        ],
        product_variants: [{ id: tehVar, productId: teh, name: 'Jumbo', sellingPrice: 2000, costPrice: 1500, stock: 7, updatedAt: T }],
        wholesale_prices: [{ id: uuid(), productId: kopi, minQty: 10, price: 1400, updatedAt: T }],
        stock_logs: [
          { id: uuid(), productId: kopi, type: 'initial', qtyChange: 10, stockAfter: 10, updatedAt: T },
          { id: uuid(), productId: teh, variantId: tehVar, type: 'initial', qtyChange: 7, stockAfter: 7, updatedAt: T },
        ],
        transactions: [
          { id: tx1, invoiceNo: 'A-1', datetime: T, subtotal: 3000, discountTotal: 0, grandTotal: 3000, paidTotal: 3000, changeTotal: 0, status: 'paid', updatedAt: T },
          { id: tx2, invoiceNo: 'A-2', datetime: T, subtotal: 4500, discountTotal: 500, grandTotal: 4000, paidTotal: 1000, changeTotal: 0, status: 'partial', isCredit: true, updatedAt: T },
        ],
        transaction_items: [
          { id: uuid(), transactionId: tx1, productId: kopi, nameSnapshot: 'Kopi', qty: 2, unitPrice: 1500, costPriceSnapshot: 1200, discount: 0, lineTotal: 3000, updatedAt: T },
          { id: uuid(), transactionId: tx2, productId: kopi, nameSnapshot: 'Kopi', qty: 3, unitPrice: 1500, costPriceSnapshot: 1200, discount: 0, lineTotal: 4500, updatedAt: T },
        ],
        credit_payments: [{ id: uuid(), transactionId: tx2, amount: 1000, datetime: T + 1000, method: 'cash', updatedAt: T }],
        wallets: [{ id: wallet, name: 'Laci', type: 'cash', updatedAt: T }],
        wallet_transactions: [
          { id: uuid(), walletId: wallet, type: 'in', amount: 50000, datetime: T, updatedAt: T },
          { id: uuid(), walletId: wallet, type: 'out', amount: 5000, datetime: T, updatedAt: T },
        ],
      },
    }, A.token);
    // Toko S2: kategori "minuman" (beda huruf) sudah ada + 1 nota.
    await req('POST', '/v1/backup/push', {
      tables: {
        categories: [{ id: uuid(), name: 'minuman', updatedAt: T }],
        transactions: [{ id: uuid(), invoiceNo: 'B-1', datetime: T, subtotal: 10000, discountTotal: 0, grandTotal: 10000, paidTotal: 10000, status: 'paid', updatedAt: T }],
      },
    }, s2Token);
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('warung → PLAN_REQUIRED; toko orang lain → FORBIDDEN', async () => {
    for (const [m, p, body] of [
      ['GET', '/v1/juragan/reports/summary', undefined],
      ['POST', '/v1/juragan/copy-products', { fromBusinessId: B.businessId, toBusinessId: uuid(), productIds: [uuid()] }],
      ['POST', '/v1/juragan/stock-transfers', { fromBusinessId: B.businessId, toBusinessId: uuid(), lines: [{ productId: uuid(), toProductId: uuid(), qty: 1 }] }],
    ] as const) {
      const r = await req(m, p, body, B.token);
      expect(r.status).toBe(403);
      expect(r.json.error.code).toBe('PLAN_REQUIRED');
    }
    const foreign = await req('POST', '/v1/juragan/copy-products', { fromBusinessId: A.businessId, toBusinessId: B.businessId, productIds: [kopi] }, A.token);
    expect(foreign.status).toBe(403);
    expect(foreign.json.error.code).toBe('FORBIDDEN');
    const same = await req('POST', '/v1/juragan/copy-products', { fromBusinessId: A.businessId, toBusinessId: A.businessId, productIds: [kopi] }, A.token);
    expect(same.json.error.code).toBe('VALIDATION');
  });

  it('laporan gabungan: per toko milik akun + total; laba §9, kasbon & kas dari ledger', async () => {
    const r = await req('GET', '/v1/juragan/reports/summary?from=2026-10-01&to=2026-10-31', undefined, A.token);
    expect(r.status).toBe(200);
    const d = r.json.data;
    expect(d.range).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(d.stores.map((s: { businessId: string }) => s.businessId).sort()).toEqual([A.businessId, s2].sort());
    const s1 = d.stores.find((s: { businessId: string }) => s.businessId === A.businessId);
    // Omzet 3000 + 4000; pendapatan 7500 − 500 = 7000; HPP 5 × 1200 = 6000.
    expect(s1).toMatchObject({ txCount: 2, omzet: 7000, revenue: 7000, cogs: 6000, grossProfit: 1000, receivables: 2000, cashBalance: 45000 });
    const c2 = d.stores.find((s: { businessId: string }) => s.businessId === s2);
    expect(c2).toMatchObject({ name: 'Cabang Pasar', txCount: 1, omzet: 10000, receivables: 0, cashBalance: 0 });
    expect(d.total).toMatchObject({ txCount: 3, omzet: 17000, receivables: 2000, cashBalance: 45000 });
    expect(d.plan.name).toBe('juragan');
    // Tak ada toko akun lain di laporan.
    expect(JSON.stringify(d)).not.toContain(B.businessId);
  });

  let kopiS2 = '';
  it('salin produk: UUID baru, stok 0, varian & grosir ikut, kategori dicocokkan per nama; barcode ganda dilewati', async () => {
    const ghost = uuid();
    const r = await req('POST', '/v1/juragan/copy-products', { fromBusinessId: A.businessId, toBusinessId: s2, productIds: [kopi, teh, ghost] }, A.token);
    expect(r.status).toBe(201);
    const d = r.json.data;
    expect(d.copied).toHaveLength(2);
    expect(d.skipped).toEqual([{ fromProductId: ghost, reason: 'NOT_FOUND' }]);
    expect(d.createdCategories).toBe(0); // "Minuman" = "minuman" di S2
    expect(d.createdUnits).toBe(1);

    kopiS2 = d.copied.find((x: { fromProductId: string }) => x.fromProductId === kopi).toProductId;
    const tehCopy = d.copied.find((x: { fromProductId: string }) => x.fromProductId === teh);
    expect(kopiS2).not.toBe(kopi);
    expect(tehCopy.variants).toHaveLength(1);
    expect(tehCopy.variants[0].toVariantId).not.toBe(tehVar);

    // Toko tujuan menarik produk baru lewat sync biasa; stok 0, harga ikut.
    const pull = await req('GET', '/v1/backup/pull?limit=500', undefined, s2Token);
    const p = pull.json.data.tables.products.find((x: { id: string }) => x.id === kopiS2);
    expect(p).toMatchObject({ name: 'Kopi Kapal Api', stock: 0, sellingPrice: 1500, costPrice: 1200, barcode: '8991002101234' });
    const s2cat = pull.json.data.tables.categories.find((x: { name: string }) => x.name === 'minuman');
    expect(p.categoryId).toBe(s2cat.id);
    expect(pull.json.data.tables.wholesale_prices.some((w: { productId: string }) => w.productId === kopiS2)).toBe(true);
    expect(pull.json.data.tables.product_variants.some((v: { id: string }) => v.id === tehCopy.variants[0].toVariantId)).toBe(true);
    expect(await ledger(s2, kopiS2)).toBe(0);
    // Baris asal tak tersentuh.
    const [src] = await sql<{ business_id: string }[]>`SELECT business_id FROM products WHERE id = ${kopi}`;
    expect(src!.business_id).toBe(A.businessId);

    // Salin ulang → barcode sudah ada di tujuan → dilewati + id produk yang ada.
    const again = await req('POST', '/v1/juragan/copy-products', { fromBusinessId: A.businessId, toBusinessId: s2, productIds: [kopi] }, A.token);
    expect(again.json.data).toMatchObject({ copied: [], skipped: [{ fromProductId: kopi, reason: 'BARCODE_EXISTS', existingProductId: kopiS2 }] });
  });

  it('mutasi stok: ledger asal turun & tujuan naik (ref store_transfer); products.updated_at tetap; stok kurang ditolak', async () => {
    const [before] = await sql<{ updated_at: string; stock: number }[]>`SELECT updated_at, stock FROM products WHERE id = ${kopi}`;
    const r = await req('POST', '/v1/juragan/stock-transfers', {
      fromBusinessId: A.businessId, toBusinessId: s2, note: 'Kirim ke cabang',
      lines: [{ productId: kopi, toProductId: kopiS2, qty: 4 }],
    }, A.token);
    expect(r.status).toBe(201);
    expect(r.json.data.lines[0]).toMatchObject({ qty: 4, fromStockAfter: 6, toStockAfter: 4 });
    expect(await ledger(A.businessId, kopi)).toBe(6);
    expect(await ledger(s2, kopiS2)).toBe(4);
    const [after] = await sql<{ updated_at: string; stock: number }[]>`SELECT updated_at, stock FROM products WHERE id = ${kopi}`;
    expect(after).toEqual(before); // server tak menyentuh products.stock / updated_at

    const logs = await sql<{ business_id: string; type: string; qty_change: number; ref_type: string; ref_id: string; note: string }[]>`
      SELECT business_id, type, qty_change, ref_type, ref_id, note FROM stock_logs WHERE ref_id = ${r.json.data.transferId} ORDER BY qty_change`;
    expect(logs.map((l) => [l.type, l.qty_change, l.ref_type])).toEqual([['out', -4, 'store_transfer'], ['in', 4, 'store_transfer']]);
    expect(logs[1]!.note).toContain('Mutasi dari');

    // Ledger baru ikut ter-pull toko tujuan.
    const pull = await req('GET', '/v1/backup/pull?limit=500', undefined, s2Token);
    expect(pull.json.data.tables.stock_logs.some((l: { refType: string; qtyChange: number }) => l.refType === 'store_transfer' && l.qtyChange === 4)).toBe(true);

    // Varian ikut aturan sama.
    const copied = await sql<{ id: string }[]>`SELECT id FROM product_variants WHERE business_id = ${s2} AND name = 'Jumbo'`;
    const tehS2 = await sql<{ id: string }[]>`SELECT id FROM products WHERE business_id = ${s2} AND name = 'Teh Gelas'`;
    const v = await req('POST', '/v1/juragan/stock-transfers', {
      fromBusinessId: A.businessId, toBusinessId: s2,
      lines: [{ productId: teh, variantId: tehVar, toProductId: tehS2[0]!.id, toVariantId: copied[0]!.id, qty: 2 }],
    }, A.token);
    expect(v.status).toBe(201);
    expect(await ledger(A.businessId, teh, tehVar)).toBe(5);
    expect(await ledger(s2, tehS2[0]!.id, copied[0]!.id)).toBe(2);

    // Melebihi stok ledger → 422, tak ada baris yang tertulis (satu transaksi).
    const count0 = await sql`SELECT id FROM stock_logs WHERE ref_type = 'store_transfer'`;
    const over = await req('POST', '/v1/juragan/stock-transfers', {
      fromBusinessId: A.businessId, toBusinessId: s2,
      lines: [{ productId: kopi, toProductId: kopiS2, qty: 1 }, { productId: kopi, toProductId: kopiS2, qty: 99 }],
    }, A.token);
    expect(over.status).toBe(422);
    expect(over.json.error.message).toContain('tidak cukup');
    expect(await sql`SELECT id FROM stock_logs WHERE ref_type = 'store_transfer'`).toHaveLength(count0.length);

    // Validasi bentuk: qty 0 / produk toko lain.
    expect((await req('POST', '/v1/juragan/stock-transfers', { fromBusinessId: A.businessId, toBusinessId: s2, lines: [{ productId: kopi, toProductId: kopiS2, qty: 0 }] }, A.token)).status).toBe(422);
    const wrong = await req('POST', '/v1/juragan/stock-transfers', { fromBusinessId: A.businessId, toBusinessId: s2, lines: [{ productId: kopi, toProductId: kopi, qty: 1 }] }, A.token);
    expect(wrong.json.error.message).toContain('tidak ditemukan');
  });

  it('langganan habis → semua fitur lintas-toko ditolak, sync tetap jalan', async () => {
    await sql`UPDATE subscriptions SET starts_at = starts_at - 400::bigint * 86400000, ends_at = ${Date.now() - 1000} WHERE account_id = ${A.accountId}`;
    const r = await req('GET', '/v1/juragan/reports/summary', undefined, A.token);
    expect(r.json.error.code).toBe('PLAN_REQUIRED');
    expect((await req('GET', '/v1/backup/pull', undefined, s2Token)).status).toBe(200);
  });
});
