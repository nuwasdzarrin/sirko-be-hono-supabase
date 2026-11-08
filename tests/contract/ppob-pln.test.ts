import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { app } from '../../src/app.js';
import { sql } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { uuid } from '../../src/lib/uuid.js';
import { setNotifyTransport, type AdminNotice } from '../../src/lib/notify.js';
import { setMailTransport, type MailMessage } from '../../src/lib/mail.js';
import { setDigiflazzTransport } from '../../src/ppob/digiflazz.js';
import * as points from '../../src/services/points.service.js';
import * as ppob from '../../src/services/ppob.service.js';
import { registerOwnerStore } from '../helpers/owner-store.js';

/**
 * Contract test tahap 3 — token listrik MANUAL: order → menunggu admin (Telegram) →
 * admin tempel token → email (Resend palsu); gagalkan → refund + email; pengingat.
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

suite('PPOB tahap 3 — token listrik manual', () => {
  const tag = uuid().slice(0, 8);
  const denom = 20_000 + (parseInt(tag.slice(0, 4), 16) % 900) * 1000; // nominal unik per run
  let token = '';
  let businessId = '';
  let accountId = '';
  let productId = '';
  const notices: AdminNotice[] = [];
  const mails: MailMessage[] = [];
  const dfCalls: string[] = [];
  const restores: Array<() => void> = [];
  const meter = `5${tag.replace(/\D/g, '').padEnd(10, '7').slice(0, 10)}`; // 11 digit

  beforeAll(async () => {
    await runMigrations(sql);
    restores.push(setNotifyTransport(async (n) => void notices.push(n)));
    restores.push(setMailTransport(async (m) => (mails.push(m), { ok: true, id: `mail-${mails.length}` })));
    restores.push(
      setDigiflazzTransport(async (path, body) => {
        dfCalls.push(path);
        if (path === '/inquiry-pln') {
          if (String(body.customer_no) === '55555555555') return { status: 'Gagal', rc: '41', message: 'Signature Anda salah' };
          if (String(body.customer_no) === '77777777777') return { status: 'Gagal', rc: '02', message: 'Transaksi Gagal' };
          if (String(body.customer_no) === '66666666666') return { status: 'Gagal', rc: '70', message: 'Timeout dari biller' };
          return String(body.customer_no) === meter
            ? { status: 'Sukses', rc: '00', customer_no: meter, name: 'BUDI SANTOSO', segment_power: 'R1 /000001300' }
            : { status: 'Gagal', rc: '14', message: 'Nomor meter tidak ditemukan' };
        }
        throw new Error('Digiflazz tidak boleh dipanggil untuk ' + path);
      }),
    );
    await sql`DELETE FROM app_config WHERE key = 'ppob'`;
    const r = await registerOwnerStore({
      business: { name: `Toko Listrik ${tag}` },
      owner: { name: 'Pak Listrik', email: `pln-${tag}@toko.id`, password: 'rahasia123' },
    });
    token = r.json.data.accessToken;
    businessId = r.json.data.business.id;
    accountId = (await points.ownerAccountId(businessId))!;
    await points.adminAdjust(accountId, 10_000_000, 'saldo uji PLN', 'tester', businessId);
  });

  beforeEach(() => {
    notices.length = 0;
    mails.length = 0;
    dfCalls.length = 0;
  });

  afterAll(async () => {
    restores.forEach((r) => r());
    await sql`DELETE FROM ppob_orders WHERE business_id = ${businessId}`;
    await sql`DELETE FROM ppob_products WHERE provider = 'manual' AND sku = ${`pln-${denom}`}`;
    await sql`DELETE FROM ppob_pln_cache WHERE meter_no = ${meter}`;
    await sql`ALTER TABLE point_ledger DISABLE TRIGGER trg_point_ledger_immutable`;
    await sql`DELETE FROM point_ledger WHERE account_id = ${accountId}`;
    await sql`ALTER TABLE point_ledger ENABLE TRIGGER trg_point_ledger_immutable`;
    await sql`DELETE FROM point_accounts WHERE account_id = ${accountId}`;
    await sql.end({ timeout: 5 });
  });

  const balance = () => points.balanceOf(accountId);
  const buy = (customerNo: string, notifyEmail?: string) =>
    req('POST', '/v1/ppob/orders', token, { clientRef: uuid(), productId, customerNo, ...(notifyEmail ? { notifyEmail } : {}) });

  it('unit: format token 20 digit & nomor meter', () => {
    expect(ppob.formatPlnToken('1234 5678 9012 3456 7890')).toBe('1234-5678-9012-3456-7890');
    expect(ppob.formatPlnToken('1234-5678')).toBeNull();
    expect(ppob.formatPlnToken('abcd5678901234567890')).toBeNull();
    expect(ppob.normalizeMeter('5123 4567 890')).toBe('51234567890');
    expect(ppob.normalizeMeter('123')).toBeNull();
  });

  it('produk token: harga Poin = modal + markup PLN; nominal sama = perbarui', async () => {
    await expect(ppob.adminSavePlnProduct({ denom, cost: 1000 })).rejects.toMatchObject({ code: 'VALIDATION' });
    await ppob.adminSavePlnProduct({ denom, cost: denom + 1_000 });
    await ppob.adminSavePlnProduct({ denom, cost: denom + 1_200 });
    const rows = (await ppob.adminListPlnProducts()).filter((p) => p.denom === denom);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cost: denom + 1_200, price: denom + 2_700, active: true }); // +1500, bulat 100
    productId = rows[0]!.id;
    const list = await req('GET', '/v1/ppob/products?category=pln', token);
    expect(list.json.data.find((p: { id: string }) => p.id === productId)).toMatchObject({ category: 'pln', brand: 'PLN', price: denom + 2_700 });
  });

  it('cek nomor meter: nama pelanggan, cache 24 jam, nomor salah', async () => {
    const r = await req('POST', '/v1/ppob/pln/inquiry', token, { meterNo: meter });
    expect(r.json.data).toMatchObject({ ok: true, name: 'BUDI SANTOSO', segmentPower: 'R1 /000001300', cached: false });
    const again = await req('POST', '/v1/ppob/pln/inquiry', token, { meterNo: meter });
    expect(again.json.data).toMatchObject({ cached: true, ok: true, message: null });
    expect(dfCalls.filter((p) => p === '/inquiry-pln')).toHaveLength(1);
    const bad = await req('POST', '/v1/ppob/pln/inquiry', token, { meterNo: '99999999999' });
    expect(bad.json.data).toMatchObject({ ok: false, message: expect.stringMatching(/tidak dikenali PLN/) });
    expect((await req('POST', '/v1/ppob/pln/inquiry', token, { meterNo: '123' })).status).toBe(422);
    await sql`DELETE FROM ppob_pln_cache WHERE meter_no = '99999999999'`;
  });

  it('cek meter: salah konfigurasi (RC 41) → pesan ramah, tak di-cache, admin diberi tahu; gangguan sementara tak di-cache', async () => {
    const before = dfCalls.length;
    const n0 = notices.length;
    const r = await req('POST', '/v1/ppob/pln/inquiry', token, { meterNo: '55555555555' });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ ok: false, cached: false, message: expect.stringMatching(/sedang bermasalah.*tetap bisa dilanjutkan/) });
    expect(r.json.data.message).not.toMatch(/Signature/);
    const again = await req('POST', '/v1/ppob/pln/inquiry', token, { meterNo: '55555555555' });
    expect(again.json.data.cached).toBe(false);
    expect(dfCalls.length - before).toBe(2);
    await new Promise((res) => setTimeout(res, 20));
    expect(notices.slice(n0).filter((x) => /konfigurasi Digiflazz/.test(x.text))).toHaveLength(1); // maks 1×/jam
    const tmp = await req('POST', '/v1/ppob/pln/inquiry', token, { meterNo: '66666666666' });
    expect(tmp.json.data).toMatchObject({ ok: false, cached: false });
    const rc02 = await req('POST', '/v1/ppob/pln/inquiry', token, { meterNo: '77777777777' });
    expect(rc02.json.data).toMatchObject({ ok: false, cached: false, message: expect.stringMatching(/tidak dikenali PLN/) });
    expect((await sql`SELECT count(*)::int AS n FROM ppob_pln_cache WHERE meter_no IN ('55555555555', '66666666666', '77777777777')`)[0]!.n).toBe(0);
  });

  let fulfilledId = '';

  it('order token: Poin terpotong, menunggu admin, Telegram ke admin, Digiflazz TIDAK dipanggil', async () => {
    const before = await balance();
    const r = await buy(meter, 'pembeli@contoh.id');
    expect(r.status).toBe(201);
    expect(r.json.data).toMatchObject({ status: 'waiting_admin', category: 'pln', customerNo: meter, plnName: 'BUDI SANTOSO', sn: null });
    expect(r.json.data.message).toMatch(/admin Sirko/);
    expect(await balance()).toBe(before - (denom + 2_700));
    expect(dfCalls).toEqual([]);
    await new Promise((res) => setTimeout(res, 20));
    const n = notices.find((x) => x.text.includes('Order token listrik baru'))!;
    expect(n.text).toContain(meter);
    expect(n.linkPath).toBe(`/dashboard/ppob/orders/${r.json.data.id}`);
    fulfilledId = r.json.data.id;
    // Pengecekan otomatis tak menyentuh order manual.
    expect((await ppob.checkStatus(fulfilledId)).checked).toBe(false);
  });

  it('admin tempel token → sukses + email ke pemilik & pembeli; app melihat token; tak bisa diproses ulang', async () => {
    expect((await ppob.adminFulfillPln(fulfilledId, '1234', 'admin-uji')).ok).toBe(false);
    const r = await ppob.adminFulfillPln(fulfilledId, '1234 5678 9012 3456 7890', 'admin-uji', { plnInfo: '13,2 kWh' });
    expect(r.ok).toBe(true);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to.sort()).toEqual(['pembeli@contoh.id', `pln-${tag}@toko.id`].sort());
    expect(mails[0]!.subject).toMatch(/Token listrik Anda sudah tersedia/);
    expect(mails[0]!.html).toContain('1234-5678-9012-3456-7890');
    expect(mails[0]!.text).toContain(meter);

    const app1 = await req('GET', `/v1/ppob/orders/${fulfilledId}`, token);
    expect(app1.json.data).toMatchObject({ status: 'success', sn: '1234-5678-9012-3456-7890' });

    const twice = await ppob.adminFulfillPln(fulfilledId, '9999 9999 9999 9999 9999', 'admin-uji');
    expect(twice.ok).toBe(false);
    expect((await sql`SELECT sn FROM ppob_orders WHERE id = ${fulfilledId}`)[0]!.sn).toBe('1234-5678-9012-3456-7890');
    const ev = await sql`SELECT event FROM ppob_order_events WHERE order_id = ${fulfilledId} ORDER BY created_at`;
    expect(ev.map((e) => e.event)).toEqual(expect.arrayContaining(['created', 'admin_fulfilled', 'email_sent']));
  });

  it('admin gagalkan → refund sekali + email pembatalan; alasan wajib', async () => {
    const before = await balance();
    const r = await buy(meter);
    expect((await ppob.adminFailPln(r.json.data.id, '  ', 'admin-uji')).ok).toBe(false);
    const f = await ppob.adminFailPln(r.json.data.id, 'Nomor meter diblokir PLN', 'admin-uji');
    expect(f.ok).toBe(true);
    expect(await balance()).toBe(before);
    expect((await ppob.adminFailPln(r.json.data.id, 'lagi', 'admin-uji')).ok).toBe(false);
    const led = await sql`SELECT type FROM point_ledger WHERE ref_type = 'ppob_order' AND ref_id = ${r.json.data.id}`;
    expect(led.map((l) => l.type).sort()).toEqual(['purchase', 'refund']);
    expect(mails.at(-1)!.subject).toMatch(/dibatalkan/);
    expect(mails.at(-1)!.text).toContain('Nomor meter diblokir PLN');
    const app1 = await req('GET', `/v1/ppob/orders/${r.json.data.id}`, token);
    expect(app1.json.data).toMatchObject({ status: 'failed', refunded: true });
  });

  it('pengingat: order menunggu > 30 menit → 1 pesan Telegram, tak diulang dalam 30 menit', async () => {
    const r = await buy(meter);
    await sql`UPDATE ppob_orders SET created_at = created_at - 3600000, last_checked_at = last_checked_at - 3600000 WHERE id = ${r.json.data.id}`;
    notices.length = 0;
    expect(await ppob.remindWaitingPln()).toBeGreaterThanOrEqual(1);
    await new Promise((res) => setTimeout(res, 20));
    expect(notices.some((n) => n.text.includes('belum diproses') && n.text.includes(meter))).toBe(true);
    expect(await ppob.remindWaitingPln()).toBe(0);
    await ppob.adminFulfillPln(r.json.data.id, '11112222333344445555', 'admin-uji');
  });

  it('Resend belum dikonfigurasi → order tetap sukses, kejadian email_skipped tercatat', async () => {
    restores.push(setMailTransport(async () => ({ ok: false, skipped: true, error: 'Resend belum dikonfigurasi' })));
    const r = await buy(meter);
    const f = await ppob.adminFulfillPln(r.json.data.id, '22223333444455556666', 'admin-uji');
    expect(f.ok).toBe(true);
    const ev = await sql`SELECT event FROM ppob_order_events WHERE order_id = ${r.json.data.id}`;
    expect(ev.map((e) => e.event)).toContain('email_skipped');
    const resend = await ppob.adminResendPlnEmail(r.json.data.id);
    expect(resend.ok).toBe(false);
  });

  it('dashboard: panel proses token & tempel lewat form', async () => {
    restores.push(setMailTransport(async (m) => (mails.push(m), { ok: true, id: 'x' })));
    const login = await app.request('/dashboard/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ user: process.env.DASHBOARD_USER!, password: process.env.DASHBOARD_PASSWORD! }).toString(),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
    const r = await buy(meter);
    const page = await (await app.request(`/dashboard/ppob/orders/${r.json.data.id}`, { headers: { Cookie: cookie } })).text();
    expect(page).toContain('Proses token listrik');
    expect(page).toContain(`pln-${tag}@toko.id`);
    const post = await app.request(`/dashboard/ppob/orders/${r.json.data.id}/fulfill`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: '5555 6666 7777 8888 9999', plnName: 'BUDI S', plnInfo: '' }).toString(),
    });
    expect(post.status).toBe(302);
    const o = (await sql`SELECT status, sn, pln_name, fulfilled_by FROM ppob_orders WHERE id = ${r.json.data.id}`)[0]!;
    expect(o).toMatchObject({ status: 'success', sn: '5555-6666-7777-8888-9999', pln_name: 'BUDI S', fulfilled_by: process.env.DASHBOARD_USER });
    const products = await (await app.request('/dashboard/ppob?tab=products', { headers: { Cookie: cookie } })).text();
    expect(products).toContain('Token listrik (dibeli manual oleh admin)');
  });

  it('saldo Poin = Σ ledger', async () => {
    const s = await sql<{ s: string }[]>`SELECT coalesce(sum(amount),0) s FROM point_ledger WHERE account_id = ${accountId}`;
    expect(Number(s[0]!.s)).toBe(await balance());
  });
});
