import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app.js';
import { sql } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { uuid } from '../../src/lib/uuid.js';
import { hashPassword } from '../../src/lib/password.js';
import { setMailTransport, type MailMessage } from '../../src/lib/mail.js';
import { setTelegramApi, webhookSecret } from '../../src/lib/telegram.js';
import { setNotifyTransport, type AdminNotice } from '../../src/lib/notify.js';
import * as adminSvc from '../../src/services/admin.service.js';
import * as points from '../../src/services/points.service.js';
import * as ppob from '../../src/services/ppob.service.js';
import { registerOwnerStore } from '../helpers/owner-store.js';

/**
 * Contract test admin dashboard (migrasi 0014): login dari DB, lupa/reset password via OTP email,
 * ganti password (sesi lama gugur), profil + tautan Telegram, menu Pengguna, navbar berkelompok,
 * dan bot admin Telegram (webhook): ringkasan, antrean, isi token PLN & konfirmasi top-up via chat.
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

const tag = uuid().slice(0, 8);
const EMAIL = `adm-${tag}@contoh.id`;
const PASS = 'rahasia-admin-1';
const IP = `10.77.${parseInt(tag.slice(0, 2), 16)}.${parseInt(tag.slice(2, 4), 16)}`;
const CHAT = 700_000_000 + parseInt(tag.slice(0, 6), 16);

const form = (data: Record<string, string>, cookie?: string) => ({
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'cf-connecting-ip': IP,
    ...(cookie ? { Cookie: cookie } : {}),
  },
  body: new URLSearchParams(data).toString(),
  redirect: 'manual' as const,
});
const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0]!;

async function login(email = EMAIL, password = PASS) {
  const res = await app.request('/dashboard/login', form({ user: email, password, next: '/dashboard' }));
  return { status: res.status, cookie: cookieOf(res), html: res.status === 302 ? '' : await res.text() };
}
async function get(path: string, cookie: string) {
  const res = await app.request(path, { headers: { Cookie: cookie }, redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location'), html: await res.text() };
}

suite('Admin dashboard — akun, password, profil, pengguna, bot Telegram', () => {
  const mails: MailMessage[] = [];
  const notices: AdminNotice[] = [];
  const tgCalls: Array<{ method: string; body: Record<string, any> }> = [];
  const restores: Array<() => void> = [];
  let adminId = '';
  let cookie = '';

  beforeAll(async () => {
    await runMigrations(sql);
    await adminSvc.ensureBootstrap(); // admin .env (dipakai test lain) harus ada lebih dulu
    restores.push(setMailTransport(async (m) => (mails.push(m), { ok: true, id: `m-${mails.length}` })));
    restores.push(setNotifyTransport(async (n) => void notices.push(n)));
    restores.push(
      setTelegramApi(async (method, body) => {
        tgCalls.push({ method, body });
        if (method === 'getMe') return { username: 'sirko_uji_bot' };
        return { message_id: tgCalls.length };
      }),
    );
    adminId = uuid();
    const ts = Date.now();
    await sql`INSERT INTO admin_users ${sql({ id: adminId, email: EMAIL, name: 'Admin Uji', password_hash: await hashPassword(PASS), password_changed_at: 0, created_at: ts, updated_at: ts })}`;
  });

  afterAll(async () => {
    restores.forEach((r) => r());
    await sql`DELETE FROM admin_users WHERE id = ${adminId}`;
    await sql`DELETE FROM auth_throttle WHERE key LIKE ${'adm%' + tag + '%'} OR key = ${'adm-ip:' + IP}`;
    await sql.end({ timeout: 5 });
  });

  it('login admin dari database; email salah/password salah → 401 seragam', async () => {
    const bad = await login(EMAIL, 'salah-sekali');
    expect(bad.status).toBe(401);
    expect(bad.html).toContain('Email atau password salah');
    expect(bad.html).toContain('href="/dashboard/forgot"');
    const r = await login();
    expect(r.status).toBe(302);
    cookie = r.cookie;
    const home = await get('/dashboard', cookie);
    expect(home.status).toBe(200);
    // Navbar berkelompok + menu akun berisi nama admin.
    expect(home.html).toContain('href="/dashboard/users">Pengguna terdaftar');
    expect(home.html).toContain('href="/dashboard/profile"');
    expect(home.html).toContain('Admin Uji');
  });

  it('lupa password: OTP 6 digit ke email → reset → masuk; sesi lama gugur', async () => {
    const f = await app.request('/dashboard/forgot', form({ email: EMAIL }));
    expect(f.status).toBe(200);
    expect(await f.text()).toContain('kode 6 digit sudah dikirim');
    const mail = mails.at(-1)!;
    expect(mail.to).toEqual([EMAIL]);
    const code = /^(\d{6}) — kode reset password/.exec(mail.subject)![1]!;

    const wrong = await app.request('/dashboard/reset', form({ email: EMAIL, code: code === '000000' ? '111111' : '000000', password: 'baru-sekali-123', confirm: 'baru-sekali-123' }));
    expect(wrong.status).toBe(422);
    expect(await wrong.text()).toMatch(/Kode salah/);

    const ok = await app.request('/dashboard/reset', form({ email: EMAIL, code, password: 'baru-sekali-123', confirm: 'baru-sekali-123' }));
    expect(ok.status).toBe(302);
    expect(ok.headers.get('location')).toBe('/dashboard');
    const fresh = cookieOf(ok);
    expect((await get('/dashboard/profile', fresh)).status).toBe(200);
    // Cookie lama (sebelum reset) tidak berlaku lagi.
    const old = await get('/dashboard', cookie);
    expect(old.status).toBe(302);
    expect(old.location).toMatch(/^\/dashboard\/login/);
    // Kode sekali pakai.
    const again = await app.request('/dashboard/reset', form({ email: EMAIL, code, password: 'lagi-lagi-123', confirm: 'lagi-lagi-123' }));
    expect(again.status).toBe(422);
    cookie = fresh;
  });

  it('email tak terdaftar → jawaban sama, tanpa email', async () => {
    const n = mails.length;
    const r = await app.request('/dashboard/forgot', form({ email: `tidak-ada-${tag}@contoh.id` }));
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('kode 6 digit sudah dikirim');
    expect(mails.length).toBe(n);
  });

  it('profil: ganti password (lama wajib benar) → sesi ini tetap, login pakai password baru', async () => {
    const bad = await app.request('/dashboard/profile/password', form({ current: 'keliru', password: 'ganti-lagi-123', confirm: 'ganti-lagi-123' }, cookie));
    expect(bad.status).toBe(422);
    expect(await bad.text()).toContain('Password lama salah');
    const ok = await app.request('/dashboard/profile/password', form({ current: 'baru-sekali-123', password: 'ganti-lagi-123', confirm: 'ganti-lagi-123' }, cookie));
    expect(ok.status).toBe(302);
    cookie = cookieOf(ok);
    expect((await get('/dashboard/profile', cookie)).status).toBe(200);
    expect((await login(EMAIL, 'ganti-lagi-123')).status).toBe(302);
  });

  it('5× salah password → terkunci (429) walau password benar', async () => {
    const lockEmail = `kunci-${tag}@contoh.id`;
    const id = uuid();
    await sql`INSERT INTO admin_users ${sql({ id, email: lockEmail, name: 'Kunci', password_hash: await hashPassword(PASS), password_changed_at: 0, created_at: Date.now(), updated_at: Date.now() })}`;
    try {
      for (let i = 0; i < 5; i++) await app.request('/dashboard/login', { ...form({ user: lockEmail, password: 'x' }), headers: { ...form({}).headers, 'cf-connecting-ip': `10.78.0.${i + 1}` } });
      const r = await app.request('/dashboard/login', { ...form({ user: lockEmail, password: PASS }), headers: { ...form({}).headers, 'cf-connecting-ip': '10.78.0.99' } });
      expect(r.status).toBe(429);
      expect(await r.text()).toMatch(/Terlalu banyak percobaan/);
    } finally {
      await sql`DELETE FROM admin_users WHERE id = ${id}`;
      await sql`DELETE FROM auth_throttle WHERE key = ${'adm:' + lockEmail} OR key LIKE 'adm-ip:10.78.0.%'`;
    }
  });

  it('tautan Telegram: tombol Hubungkan → deep link → /start <token> di bot menautkan chat', async () => {
    const page = await app.request('/dashboard/profile/telegram/link', form({}, cookie));
    const html = await page.text();
    const link = /https:\/\/t\.me\/sirko_uji_bot\?start=([\w-]+)/.exec(html);
    expect(link).not.toBeNull();
    const send = (u: unknown) =>
      app.request('/v1/webhooks/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': webhookSecret() },
        body: JSON.stringify(u),
      });
    // Secret salah → 403.
    const forged = await app.request('/v1/webhooks/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'palsu' }, body: '{}' });
    expect(forged.status).toBe(403);
    // Chat belum tertaut → arahan menautkan.
    tgCalls.length = 0;
    await send({ update_id: 1, message: { message_id: 1, chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, text: '/ringkasan' } });
    expect(tgCalls.find((c) => c.method === 'sendMessage')?.body.text).toMatch(/belum tertaut/);
    // /start <token> → tertaut.
    tgCalls.length = 0;
    expect((await send({ update_id: 2, message: { message_id: 2, chat: { id: CHAT, type: 'private' }, from: { id: CHAT, username: 'adminuji' }, text: `/start ${link![1]}` } })).status).toBe(200);
    expect(tgCalls.find((c) => c.method === 'sendMessage')?.body.text).toMatch(/sudah tertaut/);
    const a = (await adminSvc.adminById(adminId))!;
    expect(a).toMatchObject({ telegramChatId: CHAT, telegramUsername: 'adminuji' });
    const prof = await get('/dashboard/profile', cookie);
    expect(prof.html).toContain('Tertaut');
    expect(prof.html).toContain('@adminuji');
    // Token sekali pakai.
    tgCalls.length = 0;
    await send({ update_id: 3, message: { message_id: 3, chat: { id: CHAT + 1, type: 'private' }, from: { id: CHAT + 1 }, text: `/start ${link![1]}` } });
    expect(tgCalls.find((c) => c.method === 'sendMessage')?.body.text).toMatch(/kedaluwarsa atau sudah dipakai/);
  });

  describe('bot admin', () => {
    const send = (u: unknown) =>
      app.request('/v1/webhooks/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': webhookSecret() },
        body: JSON.stringify(u),
      });
    const sent = () => tgCalls.filter((c) => c.method === 'sendMessage').map((c) => c.body);
    let businessId = '';
    let orderId = '';
    let topupId = '';
    let productId = '';

    beforeAll(async () => {
      const r = await registerOwnerStore({ business: { name: `Toko Bot ${tag}` }, owner: { name: 'Pemilik Bot', password: 'rahasia123' } });
      businessId = r.json.data.business.id;
      const token = r.json.data.accessToken as string;
      await ppob.adminSavePlnProduct({ denom: 21000, cost: 21500 });
      productId = (await sql`SELECT id FROM ppob_products WHERE provider = 'manual' AND sku = 'pln-21000'`)[0]!.id as string;
      await points.adminAdjust((await points.ownerAccountId(businessId))!, 100_000, 'saldo uji bot', 'tester', null);
      const prev = process.env.PPOB_ENABLED;
      const { env } = await import('../../src/config/env.js');
      const was = env.PPOB_ENABLED;
      (env as { PPOB_ENABLED: boolean }).PPOB_ENABLED = true;
      try {
        const o = await app.request('/v1/ppob/orders', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientRef: uuid(), productId, customerNo: '86300000123' }),
        });
        orderId = ((await o.json()) as any).data.id;
        const t = await app.request('/v1/points/topups', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 50_000 }),
        });
        topupId = ((await t.json()) as any).data.topup.id;
      } finally {
        (env as { PPOB_ENABLED: boolean }).PPOB_ENABLED = was;
        process.env.PPOB_ENABLED = prev;
      }
    });

    afterAll(async () => {
      await sql`DELETE FROM ppob_orders WHERE business_id = ${businessId}`;
      await sql`DELETE FROM ppob_products WHERE provider = 'manual' AND sku = 'pln-21000'`;
    });

    it('notifikasi order token membawa tombol salin no meter + kirim token + gagalkan', () => {
      const n = notices.find((x) => /Order token listrik baru/.test(x.text) && x.text.includes('86300000123'))!;
      expect(n.buttons![0]![0]).toEqual({ text: expect.stringContaining('Salin no meter'), copy_text: { text: '86300000123' } });
      expect(n.buttons![1]).toEqual([
        { text: expect.stringContaining('Kirim token'), callback_data: `pln:f:${orderId}` },
        { text: expect.stringContaining('Gagalkan'), callback_data: `pln:x:${orderId}` },
      ]);
      const t = notices.find((x) => /Top-up Poin baru/.test(x.text))!;
      expect(t.buttons!.flat()).toEqual(expect.arrayContaining([{ text: expect.stringContaining('Dana masuk'), callback_data: `tu:a:${topupId}` }]));
    });

    it('/ringkasan & /token menampilkan data penting', async () => {
      tgCalls.length = 0;
      await send({ update_id: 10, message: { message_id: 10, chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, text: '/ringkasan' } });
      expect(sent()[0]!.text).toMatch(/Ringkasan Sirko[\s\S]*Token menunggu admin: <b>\d+<\/b>[\s\S]*Top-up menunggu/);
      tgCalls.length = 0;
      await send({ update_id: 11, message: { message_id: 11, chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, text: '/token' } });
      const mine = sent().find((m) => String(m.text).includes('86300000123'))!;
      expect(mine.reply_markup.inline_keyboard[0][0].copy_text).toEqual({ text: '86300000123' });
    });

    it('isi token lewat chat: tombol Kirim token → balas token → order sukses + email', async () => {
      tgCalls.length = 0;
      const m0 = mails.length;
      await send({ update_id: 20, callback_query: { id: 'cb1', from: { id: CHAT }, data: `pln:f:${orderId}`, message: { message_id: 99, chat: { id: CHAT, type: 'private' } } } });
      expect(tgCalls.some((c) => c.method === 'answerCallbackQuery')).toBe(true);
      const prompt = sent().at(-1)!;
      expect(prompt.reply_markup).toMatchObject({ force_reply: true });
      expect(prompt.text).toContain(`Ref PLN-FILL:${orderId}`);
      // Token salah format → ditolak, order tetap menunggu.
      tgCalls.length = 0;
      const promptText = String(prompt.text).replace(/<[^>]+>/g, '');
      await send({ update_id: 21, message: { message_id: 21, chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, text: '123', reply_to_message: { message_id: 100, chat: { id: CHAT, type: 'private' }, from: { id: 1, is_bot: true }, text: promptText } } });
      expect(sent()[0]!.text).toMatch(/20 digit/);
      // Token benar → sukses.
      tgCalls.length = 0;
      await send({ update_id: 22, message: { message_id: 22, chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, text: '1234 5678 9012 3456 7890', reply_to_message: { message_id: 100, chat: { id: CHAT, type: 'private' }, from: { id: 1, is_bot: true }, text: promptText } } });
      expect(sent()[0]!.text).toMatch(/Token tersimpan/);
      const o = (await sql`SELECT status, sn, fulfilled_by FROM ppob_orders WHERE id = ${orderId}`)[0]!;
      expect(o).toMatchObject({ status: 'success', sn: '1234-5678-9012-3456-7890', fulfilled_by: `${EMAIL} (Telegram)` });
      expect(mails.length).toBeGreaterThan(m0);
    });

    it('konfirmasi top-up lewat chat: Dana masuk → konfirmasi → Poin bertambah sekali', async () => {
      const acc = (await points.ownerAccountId(businessId))!;
      const before = Number((await sql`SELECT balance FROM point_accounts WHERE account_id = ${acc}`)[0]!.balance);
      tgCalls.length = 0;
      await send({ update_id: 30, callback_query: { id: 'cb2', from: { id: CHAT }, data: `tu:a:${topupId}`, message: { message_id: 200, chat: { id: CHAT, type: 'private' } } } });
      expect(sent().at(-1)!.reply_markup.inline_keyboard[0][0]).toEqual({ text: expect.stringContaining('Ya, dana sudah masuk'), callback_data: `tu:y:${topupId}` });
      tgCalls.length = 0;
      await send({ update_id: 31, callback_query: { id: 'cb3', from: { id: CHAT }, data: `tu:y:${topupId}`, message: { message_id: 201, chat: { id: CHAT, type: 'private' } } } });
      expect(tgCalls.find((c) => c.method === 'editMessageText')?.body.text).toMatch(/Top-up dikonfirmasi/);
      await send({ update_id: 32, callback_query: { id: 'cb4', from: { id: CHAT }, data: `tu:y:${topupId}`, message: { message_id: 202, chat: { id: CHAT, type: 'private' } } } });
      const after = Number((await sql`SELECT balance FROM point_accounts WHERE account_id = ${acc}`)[0]!.balance);
      const t = (await points.getTopup(topupId))!;
      expect(after - before).toBe(t.transferAmount);
      expect(t.confirmedBy).toBe(`${EMAIL} (Telegram)`);
    });

    it('chat lain (bukan admin) tidak bisa memakai tombol', async () => {
      tgCalls.length = 0;
      await send({ update_id: 40, callback_query: { id: 'cb5', from: { id: 1234 }, data: `tu:y:${topupId}`, message: { message_id: 300, chat: { id: 1234, type: 'private' } } } });
      expect(tgCalls.find((c) => c.method === 'answerCallbackQuery')?.body.text).toMatch(/belum tertaut/);
      expect(tgCalls.some((c) => c.method === 'editMessageText')).toBe(false);
    });
  });

  it('menu Pengguna: daftar akun + filter + detail', async () => {
    const list = await get(`/dashboard/users?q=${encodeURIComponent(`Toko Bot ${tag}`)}`, cookie);
    expect(list.status).toBe(200);
    expect(list.html).toContain('Pengguna terdaftar');
    expect(list.html).toContain('Pemilik Bot');
    const id = /\/dashboard\/users\/([0-9a-f-]{36})/.exec(list.html)![1]!;
    const det = await get(`/dashboard/users/${id}`, cookie);
    expect(det.status).toBe(200);
    expect(det.html).toContain(`Toko Bot ${tag}`);
    expect(det.html).toContain('Poin Sirko');
    expect((await get('/dashboard/users?status=unverified', cookie)).status).toBe(200);
    expect((await get(`/dashboard/users/${uuid()}`, cookie)).status).toBe(404);
  });
});
