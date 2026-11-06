import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pbkdf2Sync } from 'node:crypto';
import { app } from '../../src/app.js';
import { sql } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { uuid } from '../../src/lib/uuid.js';
import { setMailTransport, type MailMessage } from '../../src/lib/mail.js';
import { normalizeWa } from '../../src/services/account.service.js';

/**
 * Contract test akun pemilik (SPEC-warung-akun-ppob.md, KONTRAK-API-akun-app.md):
 * daftar → OTP email → verifikasi → sesi akun → toko pertama gratis; login email/WA;
 * kunci 5 gagal; lupa/reset password; hash offline; ganti password; refresh akun.
 */

let dbUp = false;
try {
  await sql`SELECT 1`;
  dbUp = true;
} catch (err) {
  console.warn(`[contract] DB tak tersambung — suite di-skip: ${(err as Error).message}`);
}
const suite = dbUp ? describe : describe.skip;

const mails: MailMessage[] = [];
let ipSeq = 0;
const freshIp = () => `10.77.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

async function req(method: string, path: string, body?: unknown, opts: { token?: string; ip?: string } = {}) {
  const res = await app.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'cf-connecting-ip': opts.ip ?? freshIp(),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

/** Kode OTP 6 digit dari email terakhir ke alamat itu. */
function lastCode(email: string): string {
  const m = [...mails].reverse().find((x) => x.to.includes(email));
  const code = m?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error('OTP tak ditemukan untuk ' + email);
  return code;
}

suite('Akun pemilik — daftar, OTP, login email/WA, lupa password, offline', () => {
  let restore: () => void = () => {};
  const tag = uuid().slice(0, 8);
  const phoneOf = (i: number) => `0812${tag.replace(/\D/g, '').padEnd(4, '1').slice(0, 4)}${String(i).padStart(4, '0')}`;
  const created: string[] = [];

  async function registerAndVerify(i: number, password = 'rahasia123') {
    const email = `akun${i}-${tag}@contoh.id`;
    const r = await req('POST', '/v1/auth/register', { name: `Pemilik ${i}`, email, phone: phoneOf(i), password });
    expect(r.status).toBe(201);
    const v = await req('POST', '/v1/auth/verify-email', { email, code: lastCode(email) });
    expect(v.status).toBe(200);
    created.push(r.json.data.accountId);
    return { email, phone: phoneOf(i), password, session: v.json.data, accountId: r.json.data.accountId as string };
  }

  beforeAll(async () => {
    await runMigrations(sql);
    restore = setMailTransport(async (m) => (mails.push(m), { ok: true, id: `m${mails.length}` }));
  });
  beforeEach(() => {
    mails.length = 0;
  });
  afterAll(async () => {
    restore();
    for (const id of created) {
      await sql`DELETE FROM businesses WHERE id IN (SELECT business_id FROM users WHERE account_id = ${id})`;
      await sql`DELETE FROM accounts WHERE id = ${id}`;
    }
    await sql`DELETE FROM auth_throttle WHERE key LIKE 'ip:10.77.%' OR key LIKE 'reg:10.77.%' OR key LIKE 'forgot:10.77.%'`;
    await sql.end({ timeout: 5 });
  });

  it('normalisasi nomor WA → 628…', () => {
    expect(normalizeWa('0812-3456-7890')).toBe('6281234567890');
    expect(normalizeWa('+62 812 3456 7890')).toBe('6281234567890');
    expect(normalizeWa('81234567890')).toBe('6281234567890');
    expect(normalizeWa('021555666')).toBeNull();
  });

  it('daftar: validasi; OTP terkirim ke email (6 digit); akun belum aktif', async () => {
    const bad = await req('POST', '/v1/auth/register', { name: 'X', email: 'bukan-email', phone: '0812', password: 'pendek' });
    expect(bad.status).toBe(422);
    const email = `baru-${tag}@contoh.id`;
    const r = await req('POST', '/v1/auth/register', { name: 'Bu Sri', email, phone: phoneOf(1), password: 'rahasia123' });
    expect(r.status).toBe(201);
    created.push(r.json.data.accountId);
    expect(r.json.data).toMatchObject({ email, sentTo: expect.stringMatching(/^ba\*+@contoh\.id$/) });
    expect(r.json.data.devCode).toBeUndefined(); // tanpa AUTH_DEV_OTP_ECHO
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toMatch(/^\d{6} — kode verifikasi email Sirko$/);
    const row = (await sql`SELECT phone, pending_verification, name FROM accounts WHERE id = ${r.json.data.accountId}`)[0]!;
    expect(row).toMatchObject({ phone: normalizeWa(phoneOf(1)), pending_verification: true, name: 'Bu Sri' });

    // Belum verifikasi → login ditolak EMAIL_NOT_VERIFIED (kode baru tak dikirim dalam jeda 60 dtk).
    const l = await req('POST', '/v1/auth/login', { login: email, password: 'rahasia123' });
    expect(l.status).toBe(403);
    expect(l.json.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(l.json.error.details).toMatchObject({ email, codeSent: false });
    expect((await req('POST', '/v1/auth/resend-verification', { email })).status).toBe(429);
  });

  it('verifikasi: kode salah dihitung, lalu benar → sesi AKUN tanpa toko + offlineAuth', async () => {
    const email = `ver-${tag}@contoh.id`;
    const r = await req('POST', '/v1/auth/register', { name: 'Pak Ver', email, phone: phoneOf(2), password: 'rahasia123' });
    created.push(r.json.data.accountId);
    const code = lastCode(email);
    const wrong = code === '000000' ? '111111' : '000000';
    const w = await req('POST', '/v1/auth/verify-email', { email, code: wrong });
    expect(w.status).toBe(422);
    expect(w.json.error).toMatchObject({ code: 'OTP_INVALID', message: expect.stringMatching(/Sisa 4/) });

    const v = await req('POST', '/v1/auth/verify-email', { email, code });
    expect(v.status).toBe(200);
    const s = v.json.data;
    expect(s).toMatchObject({ business: null, businesses: [], user: { role: 'owner', businessId: null, name: 'Pak Ver' } });
    expect(s.account).toMatchObject({ email, phone: normalizeWa(phoneOf(2)), emailVerified: true });
    expect(s.plan.name).toBe('warung');
    expect(s.offlineAuth).toMatchObject({ algo: 'pbkdf2-sha256', iterations: 100000, keyLength: 32 });
    // App memverifikasi login offline dengan cara yang sama:
    const derived = pbkdf2Sync('rahasia123', Buffer.from(s.offlineAuth.salt, 'base64'), s.offlineAuth.iterations, 32, 'sha256');
    expect(derived.toString('base64')).toBe(s.offlineAuth.hash);
    expect(pbkdf2Sync('salah123', Buffer.from(s.offlineAuth.salt, 'base64'), 100000, 32, 'sha256').toString('base64')).not.toBe(s.offlineAuth.hash);
    // Hash offline ≠ hash login server.
    const pw = (await sql`SELECT password_hash FROM accounts WHERE email = ${email}`)[0]!.password_hash as string;
    expect(pw.startsWith('$2')).toBe(true);
    expect(pw).not.toContain(s.offlineAuth.hash);

    // Kode sekali pakai.
    expect((await req('POST', '/v1/auth/verify-email', { email, code })).status).toBe(409);
    // Sesi akun: tak bisa memakai endpoint data toko.
    expect((await req('GET', '/v1/backup/status', undefined, { token: s.accessToken })).status).toBe(403);
    const mb = await req('GET', '/v1/me/businesses', undefined, { token: s.accessToken });
    expect(mb.json.data).toMatchObject({ businesses: [], plan: { name: 'warung' } });
    expect((await req('GET', '/v1/ppob/status', undefined, { token: s.accessToken })).status).toBe(403);
    const me = await req('GET', '/v1/me', undefined, { token: s.accessToken });
    expect(me.json.data).toMatchObject({ business: null, businesses: [], account: { email }, offlineAuth: { hash: s.offlineAuth.hash } });
  });

  it('toko pertama GRATIS (tanpa Juragan); toko kedua → PLAN_REQUIRED; login lalu masuk toko', async () => {
    const a = await registerAndVerify(3);
    const t = await req('POST', '/v1/businesses', { name: 'Warung Pertama', businessType: 'Kelontong' }, { token: a.session.accessToken });
    expect(t.status).toBe(201);
    expect(t.json.data).toMatchObject({ business: { name: 'Warung Pertama' }, user: { role: 'owner', name: 'Pemilik 3' } });
    expect(t.json.data.businesses).toHaveLength(1);
    expect(t.json.data.offlineAuth.hash).toBe(a.session.offlineAuth.hash);
    const second = await req('POST', '/v1/businesses', { name: 'Cabang' }, { token: t.json.data.accessToken });
    expect(second.status).toBe(403);
    expect(second.json.error.code).toBe('PLAN_REQUIRED');
    // Token toko baru bisa langsung sync.
    expect((await req('GET', '/v1/backup/status', undefined, { token: t.json.data.accessToken })).status).toBe(200);

    // Login dengan email, WA (beragam format), field lama emailOrPhone.
    for (const login of [a.email, a.phone, normalizeWa(a.phone)!, '+' + normalizeWa(a.phone)!]) {
      const l = await req('POST', '/v1/auth/login', { login, password: a.password });
      expect(l.status).toBe(200);
      expect(l.json.data.business.name).toBe('Warung Pertama');
    }
    expect((await req('POST', '/v1/auth/login', { emailOrPhone: a.email, password: a.password })).status).toBe(200);
  });

  it('login akun tanpa toko → sesi akun; refresh token akun berputar', async () => {
    const a = await registerAndVerify(4);
    const l = await req('POST', '/v1/auth/login', { login: a.phone, password: a.password });
    expect(l.status).toBe(200);
    expect(l.json.data).toMatchObject({ business: null, businesses: [] });
    const r1 = await req('POST', '/v1/auth/refresh', { refreshToken: l.json.data.refreshToken });
    expect(r1.status).toBe(200);
    expect((await req('POST', '/v1/auth/refresh', { refreshToken: l.json.data.refreshToken })).status).toBe(401); // rotasi
    const me = await req('GET', '/v1/me', undefined, { token: r1.json.data.accessToken });
    expect(me.json.data.account.email).toBe(a.email);
  });

  it('5× password salah → akun terkunci 15 menit (password benar pun ditolak); IP juga dikunci', async () => {
    const a = await registerAndVerify(5);
    for (let i = 0; i < 4; i++) {
      const x = await req('POST', '/v1/auth/login', { login: a.email, password: 'salah-salah' });
      expect(x.json.error.code).toBe('UNAUTHENTICATED');
      expect(x.json.error.message).toBe('Email/nomor WA atau password salah.');
    }
    const fifth = await req('POST', '/v1/auth/login', { login: a.email, password: 'salah-salah' });
    expect(fifth.status).toBe(429);
    expect(fifth.json.error).toMatchObject({ code: 'ACCOUNT_LOCKED', details: { retryAfterSeconds: 900 } });
    const right = await req('POST', '/v1/auth/login', { login: a.email, password: a.password });
    expect(right.json.error.code).toBe('ACCOUNT_LOCKED');

    // Kunci per IP: 5 gagal dari satu IP (akun tak dikenal) → IP terkunci.
    const ip = freshIp();
    for (let i = 0; i < 5; i++) await req('POST', '/v1/auth/login', { login: `tidak-ada-${i}@x.id`, password: 'apa saja' }, { ip });
    const blocked = await req('POST', '/v1/auth/login', { login: a.phone, password: a.password }, { ip });
    expect(blocked.json.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('lupa password: generik untuk akun tak dikenal; OTP → reset → semua sesi lama dicabut → langsung masuk', async () => {
    const a = await registerAndVerify(6);
    const toko = await req('POST', '/v1/businesses', { name: 'Toko Lupa' }, { token: a.session.accessToken });
    const oldRefresh = toko.json.data.refreshToken;

    mails.length = 0;
    const ghost = await req('POST', '/v1/auth/password/forgot', { login: `hantu-${tag}@contoh.id` });
    expect(ghost.status).toBe(200);
    expect(ghost.json.data.sentTo).toBeNull();
    expect(mails).toHaveLength(0);

    const f = await req('POST', '/v1/auth/password/forgot', { login: a.phone }); // via nomor WA
    expect(f.json.data.sentTo).toMatch(/@contoh\.id$/);
    expect(mails[0]!.subject).toMatch(/atur ulang password/);
    const bad = await req('POST', '/v1/auth/password/reset', { login: a.phone, code: '000000', newPassword: 'barubaru1' });
    expect(bad.json.error.code).toBe('OTP_INVALID');
    const r = await req('POST', '/v1/auth/password/reset', { login: a.phone, code: lastCode(a.email), newPassword: 'barubaru1' });
    expect(r.status).toBe(200);
    expect(r.json.data.business.name).toBe('Toko Lupa');
    expect(r.json.data.offlineAuth.hash).not.toBe(a.session.offlineAuth.hash);

    expect((await req('POST', '/v1/auth/refresh', { refreshToken: oldRefresh })).status).toBe(401);
    expect((await req('POST', '/v1/auth/login', { login: a.email, password: a.password })).status).toBe(401);
    expect((await req('POST', '/v1/auth/login', { login: a.email, password: 'barubaru1' })).status).toBe(200);
  });

  it('ganti password (masuk): hash offline baru, sesi HP lain TETAP, /me memberi hash baru', async () => {
    const a = await registerAndVerify(7);
    const toko = await req('POST', '/v1/businesses', { name: 'Toko Ganti' }, { token: a.session.accessToken });
    const hpLain = await req('POST', '/v1/auth/login', { login: a.email, password: a.password });
    const wrong = await req('POST', '/v1/auth/password/change', { currentPassword: 'keliru', newPassword: 'gantibaru1' }, { token: toko.json.data.accessToken });
    expect(wrong.status).toBe(422);
    const c = await req('POST', '/v1/auth/password/change', { currentPassword: a.password, newPassword: 'gantibaru1' }, { token: toko.json.data.accessToken });
    expect(c.status).toBe(200);
    expect(c.json.data.offlineAuth.hash).not.toBe(a.session.offlineAuth.hash);
    expect(c.json.data.offlineAuth.updatedAt).toBeGreaterThan(a.session.offlineAuth.updatedAt);
    const r = await req('POST', '/v1/auth/refresh', { refreshToken: hpLain.json.data.refreshToken });
    expect(r.status).toBe(200);
    const me = await req('GET', '/v1/me', undefined, { token: r.json.data.accessToken });
    expect(me.json.data.offlineAuth.hash).toBe(c.json.data.offlineAuth.hash);
  });

  it('email/WA terdaftar & terverifikasi → 409; pendaftaran tertinggal (belum verifikasi) bisa diulang', async () => {
    const a = await registerAndVerify(8);
    const dupEmail = await req('POST', '/v1/auth/register', { name: 'Lain', email: a.email, phone: phoneOf(80), password: 'rahasia123' });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.json.error.message).toMatch(/Email sudah terdaftar/);
    const dupWa = await req('POST', '/v1/auth/register', { name: 'Lain', email: `lain-${tag}@contoh.id`, phone: a.phone, password: 'rahasia123' });
    expect(dupWa.json.error.message).toMatch(/Nomor WA sudah terdaftar/);

    const email = `ulang-${tag}@contoh.id`;
    const first = await req('POST', '/v1/auth/register', { name: 'Ulang 1', email, phone: phoneOf(81), password: 'rahasia123' });
    const again = await req('POST', '/v1/auth/register', { name: 'Ulang 2', email, phone: phoneOf(82), password: 'rahasia456' });
    expect(again.status).toBe(201);
    created.push(again.json.data.accountId);
    expect((await sql`SELECT 1 FROM accounts WHERE id = ${first.json.data.accountId}`).length).toBe(0);
    const v = await req('POST', '/v1/auth/verify-email', { email, code: lastCode(email) });
    expect(v.json.data.user.name).toBe('Ulang 2');
  });

  it('register-business lama tetap jalan (akun langsung aktif, punya offlineAuth)', async () => {
    const email = `lama-${tag}@contoh.id`;
    const r = await req('POST', '/v1/auth/register-business', {
      business: { name: 'Toko Lama' },
      owner: { name: 'Lama', email, password: 'rahasia123' },
    });
    expect(r.status).toBe(201);
    created.push(r.json.data.account.id);
    expect(r.json.data.offlineAuth).not.toBeNull();
    expect((await req('POST', '/v1/auth/login', { login: email, password: 'rahasia123' })).status).toBe(200);
  });
});
