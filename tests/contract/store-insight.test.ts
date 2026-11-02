import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app.js';
import { sql } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { uuid } from '../../src/lib/uuid.js';
import { resolveRange } from '../../src/services/store-report.service.js';

/**
 * Contract test: laporan toko (laba rugi §9), detail transaksi (pembayaran &
 * pelunasan), Saran (API app + dashboard). Butuh Postgres; skip bila tak tersambung.
 */

let dbUp = false;
try {
  await sql`SELECT 1`;
  dbUp = true;
} catch (err) {
  console.warn(`[contract] DB tak tersambung — suite di-skip: ${(err as Error).message}`);
}
const authOn = Boolean(process.env.DASHBOARD_USER && process.env.DASHBOARD_PASSWORD);
const suite = dbUp && authOn ? describe : describe.skip;

async function json(method: string, path: string, token?: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

suite('Laporan toko, detail transaksi & Saran', () => {
  let cookie = '';
  let token = '';
  let bid = '';
  const tag = uuid().slice(0, 8);
  const ts = Date.parse('2026-10-15T10:00:00+07:00');
  const txPaid = uuid();
  const txCredit = uuid();
  const txVoid = uuid();
  const cust = uuid();

  async function get(path: string) {
    const res = await app.request(path, { headers: { Cookie: cookie } });
    return { status: res.status, html: await res.text() };
  }

  beforeAll(async () => {
    await runMigrations(sql);
    const reg = await json('POST', '/v1/auth/register-business', undefined, {
      business: { name: `Toko Lap ${tag}` },
      owner: { name: 'Pak Lapor', email: `lap-${tag}@toko.id`, password: 'rahasia123' },
    });
    token = reg.json.data.accessToken;
    bid = reg.json.data.business.id;

    const it = (tx: string, name: string, qty: number, price: number, cost: number | null, disc = 0) => ({
      id: uuid(), transactionId: tx, nameSnapshot: name, qty, unitPrice: price, costPriceSnapshot: cost,
      discount: disc, lineTotal: qty * price - disc, updatedAt: ts,
    });
    await json('POST', '/v1/backup/push', token, {
      tables: {
        customers: [{ id: cust, name: 'Bu Ani', phone: '0812', updatedAt: ts }],
        transactions: [
          // Lunas tunai: item 2×5000 (modal 3000) + 1×4000 (modal 2500, diskon item 500); diskon nota 1000
          { id: txPaid, invoiceNo: `A-${tag}`, datetime: ts, subtotal: 13500, discountTotal: 1000, taxTotal: 0,
            grandTotal: 12500, paidTotal: 20000, changeTotal: 7500, status: 'paid', isCredit: false, updatedAt: ts },
          // Hutang: 3×2000 (modal 1500), bayar DP 2000, pelunasan 3000 → sisa 1000
          { id: txCredit, invoiceNo: `B-${tag}`, datetime: ts + 60_000, customerId: cust, subtotal: 6000, discountTotal: 0,
            taxTotal: 0, grandTotal: 6000, paidTotal: 2000, changeTotal: 0, status: 'partial', isCredit: true, updatedAt: ts },
          // Void: tak boleh dihitung
          { id: txVoid, invoiceNo: `C-${tag}`, datetime: ts, subtotal: 99000, discountTotal: 0, grandTotal: 99000,
            paidTotal: 99000, changeTotal: 0, status: 'void', updatedAt: ts },
        ],
        transaction_items: [
          it(txPaid, 'Kopi', 2, 5000, 3000),
          it(txPaid, 'Teh', 1, 4000, 2500, 500),
          it(txCredit, 'Roti', 3, 2000, 1500),
          it(txVoid, 'Rokok', 3, 33000, 30000),
        ],
        payments: [
          { id: uuid(), transactionId: txPaid, method: 'cash', amount: 20000, updatedAt: ts },
          { id: uuid(), transactionId: txCredit, method: 'qris', amount: 2000, updatedAt: ts },
          { id: uuid(), transactionId: txVoid, method: 'cash', amount: 99000, updatedAt: ts },
        ],
        installments: [{ id: uuid(), transactionId: txCredit, dueDate: ts + 7 * 86_400_000, amountDue: 4000, amountPaid: 3000, status: 'pending', updatedAt: ts }],
        credit_payments: [{ id: uuid(), customerId: cust, transactionId: txCredit, amount: 3000, datetime: ts + 86_400_000, method: 'transfer', note: 'cicil 1', updatedAt: ts }],
      },
    });

    const body = new URLSearchParams({ user: process.env.DASHBOARD_USER!, password: process.env.DASHBOARD_PASSWORD! }).toString();
    const res = await app.request('/dashboard/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
  });

  afterAll(async () => {
    if (bid) await sql`DELETE FROM businesses WHERE id = ${bid}`;
    await sql.end({ timeout: 5 });
  });

  it('rentang periode: preset & custom (WIB)', () => {
    const now = Date.parse('2026-11-02T08:00:00+07:00');
    expect(resolveRange({}, now)).toMatchObject({ preset: 'month', from: '2026-11-01', to: '2026-11-02' });
    expect(resolveRange({ preset: 'lastmonth' }, now)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    const c = resolveRange({ from: '2026-10-20', to: '2026-10-01' }, now);
    expect(c).toMatchObject({ preset: 'custom', from: '2026-10-01', to: '2026-10-20' });
    expect(c.fromMs).toBe(Date.parse('2026-10-01T00:00:00+07:00'));
    expect(c.toMs).toBe(Date.parse('2026-10-21T00:00:00+07:00'));
  });

  it('laporan: laba rugi §9 benar, void dikecualikan, piutang & uang masuk', async () => {
    const r = await get(`/dashboard/businesses/${bid}?tab=report&from=2026-10-01&to=2026-10-31`);
    expect(r.status).toBe(200);
    const h = r.html;
    // Penjualan kotor = 10000 + 3500 + 6000 = 19500; diskon nota 1000 → pendapatan 18500
    expect(h).toContain('Rp 19.500');
    expect(h).toContain('Rp 18.500');
    // HPP = 6000 + 2500 + 4500 = 13000 → laba kotor 5500
    expect(h).toContain('Rp 13.000');
    expect(h).toContain('Rp 5.500');
    // Omzet = 12500 + 6000 = 18500 (void 99000 tak dihitung); piutang 6000-2000-3000 = 1000
    expect(h).toContain('Rp 1.000');
    expect(h).toContain('Rp 99.000'); // hanya di baris "Dibatalkan (tidak dihitung)"
    // Uang masuk: tunai 20000-7500 = 12500, QRIS 2000, pelunasan 3000 → 17500
    expect(h).toContain('Rp 17.500');
    expect(h).not.toContain('Rokok'); // produk dari nota void tak masuk terlaris
    expect(h).toContain('id="biz-tabs"');
  });

  it('tab transaksi → detail nota: item, pembayaran, cicilan, pelunasan, sisa tagihan', async () => {
    const list = await get(`/dashboard/businesses/${bid}?tab=transactions`);
    expect(list.html).toContain(`/dashboard/businesses/${bid}/transactions/${txCredit}`);

    const d = await get(`/dashboard/businesses/${bid}/transactions/${txCredit}`);
    expect(d.status).toBe(200);
    expect(d.html).toContain(`B-${tag}`);
    expect(d.html).toContain('Bu Ani');
    expect(d.html).toContain('Roti');
    expect(d.html).toContain('QRIS');
    expect(d.html).toContain('cicil 1');
    expect(d.html).toContain('Sisa tagihan Rp 1.000');

    const paid = await get(`/dashboard/businesses/${bid}/transactions/${txPaid}`);
    expect(paid.html).toContain('✓ Lunas');
    expect(paid.html).toContain('Rp 7.500'); // kembalian

    const v = await get(`/dashboard/businesses/${bid}/transactions/${txVoid}`);
    expect(v.html).toContain('Transaksi dibatalkan');

    expect((await get(`/dashboard/businesses/${bid}/transactions/${uuid()}`)).status).toBe(404);
  });

  it('Saran: app kirim (validasi, auth), riwayat sendiri, admin tindak lanjuti', async () => {
    expect((await json('POST', '/v1/feedback', undefined, { message: 'halo' })).status).toBe(401);
    expect((await json('POST', '/v1/feedback', token, { message: 'x' })).status).toBe(422);

    const created = await json('POST', '/v1/feedback', token, {
      category: 'masalah', message: `Struk tidak tercetak ${tag}`, contact: '0812-1', appVersion: '1.2.0', platform: 'android',
    });
    expect(created.status).toBe(201);
    expect(created.json.data).toMatchObject({ status: 'baru', category: 'masalah' });
    const fid = created.json.data.id as string;

    const mine = await json('GET', '/v1/feedback', token);
    expect(mine.json.data.map((x: { id: string }) => x.id)).toContain(fid);

    const page = await get('/dashboard/feedback');
    expect(page.html).toContain(`Struk tidak tercetak ${tag}`);
    expect(page.html).toContain('Pak Lapor');

    const body = new URLSearchParams({ status: 'selesai', adminNote: 'Sudah diperbaiki di v1.2.1', back: '/dashboard/feedback?status=semua' }).toString();
    const upd = await app.request(`/dashboard/feedback/${fid}`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    expect(upd.status).toBe(302);
    expect(upd.headers.get('location')).toBe('/dashboard/feedback?status=semua');

    const after = await json('GET', '/v1/feedback', token);
    expect(after.json.data.find((x: { id: string }) => x.id === fid)).toMatchObject({
      status: 'selesai', adminNote: 'Sudah diperbaiki di v1.2.1',
    });

    const perStore = await get(`/dashboard/feedback?status=semua&business=${bid}`);
    expect(perStore.html).toContain(`Toko Lap ${tag}`);
  });
});
