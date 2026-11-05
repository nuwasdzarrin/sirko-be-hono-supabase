import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app.js';
import { sql } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import * as subscriptions from '../../src/services/subscription.service.js';
import { req, register } from './juragan-helpers.js';

/**
 * Contract test dashboard admin Langganan (/dashboard/subscriptions):
 * gerbang sesi, antrian, konfirmasi/tolak lewat form, perpanjang/potong
 * manual, ubah harga & data QRIS. Butuh Postgres + kredensial dashboard test.
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

suite('Juragan — dashboard admin langganan', () => {
  let cookie = '';

  async function page(path: string) {
    const res = await app.request(path, { headers: { Cookie: cookie }, redirect: 'manual' });
    return { status: res.status, location: res.headers.get('location'), html: await res.text() };
  }

  /** POST form; kembalikan redirect + isi flash pada halaman tujuan. */
  async function post(path: string, data: Record<string, string>) {
    const res = await app.request(path, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data).toString(),
    });
    const flashCookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const next = res.headers.get('location');
    let flash = '';
    if (next) {
      const r2 = await app.request(next, { headers: { Cookie: `${cookie}; ${flashCookie}` } });
      flash = (await r2.text()).match(/<div class="flash[^"]*"[^>]*>([^<]*)<\/div>/)?.[1] ?? '';
    }
    return { status: res.status, location: next, flash };
  }

  beforeAll(async () => {
    await runMigrations(sql);
    const body = new URLSearchParams({ user: process.env.DASHBOARD_USER!, password: process.env.DASHBOARD_PASSWORD! }).toString();
    const res = await app.request('/dashboard/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
  });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('tanpa sesi admin → diarahkan ke login', async () => {
    const res = await app.request('/dashboard/subscriptions/settings', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/dashboard/login?next=');
    const p = await app.request('/dashboard/subscriptions/payments/x/confirm', { method: 'POST', redirect: 'manual' });
    expect(p.status).toBe(302);
  });

  it('antrian menampilkan pending; konfirmasi lewat form → Juragan aktif + flash', async () => {
    const a = await register('jd');
    const co = (await req('POST', '/v1/plan/checkout', { period: 'monthly' }, a.token)).json.data;
    const q = await page('/dashboard/subscriptions');
    expect(q.status).toBe(200);
    expect(q.html).toContain(a.email);
    expect(q.html).toContain(new Intl.NumberFormat('id-ID').format(co.amount));
    expect(q.html).toContain('href="/dashboard/subscriptions">Langganan'); // link nav

    const r = await post(`/dashboard/subscriptions/payments/${co.id}/confirm`, { back: '/dashboard/subscriptions' });
    expect(r.location).toBe('/dashboard/subscriptions');
    expect(r.flash).toContain('Juragan aktif s/d');
    const st = await req('GET', `/v1/plan/checkout/${co.id}`, undefined, a.token);
    expect(st.json.data).toMatchObject({ status: 'confirmed', plan: { name: 'juragan' } });
    const [p] = await sql<{ reviewed_by: string }[]>`SELECT reviewed_by FROM subscription_payments WHERE id = ${co.id}`;
    expect(p!.reviewed_by).toBe(process.env.DASHBOARD_USER);

    // Konfirmasi ganda → flash error, tak ada langganan kedua.
    const again = await post(`/dashboard/subscriptions/payments/${co.id}/confirm`, { back: '/dashboard/subscriptions' });
    expect(again.flash).toContain('sudah dikonfirmasi');
    const subs = await sql`SELECT id FROM subscriptions WHERE payment_id = ${co.id}`;
    expect(subs).toHaveLength(1);
  });

  it('tolak wajib alasan; alasan tampil ke pengguna; back URL luar ditolak', async () => {
    const a = await register('jd');
    const co = (await req('POST', '/v1/plan/checkout', { period: 'yearly' }, a.token)).json.data;
    const empty = await post(`/dashboard/subscriptions/payments/${co.id}/reject`, { note: ' ', back: '/dashboard/subscriptions' });
    expect(empty.flash).toContain('Alasan penolakan wajib');
    const ok = await post(`/dashboard/subscriptions/payments/${co.id}/reject`, { note: 'Nominal tidak cocok', back: 'https://evil.example' });
    expect(ok.location).toBe('/dashboard/subscriptions');
    expect((await req('GET', `/v1/plan/checkout/${co.id}`, undefined, a.token)).json.data).toMatchObject({
      status: 'rejected', note: 'Nominal tidak cocok',
    });
    const hist = await page('/dashboard/subscriptions/payments?status=rejected');
    expect(hist.html).toContain('Nominal tidak cocok');
  });

  it('detail akun: perpanjang manual (catatan wajib) lalu potong → warung; riwayat tetap', async () => {
    const a = await register('jd');
    const url = `/dashboard/subscriptions/accounts/${a.accountId}`;
    expect((await page(url)).html).toContain('Belum pernah berlangganan');

    expect((await post(`${url}/extend`, { period: 'monthly', note: '' })).flash).toContain('Catatan wajib');
    const ext = await post(`${url}/extend`, { period: 'yearly', note: 'Kompensasi gangguan' });
    expect(ext.flash).toContain('+1 tahun');
    const me = (await req('GET', '/v1/me', undefined, a.token)).json.data.plan;
    expect(me).toMatchObject({ name: 'juragan', period: 'yearly' });
    const detail = await page(url);
    expect(detail.html).toContain('Kompensasi gangguan');
    expect(detail.html).toContain(`admin:${process.env.DASHBOARD_USER}`);

    const cut = await post(`${url}/cancel`, { note: 'Uji potong' });
    expect(cut.flash).toContain('kembali ke Warung');
    expect((await req('GET', '/v1/me', undefined, a.token)).json.data.plan.name).toBe('warung');
    const after = await page(url);
    expect(after.html).toContain('Dipotong');
    // Sync tetap jalan setelah dipotong (§5.7).
    expect((await req('GET', '/v1/backup/pull', undefined, a.token)).status).toBe(200);

    const list = await page(`/dashboard/subscriptions/accounts?q=${encodeURIComponent(a.email)}`);
    expect(list.html).toContain(a.email);
    expect((await page('/dashboard/subscriptions/accounts/00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('ubah harga & data QRIS → langsung terbaca di GET /v1/plans', async () => {
    const a = await register('jd');
    try {
      const pr = await post('/dashboard/subscriptions/settings/price', { period: 'monthly', amount: '59000', maxStores: '3' });
      expect(pr.flash).toContain('59.000');
      const bad = await post('/dashboard/subscriptions/settings/price', { period: 'monthly', amount: '0', maxStores: '3' });
      expect(bad.flash).toContain('Harga harus');

      const http = await post('/dashboard/subscriptions/settings/payment', { qrisUrl: 'http://tidak-aman/q.png' });
      expect(http.flash).toContain('https://');
      const pay = await post('/dashboard/subscriptions/settings/payment', {
        qrisUrl: 'https://cdn.example/qris-baru.png', bankName: 'BRI', accountNo: '0011', accountName: 'Sirko', note: 'Bayar persis',
      });
      expect(pay.flash).toBe('Data pembayaran disimpan.');

      const plansRes = (await req('GET', '/v1/plans', undefined, a.token)).json.data;
      expect(plansRes.prices[0]).toMatchObject({ period: 'monthly', amount: 59000 });
      expect(plansRes.payment).toEqual({
        qrisUrl: 'https://cdn.example/qris-baru.png', bankName: 'BRI', accountNo: '0011', accountName: 'Sirko', note: 'Bayar persis',
      });
      const settings = await page('/dashboard/subscriptions/settings');
      expect(settings.html).toContain('value="59000"');
      expect(settings.html).toContain('qris-baru.png');
    } finally {
      await subscriptions.setPrice('monthly', 49000, 3);
    }
  });
});
