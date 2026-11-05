import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { app } from '../../src/app.js';
import { sql } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { uuid } from '../../src/lib/uuid.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { setNotifyTransport, type AdminNotice } from '../../src/lib/notify.js';
import { setDigiflazzTransport, DigiflazzError } from '../../src/ppob/digiflazz.js';
import * as points from '../../src/services/points.service.js';
import * as ppob from '../../src/services/ppob.service.js';

/**
 * Contract test PPOB tahap 2 (pulsa & data via Digiflazz PALSU).
 * Menguji uang: potong Poin sekali, refund sekali, pending → webhook, idempotensi.
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

// ── Digiflazz palsu ──────────────────────────────────────────────────────────
type TxReply = Record<string, unknown> | Error;
const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
let priceList: unknown[] = [];
/** Antrean balasan /transaction per nomor tujuan. */
const txReplies = new Map<string, TxReply[]>();
function replyFor(customerNo: string, ...r: TxReply[]) {
  txReplies.set(customerNo, r);
}

const fake = async (path: string, body: Record<string, unknown>) => {
  calls.push({ path, body });
  if (path === '/price-list') return priceList;
  if (path === '/cek-saldo') return { deposit: 1_234_567 };
  if (path === '/transaction') {
    const q = txReplies.get(String(body.customer_no)) ?? [];
    const r = q.length > 1 ? q.shift()! : q[0] ?? { status: 'Pending', rc: '03' };
    if (r instanceof Error) throw r;
    return { ref_id: body.ref_id, customer_no: body.customer_no, buyer_sku_code: body.buyer_sku_code, ...r };
  }
  throw new Error('path tak dikenal ' + path);
};

const TSEL = '081211110000';
const tsel = (i: number) => `0812111100${String(i).padStart(2, '0')}`;

