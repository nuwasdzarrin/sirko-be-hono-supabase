import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { uuid } from '../../src/lib/uuid.js';
import { req, register, makeJuragan } from './juragan-helpers.js';

/**
 * Contract test tautan salinan produk (PROMPT-backend-juragan-salin-produk.md):
 * salin tanpa duplikat (ALREADY_COPIED), salin ulang setelah dihapus, BARCODE_EXISTS
 * menyimpan tautan, product-links dua arah, katalog toko lain (stok ledger),
 * transfer manual menyimpan tautan. Butuh Postgres; skip bila tak tersambung.
 */

let dbUp = false;
try {
  await sql`SELECT 1`;
  dbUp = true;
} catch (err) {
  console.warn(`[contract] DB tak tersambung — suite di-skip: ${(err as Error).message}`);
}
const suite = dbUp ? describe : describe.skip;

const T = Date.now();

suite('Juragan — tautan salinan produk & katalog toko lain', () => {
  let A: Awaited<ReturnType<typeof register>>; // owner Juragan, toko utama
  let s2 = ''; // cabang milik A
  let s2Token = '';
  let W: Awaited<ReturnType<typeof register>>; // akun warung lain
  const gorengan = uuid(); // tanpa barcode
  const kopi = uuid(); // ber-barcode, varian
  const kopiVar = uuid();

  const copy = (productIds: string[], from = A.businessId, to = s2) =>
    req('POST', '/v1/juragan/copy-products', { fromBusinessId: from, toBusinessId: to, productIds }, A.token);
  const links = (from: string, to: string) =>
    req('GET', `/v1/juragan/product-links?fromBusinessId=${from}&toBusinessId=${to}`, undefined, A.token);
  const countIn = async (b: string, name: string) =>
    (await sql`SELECT id FROM products WHERE business_id = ${b} AND name = ${name} AND deleted_at IS NULL`).length;

  beforeAll(async () => {
    await runMigrations(sql);
    A = await register('jl');
    W = await register('jl');
    await makeJuragan(A.token);
    const c = await req('POST', '/v1/businesses', { name: 'Cabang Link' }, A.token);
    s2 = c.json.data.business.id;
    s2Token = c.json.data.accessToken;
    await req('POST', '/v1/backup/push', {
      tables: {
        products: [
          { id: gorengan, name: 'Gorengan Bakwan', sellingPrice: 1000, updatedAt: T },
          { id: kopi, name: 'Kopi Sachet', barcode: '8990000000017', sellingPrice: 1500, hasVariants: true, updatedAt: T },
        ],
        product_variants: [{ id: kopiVar, productId: kopi, name: 'Susu', sellingPrice: 2000, updatedAt: T }],
        stock_logs: [
          { id: uuid(), productId: gorengan, type: 'initial', qtyChange: 20, stockAfter: 20, updatedAt: T },
          { id: uuid(), productId: kopi, variantId: kopiVar, type: 'initial', qtyChange: 9, stockAfter: 9, updatedAt: T },
        ],
      },
    }, A.token);
  });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('[1] salin produk TANPA barcode dua kali → kedua ALREADY_COPIED, produk tujuan tetap 1', async () => {
    const first = await copy([gorengan]);
    expect(first.status).toBe(201);
    const toId = first.json.data.copied[0].toProductId as string;
    const second = await copy([gorengan]);
    expect(second.json.data).toEqual({
      copied: [],
      skipped: [{ fromProductId: gorengan, reason: 'ALREADY_COPIED', existingProductId: toId, variants: [] }],
      createdCategories: 0,
      createdUnits: 0,
    });
    expect(await countIn(s2, 'Gorengan Bakwan')).toBe(1);
  });

  it('[2] produk dihapus di toko tujuan lalu disalin lagi → tercipta baru, tautan diperbarui', async () => {
    const [{ id: oldId }] = (await sql<{ id: string }[]>`
      SELECT id FROM products WHERE business_id = ${s2} AND name = 'Gorengan Bakwan' AND deleted_at IS NULL`) as unknown as [{ id: string }];
    await req('POST', '/v1/backup/push', {
      tables: { products: [{ id: oldId, name: 'Gorengan Bakwan', updatedAt: Date.now() + 1000, deletedAt: Date.now() }] },
    }, s2Token);
    const again = await copy([gorengan]);
    expect(again.json.data.copied).toHaveLength(1);
    const newId = again.json.data.copied[0].toProductId as string;
    expect(newId).not.toBe(oldId);
    const l = await links(A.businessId, s2);
    expect(l.json.data.links.find((x: { fromProductId: string }) => x.fromProductId === gorengan).toProductId).toBe(newId);
    // Salin ketiga kali → ALREADY_COPIED ke produk baru.
    expect((await copy([gorengan])).json.data.skipped[0]).toMatchObject({ reason: 'ALREADY_COPIED', existingProductId: newId });
  });

  it('[3] barcode sama → BARCODE_EXISTS + tautan (varian per nama) → product-links mengembalikan pasangan', async () => {
    // Toko tujuan sudah punya produk dengan barcode sama (dibuat sendiri, bukan salinan) + varian "susu".
    const own = uuid();
    const ownVar = uuid();
    await req('POST', '/v1/backup/push', {
      tables: {
        products: [{ id: own, name: 'Kopi Sachet Cabang', barcode: '8990000000017', hasVariants: true, updatedAt: T }],
        product_variants: [{ id: ownVar, productId: own, name: ' susu ', updatedAt: T }],
      },
    }, s2Token);
    const r = await copy([kopi]);
    expect(r.json.data.skipped).toEqual([
      { fromProductId: kopi, reason: 'BARCODE_EXISTS', existingProductId: own, variants: [{ fromVariantId: kopiVar, toVariantId: ownVar }] },
    ]);
    const l = await links(A.businessId, s2);
    expect(l.json.data.links).toContainEqual({ fromProductId: kopi, toProductId: own, variants: [{ fromVariantId: kopiVar, toVariantId: ownVar }] });
    // Salin lagi → kini lewat tautan (ALREADY_COPIED) dengan varian yang sama.
    expect((await copy([kopi])).json.data.skipped[0]).toEqual({
      fromProductId: kopi, reason: 'ALREADY_COPIED', existingProductId: own, variants: [{ fromVariantId: kopiVar, toVariantId: ownVar }],
    });
  });

  it('[4] product-links arah balik (B→A) mengembalikan pasangan terbalik; hanya yang hidup', async () => {
    const ab = (await links(A.businessId, s2)).json.data.links as Array<{ fromProductId: string; toProductId: string; variants: Array<{ fromVariantId: string; toVariantId: string }> }>;
    const ba = (await links(s2, A.businessId)).json.data.links as typeof ab;
    expect(ba).toHaveLength(ab.length);
    for (const x of ab) {
      expect(ba).toContainEqual({
        fromProductId: x.toProductId,
        toProductId: x.fromProductId,
        variants: x.variants.map((v) => ({ fromVariantId: v.toVariantId, toVariantId: v.fromVariantId })),
      });
    }
    // Produk gorengan lama (terhapus) tak muncul sebagai pasangan.
    const deleted = await sql<{ id: string }[]>`SELECT id FROM products WHERE business_id = ${s2} AND deleted_at IS NOT NULL`;
    expect(ab.some((x) => deleted.some((d) => d.id === x.toProductId))).toBe(false);
    // Salin arah balik (B→A) produk yang sudah tertaut → ALREADY_COPIED, tak menggandakan.
    const back = await copy([ab[0]!.toProductId], s2, A.businessId);
    expect(back.json.data.skipped[0]).toMatchObject({ reason: 'ALREADY_COPIED', existingProductId: ab[0]!.fromProductId });
  });

  it('[5] products?businessId= stok = Σ ledger; toko orang → FORBIDDEN; warung → PLAN_REQUIRED', async () => {
    const r = await req('GET', `/v1/juragan/products?businessId=${A.businessId}`, undefined, A.token);
    expect(r.status).toBe(200);
    const list = r.json.data.products as Array<{ id: string; name: string; stock: number; hasVariants: boolean; variants: Array<{ id: string; stock: number }> }>;
    expect(list.map((p) => p.name)).toEqual(['Gorengan Bakwan', 'Kopi Sachet']); // urut nama
    expect(list.find((p) => p.id === gorengan)).toMatchObject({ stock: 20, hasVariants: false, variants: [] });
    expect(list.find((p) => p.id === kopi)).toMatchObject({ barcode: '8990000000017', hasVariants: true, variants: [{ id: kopiVar, name: 'Susu', stock: 9 }] });
    // products.stock diabaikan — yang dipakai ledger.
    await sql`UPDATE products SET stock = 999 WHERE id = ${gorengan}`;
    const again = await req('GET', `/v1/juragan/products?businessId=${A.businessId}&q=BAKWAN`, undefined, A.token);
    expect(again.json.data.products).toEqual([expect.objectContaining({ id: gorengan, stock: 20 })]);
    // q cocok ke barcode juga; karakter % tak jadi wildcard.
    expect((await req('GET', `/v1/juragan/products?businessId=${A.businessId}&q=0000017`, undefined, A.token)).json.data.products).toHaveLength(1);
    expect((await req('GET', `/v1/juragan/products?businessId=${A.businessId}&q=%25`, undefined, A.token)).json.data.products).toHaveLength(0);

    const foreign = await req('GET', `/v1/juragan/products?businessId=${W.businessId}`, undefined, A.token);
    expect(foreign.status).toBe(403);
    expect(foreign.json.error.code).toBe('FORBIDDEN');
    const warung = await req('GET', `/v1/juragan/products?businessId=${W.businessId}`, undefined, W.token);
    expect(warung.json.error.code).toBe('PLAN_REQUIRED');
    const warungLinks = await req('GET', `/v1/juragan/product-links?fromBusinessId=${W.businessId}&toBusinessId=${A.businessId}`, undefined, W.token);
    expect(warungLinks.json.error.code).toBe('PLAN_REQUIRED');
    expect((await req('GET', `/v1/juragan/product-links?fromBusinessId=${A.businessId}&toBusinessId=${W.businessId}`, undefined, A.token)).json.error.code).toBe('FORBIDDEN');
  });

  it('[6] transfer dengan pasangan manual menyimpan tautan (produk & varian)', async () => {
    // Produk & varian dibuat sendiri di kedua toko (belum tertaut).
    const pa = uuid(), pb = uuid(), va = uuid(), vb = uuid();
    await req('POST', '/v1/backup/push', {
      tables: {
        products: [{ id: pa, name: 'Rokok Eceran', hasVariants: true, updatedAt: T }],
        product_variants: [{ id: va, productId: pa, name: 'Batang', updatedAt: T }],
        stock_logs: [{ id: uuid(), productId: pa, variantId: va, type: 'initial', qtyChange: 50, stockAfter: 50, updatedAt: T }],
      },
    }, A.token);
    await req('POST', '/v1/backup/push', {
      tables: {
        products: [{ id: pb, name: 'Rokok Ketengan', hasVariants: true, updatedAt: T }],
        product_variants: [{ id: vb, productId: pb, name: 'Per batang', updatedAt: T }],
      },
    }, s2Token);
    expect((await links(A.businessId, s2)).json.data.links.some((x: { fromProductId: string }) => x.fromProductId === pa)).toBe(false);

    const t = await req('POST', '/v1/juragan/stock-transfers', {
      fromBusinessId: A.businessId, toBusinessId: s2,
      lines: [{ productId: pa, variantId: va, toProductId: pb, toVariantId: vb, qty: 5 }],
    }, A.token);
    expect(t.status).toBe(201);
    expect((await links(A.businessId, s2)).json.data.links).toContainEqual({
      fromProductId: pa, toProductId: pb, variants: [{ fromVariantId: va, toVariantId: vb }],
    });
    // Transfer kedua tak menambah tautan ganda.
    await req('POST', '/v1/juragan/stock-transfers', {
      fromBusinessId: A.businessId, toBusinessId: s2,
      lines: [{ productId: pa, variantId: va, toProductId: pb, toVariantId: vb, qty: 1 }],
    }, A.token);
    const rows = await sql`SELECT 1 FROM product_links WHERE source_product_id = ${pa} OR target_product_id = ${pa}`;
    expect(rows).toHaveLength(2); // 1 produk + 1 varian
    // Salin produk itu kini → ALREADY_COPIED ke pb.
    expect((await copy([pa])).json.data.skipped[0]).toMatchObject({ reason: 'ALREADY_COPIED', existingProductId: pb });
  });

  it('tabel product_links bukan tabel sync (tak ada di pull)', async () => {
    const pull = await req('GET', '/v1/backup/pull?limit=500', undefined, s2Token);
    expect(Object.keys(pull.json.data.tables)).not.toContain('product_links');
  });
});
