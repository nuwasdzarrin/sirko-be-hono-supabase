import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app.js';
import { sql } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { uuid } from '../../src/lib/uuid.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { setDigiflazzTransport } from '../../src/ppob/digiflazz.js';
import { setNotifyTransport } from '../../src/lib/notify.js';
import * as points from '../../src/services/points.service.js';
import * as ppob from '../../src/services/ppob.service.js';

/**
 * Contract test aturan harga JUAL PPOB per toko (SPEC §4) + aturan kasir (SPEC §5):
 * tolak nomor tujuan sama yang masih pending; jawaban order dibatasi waktu.
 */

let dbUp = false;
try {
  await sql`SELECT 1`;
  dbUp = true;
} catch (err) {
  console.warn(`[contract] DB tak tersambung — suite di-skip: ${(err as Error).message}`);
}
const suite = dbUp ? describe : describe.skip;

async function req(method: string, path: string, token?: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

suite('PPOB — harga jual per toko & aturan kasir', () => {
  const tag = uuid().slice(0, 8);
  const restores: Array<() => void> = [];
  const stores: Array<{ token: string; businessId: string }> = [];
  let p10 = '';
  let p25 = '';
  let slow = false;

  beforeAll(async () => {
    await runMigrations(sql);
    restores.push(setNotifyTransport(async () => {}));
    restores.push(
      setDigiflazzTransport(async (path, body) => {
        if (path === '/price-list') {
          return [
            { product_name: 'Telkomsel 10.000', category: 'Pulsa', brand: 'TELKOMSEL', price: 10_150, buyer_sku_code: `pt10-${tag}`, buyer_product_status: true, seller_product_status: true },
            { product_name: 'Telkomsel 25.000', category: 'Pulsa', brand: 'TELKOMSEL', price: 24_900, buyer_sku_code: `pt25-${tag}`, buyer_product_status: true, seller_product_status: true },
          ];
        }
        if (slow) await new Promise((r) => setTimeout(r, 400));
        return { ref_id: body.ref_id, status: String(body.customer_no).endsWith('99') ? 'Pending' : 'Sukses', rc: String(body.customer_no).endsWith('99') ? '03' : '00', sn: 'SN-P' };
      }),
    );
    await sql`DELETE FROM app_config WHERE key IN ('ppob', 'ppob_sync')`;
    await ppob.syncDigiflazzProducts('tester');
    p10 = (await sql`SELECT id FROM ppob_products WHERE sku = ${`pt10-${tag}`}`)[0]!.id as string;
    p25 = (await sql`SELECT id FROM ppob_products WHERE sku = ${`pt25-${tag}`}`)[0]!.id as string;
    for (const i of [1, 2]) {
      const r = await req('POST', '/v1/auth/register-business', undefined, {
        business: { name: `Toko Harga ${i} ${tag}` },
        owner: { name: 'Pemilik', email: `harga${i}-${tag}@toko.id`, password: 'rahasia123' },
      });
      stores.push({ token: r.json.data.accessToken, businessId: r.json.data.business.id });
      const acc = (await points.ownerAccountId(r.json.data.business.id))!;
      await points.adminAdjust(acc, 1_000_000, 'saldo uji harga', 'tester', null);
    }
  });

  afterAll(async () => {
    restores.forEach((r) => r());
    for (const s of stores) await sql`DELETE FROM ppob_orders WHERE business_id = ${s.businessId}`;
    await sql`DELETE FROM ppob_products WHERE sku LIKE ${'%-' + tag}`;
    await sql`DELETE FROM app_config WHERE key IN ('ppob', 'ppob_sync')`;
    await sql.end({ timeout: 5 });
  });

  it('bawaan: untung Rp2.000/kategori, bulat Rp500 → sellPrice di daftar produk', async () => {
    const g = await req('GET', '/v1/ppob/pricing', stores[0]!.token);
    expect(g.json.data).toMatchObject({ markups: { pulsa: 2000, data: 2000, pln: 2000 }, rounding: 500, overrides: [], isDefault: true });
    const list = await req('GET', '/v1/ppob/products?category=pulsa&customerNo=081211112222', stores[0]!.token);
    const t10 = list.json.data.find((x: { id: string }) => x.id === p10);
    // Poin (price) = modal toko 10.700 → jual = ceil((10.700 + 2.000)/500)*500 = 13.000
    expect(t10).toMatchObject({ price: 10_700, sellPrice: 13_000, margin: 2_300, customPrice: false });
  });

  it('PUT: untung & pembulatan baru, harga khusus (+peringatan di bawah modal), terisolasi per toko', async () => {
    const put = await req('PUT', '/v1/ppob/pricing', stores[0]!.token, {
      markups: { pulsa: 1500, data: 3000, pln: 2500 },
      rounding: 1000,
      overrides: [
        { productId: p25, sellPrice: 27_000 },
        { productId: p10, sellPrice: 10_000 }, // di bawah modal → peringatan
        { productId: uuid(), sellPrice: 5000 }, // produk tak dikenal → diabaikan
      ],
    });
    expect(put.status).toBe(200);
    expect(put.json.data).toMatchObject({ markups: { pulsa: 1500, data: 3000, pln: 2500 }, rounding: 1000, isDefault: false });
    expect(put.json.data.overrides).toHaveLength(2);
    expect(put.json.data.warnings).toEqual([expect.objectContaining({ productId: p10, price: 10_700, sellPrice: 10_000, message: expect.stringMatching(/di bawah modal/) })]);

    const list = await req('GET', '/v1/ppob/products?category=pulsa', stores[0]!.token);
    const byId = (id: string) => list.json.data.find((x: { id: string }) => x.id === id);
    expect(byId(p25)).toMatchObject({ sellPrice: 27_000, customPrice: true });
    expect(byId(p10)).toMatchObject({ sellPrice: 10_000, margin: -700, customPrice: true });

    // Toko lain tak terpengaruh.
    const other = await req('GET', '/v1/ppob/products?category=pulsa', stores[1]!.token);
    expect(other.json.data.find((x: { id: string }) => x.id === p25)).toMatchObject({ sellPrice: 27_500, customPrice: false });

    // Hapus harga khusus = kirim daftar kosong.
    await req('PUT', '/v1/ppob/pricing', stores[0]!.token, { markups: { pulsa: 1500, data: 3000, pln: 2500 }, rounding: 1000, overrides: [] });
    const after = await req('GET', '/v1/ppob/products?category=pulsa', stores[0]!.token);
    expect(after.json.data.find((x: { id: string }) => x.id === p10)).toMatchObject({ sellPrice: 13_000, customPrice: false }); // ceil(12.200/1000)
  });

  it('validasi & izin: pembulatan selain 100/500/1000 → 422; kasir → 403', async () => {
    const bad = await req('PUT', '/v1/ppob/pricing', stores[0]!.token, { markups: { pulsa: 1, data: 1, pln: 1 }, rounding: 250 });
    expect(bad.status).toBe(422);
    const neg = await req('PUT', '/v1/ppob/pricing', stores[0]!.token, { markups: { pulsa: -1, data: 1, pln: 1 }, rounding: 500 });
    expect(neg.status).toBe(422);
    const cashier = await signAccessToken({ userId: uuid(), businessId: stores[0]!.businessId, role: 'cashier' });
    expect((await req('PUT', '/v1/ppob/pricing', cashier, { markups: { pulsa: 1, data: 1, pln: 1 }, rounding: 500 })).status).toBe(403);
    expect((await req('GET', '/v1/ppob/pricing', cashier)).status).toBe(200);
  });

  it('nomor tujuan sama yang masih pending → PENDING_SAME_TARGET (bawa orderId); setelah jelas boleh lagi', async () => {
    const no = '081211110099';
    const first = await req('POST', '/v1/ppob/orders', stores[0]!.token, { clientRef: uuid(), productId: p10, customerNo: no });
    expect(first.json.data.status).toBe('pending');
    const second = await req('POST', '/v1/ppob/orders', stores[0]!.token, { clientRef: uuid(), productId: p25, customerNo: no });
    expect(second.status).toBe(409);
    expect(second.json.error).toMatchObject({ code: 'PENDING_SAME_TARGET', details: { orderId: first.json.data.id } });
    // Retry clientRef sama tetap mengembalikan order lama (bukan PENDING_SAME_TARGET).
    // Toko lain dengan nomor sama tidak terhalang.
    expect((await req('POST', '/v1/ppob/orders', stores[1]!.token, { clientRef: uuid(), productId: p10, customerNo: '081211110098' })).status).toBe(201);
    await ppob.applyResult(first.json.data.id, { ref_id: first.json.data.id, status: 'Sukses', rc: '00', sn: 'X' }, 'test');
    expect((await req('POST', '/v1/ppob/orders', stores[0]!.token, { clientRef: uuid(), productId: p25, customerNo: no })).status).toBe(201);
  });

  it('penyedia lambat: jawaban order dibatasi waktu (processing), lalu selesai di latar belakang', async () => {
    const restoreWait = ppob.setSubmitWaitMs(50);
    slow = true;
    try {
      const t0 = Date.now();
      const r = await req('POST', '/v1/ppob/orders', stores[1]!.token, { clientRef: uuid(), productId: p10, customerNo: '081211110077' });
      expect(Date.now() - t0).toBeLessThan(350);
      expect(r.json.data.status).toBe('processing');
      await new Promise((res) => setTimeout(res, 600));
      const g = await req('GET', `/v1/ppob/orders/${r.json.data.id}`, stores[1]!.token);
      expect(g.json.data).toMatchObject({ status: 'success', sn: 'SN-P' });
    } finally {
      slow = false;
      restoreWait();
    }
  });
});