suite('PPOB tahap 2 — pulsa & data', () => {
  const tag = uuid().slice(0, 8);
  let token = '';
  let businessId = '';
  let accountId = '';
  let restoreDf: () => void = () => {};
  let restoreNotify: () => void = () => {};
  const notices: AdminNotice[] = [];
  let pTsel10 = '';
  let pXlData = '';

  const balance = () => points.balanceOf(accountId);
  const buy = (productId: string, customerNo: string, clientRef = uuid()) =>
    req('POST', '/v1/ppob/orders', token, { clientRef, productId, customerNo });
  const orderRow = async (id: string) => (await sql`SELECT * FROM ppob_orders WHERE id = ${id}`)[0]!;
  const ledgerFor = async (id: string) =>
    sql<{ type: string; amount: string }[]>`SELECT type, amount FROM point_ledger WHERE ref_type = 'ppob_order' AND ref_id = ${id} ORDER BY created_at`;

  beforeAll(async () => {
    await runMigrations(sql);
    restoreDf = setDigiflazzTransport(fake);
    restoreNotify = setNotifyTransport(async (n) => {
      notices.push(n);
    });
    await sql`DELETE FROM app_config WHERE key IN ('ppob', 'ppob_sync')`;
    const r = await req('POST', '/v1/auth/register-business', undefined, {
      business: { name: `Toko PPOB ${tag}` },
      owner: { name: 'Bu PPOB', email: `ppob-${tag}@toko.id`, password: 'rahasia123' },
    });
    token = r.json.data.accessToken;
    businessId = r.json.data.business.id;
    accountId = (await points.ownerAccountId(businessId))!;
    await points.adminAdjust(accountId, 100_000, 'saldo uji PPOB', 'tester', businessId);

    priceList = [
      { product_name: 'Telkomsel 10.000', category: 'Pulsa', brand: 'TELKOMSEL', price: 10_150, buyer_sku_code: `t10-${tag}`, buyer_product_status: true, seller_product_status: true, start_cut_off: '0:0', end_cut_off: '0:0' },
      { product_name: 'Telkomsel 25.000', category: 'Pulsa', brand: 'TELKOMSEL', price: '24900', buyer_sku_code: `t25-${tag}`, buyer_product_status: true, seller_product_status: true },
      { product_name: 'XL Data 10GB', category: 'Data', brand: 'XL', price: 45_000, buyer_sku_code: `xd-${tag}`, buyer_product_status: true, seller_product_status: true },
      { product_name: 'Indosat 5.000', category: 'Pulsa', brand: 'INDOSAT', price: 5_500, buyer_sku_code: `i5-${tag}`, buyer_product_status: false, seller_product_status: true },
      { product_name: 'PLN 20.000', category: 'PLN', brand: 'PLN', price: 20_100, buyer_sku_code: `pln20-${tag}`, buyer_product_status: true, seller_product_status: true },
    ];
  });

  beforeEach(() => {
    calls.length = 0;
  });

  afterAll(async () => {
    restoreDf();
    restoreNotify();
    await sql`DELETE FROM ppob_orders WHERE business_id = ${businessId}`;
    await sql`DELETE FROM ppob_products WHERE sku LIKE ${'%-' + tag}`;
    await sql`DELETE FROM app_config WHERE key IN ('ppob', 'ppob_sync')`;
    await sql`ALTER TABLE point_ledger DISABLE TRIGGER trg_point_ledger_immutable`;
    await sql`DELETE FROM point_ledger WHERE account_id = ${accountId}`;
    await sql`ALTER TABLE point_ledger ENABLE TRIGGER trg_point_ledger_immutable`;
    await sql`DELETE FROM point_accounts WHERE account_id = ${accountId}`;
    await sql.end({ timeout: 5 });
  });

  it('sinkron harga: hanya pulsa & data, markup + pembulatan, status penyedia, maks 1×/5 menit', async () => {
    const r = await ppob.syncDigiflazzProducts('tester');
    expect(r.received).toBe(5);
    const rows = await sql<Record<string, unknown>[]>`SELECT * FROM ppob_products WHERE sku LIKE ${'%-' + tag} ORDER BY sku`;
    expect(rows.map((x) => x.sku)).not.toContain(`pln20-${tag}`); // PLN = jalur manual
    const t10 = rows.find((x) => x.sku === `t10-${tag}`)!;
    expect(Number(t10.cost_price)).toBe(10_150);
    expect(Number(t10.sell_price)).toBe(10_700); // ceil((10150+500)/100)*100
    expect(Number(rows.find((x) => x.sku === `t25-${tag}`)!.cost_price)).toBe(24_900); // harga string
    expect(rows.find((x) => x.sku === `i5-${tag}`)!.provider_active).toBe(false);
    pTsel10 = t10.id as string;
    pXlData = rows.find((x) => x.sku === `xd-${tag}`)!.id as string;

    await expect(ppob.syncDigiflazzProducts('tester')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('harga override admin bertahan saat sinkron; produk hilang → nonaktif', async () => {
    await ppob.adminUpdateProduct(pXlData, { price: 47_000 });
    await expect(ppob.adminUpdateProduct(pXlData, { price: 40_000 })).rejects.toMatchObject({ code: 'VALIDATION' }); // di bawah modal
    priceList = priceList.filter((p) => (p as { buyer_sku_code: string }).buyer_sku_code !== `t25-${tag}`);
    await sql`DELETE FROM app_config WHERE key = 'ppob_sync'`;
    await ppob.syncDigiflazzProducts('tester');
    const xl = (await sql`SELECT * FROM ppob_products WHERE id = ${pXlData}`)[0]!;
    expect(Number(xl.sell_price)).toBe(47_000);
    expect(xl.price_locked).toBe(true);
    const t25 = (await sql`SELECT provider_active FROM ppob_products WHERE sku = ${`t25-${tag}`}`)[0]!;
    expect(t25.provider_active).toBe(false);
  });

  it('katalog app: difilter operator dari nomor; nomor tak valid → 422', async () => {
    const r = await req('GET', `/v1/ppob/products?category=pulsa&customerNo=${TSEL}`, token);
    expect(r.status).toBe(200);
    expect(r.json.meta.operator).toBe('TELKOMSEL');
    const mine = r.json.data.filter((p: { name: string }) => p.name === 'Telkomsel 10.000');
    expect(mine[0]).toMatchObject({ price: 10_700, available: true });
    expect(r.json.data.every((p: { brand: string }) => p.brand === 'TELKOMSEL')).toBe(true);
    expect((await req('GET', '/v1/ppob/products?category=pulsa&customerNo=12345', token)).status).toBe(422);
  });

  it('sukses: Poin terpotong sekali, SN tersimpan, testing & max_price dikirim', async () => {
    replyFor(tsel(1), { status: 'Sukses', rc: '00', sn: 'SN-ABC-123', price: 10_150, buyer_last_saldo: 9_000_000 });
    const before = await balance();
    const r = await buy(pTsel10, tsel(1));
    expect(r.status).toBe(201);
    expect(r.json.data).toMatchObject({ status: 'success', sn: 'SN-ABC-123', price: 10_700, refunded: false });
    expect(await balance()).toBe(before - 10_700);
    const tx = calls.find((c) => c.path === '/transaction')!;
    expect(tx.body).toMatchObject({ ref_id: r.json.data.id, testing: true, max_price: 10_150 + 203, customer_no: tsel(1) });
  });

  it('klik ganda / paralel dengan clientRef sama → 1 order, 1 potongan, 1 panggilan', async () => {
    replyFor(tsel(2), { status: 'Sukses', rc: '00', sn: 'SN-2' });
    const ref = uuid();
    const before = await balance();
    const rs = await Promise.all([buy(pTsel10, tsel(2), ref), buy(pTsel10, tsel(2), ref), buy(pTsel10, tsel(2), ref)]);
    const ids = new Set(rs.map((r) => r.json.data.id));
    expect(ids.size).toBe(1);
    expect(await balance()).toBe(before - 10_700);
    expect(calls.filter((c) => c.path === '/transaction')).toHaveLength(1);
  });

  it('gagal: refund otomatis sekali; webhook sukses setelahnya diabaikan', async () => {
    replyFor(tsel(3), { status: 'Gagal', rc: '02', message: 'Transaksi Gagal' });
    const before = await balance();
    const r = await buy(pTsel10, tsel(3));
    expect(r.json.data).toMatchObject({ status: 'failed', refunded: true });
    expect(await balance()).toBe(before);
    const led = await ledgerFor(r.json.data.id);
    expect(led.map((l) => [l.type, Number(l.amount)])).toEqual([['purchase', -10_700], ['refund', 10_700]]);

    const body = JSON.stringify({ data: { ref_id: r.json.data.id, status: 'Sukses', rc: '00', sn: 'LATE' } });
    const sig = 'sha1=' + createHmac('sha1', 'test-df-webhook-secret').update(body).digest('hex');
    const w = await app.request('/v1/webhooks/digiflazz', { method: 'POST', headers: { 'X-Hub-Signature': sig, 'X-Digiflazz-Event': 'update' }, body });
    expect(w.status).toBe(200);
    expect((await orderRow(r.json.data.id)).status).toBe('failed');
    expect(await balance()).toBe(before);
  });

  it('pending → webhook (tanda tangan valid) sukses; tanda tangan salah ditolak; webhook ganda aman', async () => {
    replyFor(tsel(4), { status: 'Pending', rc: '03' });
    const before = await balance();
    const r = await buy(pTsel10, tsel(4));
    expect(r.json.data.status).toBe('pending');
    expect(await balance()).toBe(before - 10_700);

    const body = JSON.stringify({ data: { ref_id: r.json.data.id, status: 'Sukses', rc: '00', sn: 'SN-HOOK' } });
    const bad = await app.request('/v1/webhooks/digiflazz', { method: 'POST', headers: { 'X-Hub-Signature': 'sha1=deadbeef' }, body });
    expect(bad.status).toBe(401);
    expect((await orderRow(r.json.data.id)).status).toBe('pending');

    const sig = 'sha1=' + createHmac('sha1', 'test-df-webhook-secret').update(body).digest('hex');
    for (let i = 0; i < 2; i++) {
      const w = await app.request('/v1/webhooks/digiflazz', { method: 'POST', headers: { 'X-Hub-Signature': sig }, body });
      expect(w.status).toBe(200);
    }
    const o = await orderRow(r.json.data.id);
    expect(o).toMatchObject({ status: 'success', sn: 'SN-HOOK' });
    expect(await balance()).toBe(before - 10_700);
    const ev = await sql`SELECT event FROM ppob_order_events WHERE order_id = ${r.json.data.id}`;
    expect(ev.map((e) => e.event)).toContain('webhook_ignored_final');
  });

  it('pending → webhook gagal: refund sekali walau webhook dikirim 2×', async () => {
    replyFor(tsel(5), { status: 'Pending', rc: '03' });
    const before = await balance();
    const r = await buy(pTsel10, tsel(5));
    const body = JSON.stringify({ data: { ref_id: r.json.data.id, status: 'Gagal', rc: '02' } });
    const sig = 'sha1=' + createHmac('sha1', 'test-df-webhook-secret').update(body).digest('hex');
    await Promise.all([1, 2].map(() => app.request('/v1/webhooks/digiflazz', { method: 'POST', headers: { 'X-Hub-Signature': sig }, body })));
    expect(await balance()).toBe(before);
    expect((await ledgerFor(r.json.data.id)).filter((l) => l.type === 'refund')).toHaveLength(1);
  });

  it('error jaringan = pending (tanpa refund); cek ulang ≤ 1×/menit lalu sukses', async () => {
    replyFor(tsel(6), new DigiflazzError('ETIMEDOUT', true), { status: 'Sukses', rc: '00', sn: 'SN-RETRY' });
    const before = await balance();
    const r = await buy(pTsel10, tsel(6));
    expect(r.json.data.status).toBe('pending');
    expect(await balance()).toBe(before - 10_700);

    // Baru dibuat (< 1 menit): GET tidak memicu cek ulang.
    calls.length = 0;
    await req('GET', `/v1/ppob/orders/${r.json.data.id}`, token);
    expect(calls).toHaveLength(0);

    // Order berumur > 1 menit → GET memicu cek ulang (ref_id sama) → sukses.
    await sql`UPDATE ppob_orders SET created_at = created_at - 120000, last_checked_at = last_checked_at - 120000 WHERE id = ${r.json.data.id}`;
    const g = await req('GET', `/v1/ppob/orders/${r.json.data.id}`, token);
    expect(g.json.data).toMatchObject({ status: 'success', sn: 'SN-RETRY' });
    expect(calls.filter((c) => c.path === '/transaction')[0]!.body.ref_id).toBe(r.json.data.id);

    // Jeda 1 menit dihormati.
    expect((await ppob.checkStatus(r.json.data.id)).checked).toBe(false);
  });

  it('order > 85 hari tak dicek ulang otomatis (Digiflazz akan membuat transaksi baru)', async () => {
    replyFor(tsel(7), { status: 'Pending', rc: '03' });
    const r = await buy(pTsel10, tsel(7));
    await sql`UPDATE ppob_orders SET created_at = created_at - ${86 * 86_400_000} WHERE id = ${r.json.data.id}`;
    calls.length = 0;
    const res = await ppob.checkStatus(r.json.data.id);
    expect(res.checked).toBe(false);
    expect(res.reason).toMatch(/85 hari/);
    expect(calls).toHaveLength(0);
  });

  it('Poin tak cukup → 409, tidak ada order & tidak memanggil Digiflazz', async () => {
    const bal = await balance();
    await points.adminAdjust(accountId, -bal + 100, 'kurangi untuk uji', 'tester', null);
    const ref = uuid();
    const r = await buy(pXlData, '087812345678', ref);
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('INSUFFICIENT_POINTS');
    expect((await sql`SELECT 1 FROM ppob_orders WHERE client_ref = ${ref}`).length).toBe(0);
    expect(calls.filter((c) => c.path === '/transaction')).toHaveLength(0);
    await points.adminAdjust(accountId, 200_000, 'isi ulang uji', 'tester', null);
  });

  it('operator tak cocok / produk nonaktif ditolak', async () => {
    const r = await buy(pTsel10, '087812345678');
    expect(r.status).toBe(422);
    const ind = (await sql`SELECT id FROM ppob_products WHERE sku = ${`i5-${tag}`}`)[0]!.id as string;
    expect((await buy(ind, '085712345678')).json.error.code).toBe('PRODUCT_UNAVAILABLE');
  });

  it('RC 44 (deposit Digiflazz habis) → gagal + refund + alarm admin', async () => {
    replyFor('087812345678', { status: 'Gagal', rc: '44', message: 'Saldo tidak cukup' });
    notices.length = 0;
    const before = await balance();
    const r = await buy(pXlData, '087812345678');
    expect(r.json.data).toMatchObject({ status: 'failed', refunded: true });
    expect(await balance()).toBe(before);
    await new Promise((res) => setTimeout(res, 20));
    expect(notices.some((n) => n.text.includes('RC 44'))).toBe(true);
  });

  it('tugas berkala menyelesaikan order pending', async () => {
    replyFor(tsel(8), { status: 'Pending', rc: '03' }, { status: 'Sukses', rc: '00', sn: 'SN-JOB' });
    const r = await buy(pTsel10, tsel(8));
    await sql`UPDATE ppob_orders SET created_at = created_at - 300000, last_checked_at = last_checked_at - 300000 WHERE id = ${r.json.data.id}`;
    expect(await ppob.reconcilePending()).toBeGreaterThanOrEqual(1);
    expect((await orderRow(r.json.data.id)).status).toBe('success');
  });

  it('riwayat order app + isolasi antar-toko', async () => {
    const list = await req('GET', '/v1/ppob/orders?limit=3', token);
    expect(list.json.data).toHaveLength(3);
    expect(list.json.meta.hasMore).toBe(true);
    const other = await signAccessToken({ userId: uuid(), businessId: uuid(), role: 'owner' });
    expect((await req('GET', `/v1/ppob/orders/${list.json.data[0].id}`, other)).status).toBe(404);
  });

  describe('dashboard admin PPOB', () => {
    let cookie = '';
    const page = async (path: string) => {
      const res = await app.request(path, { headers: { Cookie: cookie } });
      return { status: res.status, html: await res.text() };
    };
    const form = (path: string, data: Record<string, string>) =>
      app.request(path, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(data).toString(),
      });

    beforeAll(async () => {
      const body = new URLSearchParams({ user: process.env.DASHBOARD_USER!, password: process.env.DASHBOARD_PASSWORD! }).toString();
      const res = await app.request('/dashboard/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
    });

    it('daftar order + deposit + detail dengan jejak & mutasi Poin', async () => {
      const list = await page(`/dashboard/ppob?q=${tsel(1)}`);
      expect(list.status).toBe(200);
      expect(list.html).toContain(tsel(1));
      expect(list.html).toContain('Rp 1.234.567'); // deposit dari Digiflazz palsu
      const id = (await sql`SELECT id FROM ppob_orders WHERE customer_no = ${tsel(1)} AND business_id = ${businessId}`)[0]!.id as string;
      const d = await page(`/dashboard/ppob/orders/${id}`);
      expect(d.html).toContain('SN-ABC-123');
      expect(d.html).toContain('submit_success');
      expect(d.html).toContain('purchase');
    });

    it('tombol cek status menghormati jeda 1 menit', async () => {
      replyFor(tsel(9), { status: 'Pending', rc: '03' });
      const r = await buy(pTsel10, tsel(9));
      const res = await form(`/dashboard/ppob/orders/${r.json.data.id}/check`, {});
      expect(res.status).toBe(302);
      const flash = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
      const next = await app.request(`/dashboard/ppob/orders/${r.json.data.id}`, { headers: { Cookie: `${cookie}; ${flash}` } });
      expect(await next.text()).toContain('maks 1× per menit');
    });

    it('produk: set harga (kunci), sembunyikan, kembali otomatis', async () => {
      const back = '/dashboard/ppob?tab=products';
      await form(`/dashboard/ppob/products/${pTsel10}`, { op: 'price', price: '11000', back });
      let p = (await sql`SELECT * FROM ppob_products WHERE id = ${pTsel10}`)[0]!;
      expect([Number(p.sell_price), p.price_locked]).toEqual([11_000, true]);
      await form(`/dashboard/ppob/products/${pTsel10}`, { op: 'hide', back });
      expect((await sql`SELECT active FROM ppob_products WHERE id = ${pTsel10}`)[0]!.active).toBe(false);
      const cat = await req('GET', `/v1/ppob/products?category=pulsa&customerNo=${TSEL}`, token);
      expect(cat.json.data.find((x: { id: string }) => x.id === pTsel10)).toBeUndefined();
      await form(`/dashboard/ppob/products/${pTsel10}`, { op: 'show', back });
      await form(`/dashboard/ppob/products/${pTsel10}`, { op: 'unlock', back });
      p = (await sql`SELECT * FROM ppob_products WHERE id = ${pTsel10}`)[0]!;
      expect([Number(p.sell_price), p.price_locked, p.active]).toEqual([10_700, false, true]);
      const html = (await page('/dashboard/ppob?tab=products&category=pulsa')).html;
      expect(html).toContain('Telkomsel 10.000');
    });

    it('pengaturan markup menghitung ulang harga tak terkunci', async () => {
      const r = await form('/dashboard/ppob/settings', { markupPulsa: '1000', markupData: '500', markupPln: '1500', roundTo: '500', lowDepositAlert: '100000' });
      expect(r.status).toBe(302);
      expect(Number((await sql`SELECT sell_price FROM ppob_products WHERE id = ${pTsel10}`)[0]!.sell_price)).toBe(11_500); // ceil(11150/500)*500
      expect(Number((await sql`SELECT sell_price FROM ppob_products WHERE id = ${pXlData}`)[0]!.sell_price)).toBe(47_000); // terkunci
      await sql`DELETE FROM app_config WHERE key = 'ppob'`;
    });
  });

  it('GET /v1/ppob/status: saklar, kategori (+alasan), saldo & hak top-up per peran', async () => {
    const r = await req('GET', '/v1/ppob/status', token);
    expect(r.status).toBe(200);
    const d = r.json.data;
    expect(d.enabled).toBe(true);
    expect(d.categories.map((c: { key: string }) => c.key)).toEqual(['pulsa', 'data', 'pln']);
    const pulsa = d.categories.find((c: { key: string }) => c.key === 'pulsa');
    expect(pulsa).toMatchObject({ available: true, reason: null });
    expect(pulsa.productCount).toBeGreaterThan(0);
    expect(d.points).toMatchObject({ available: true, balance: await balance(), canTopup: true });
    expect(typeof d.serverTime).toBe('number');
    const cashier = await signAccessToken({ userId: uuid(), businessId, role: 'cashier' });
    expect((await req('GET', '/v1/ppob/status', cashier)).json.data.points.canTopup).toBe(false);
    expect((await req('GET', '/v1/ppob/status')).status).toBe(401);
  });

  it('saldo Poin = Σ ledger setelah semua skenario', async () => {
    const s = await sql<{ s: string }[]>`SELECT coalesce(sum(amount),0) s FROM point_ledger WHERE account_id = ${accountId}`;
    expect(Number(s[0]!.s)).toBe(await balance());
  });
});
