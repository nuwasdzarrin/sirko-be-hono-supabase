import { createHmac, pbkdf2, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { sql, type DbClient } from '../db/client.js';
import { env, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from '../config/env.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { signAccessToken, signRefreshToken } from '../lib/jwt.js';
import { AppError, conflict, unauthenticated, validation } from '../lib/errors.js';
import { sendMail, htmlEsc } from '../lib/mail.js';
import { uuid } from '../lib/uuid.js';
import { nowMs } from '../lib/time.js';
import * as plans from './plan.service.js';
import type { EffectivePlan } from './plan.service.js';

/**
 * Akun pemilik (paket Warung, SPEC-warung-akun-ppob.md):
 * daftar nama/email/WA/password → OTP email → aktif; login email ATAU WA +
 * password; lupa password via OTP email; turunan hash untuk login OFFLINE.
 * Akun tanpa toko memakai SESI AKUN (token scope 'account', lihat lib/jwt.ts).
 */

type Row = Record<string, unknown>;
const pbkdf2Async = promisify(pbkdf2);

const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_GAP_MS = 60_000;
const OTP_MAX_PER_HOUR = 5;
const LOCK_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
export const OFFLINE_ITERATIONS = 100_000;

// ── Validasi input ───────────────────────────────────────────────────────────

const emailSchema = z.string().trim().toLowerCase().email('Format email tidak valid').max(255);
const passwordSchema = z.string().min(8, 'Password minimal 8 karakter').max(200);
const phoneInput = z.string().trim().min(6, 'Nomor WA tidak valid').max(30);

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi').max(120),
  email: emailSchema,
  phone: phoneInput,
  password: passwordSchema,
});
export const verifyEmailSchema = z.object({ email: emailSchema, code: z.string().trim().regex(/^\d{6}$/, 'Kode harus 6 angka') });
export const resendSchema = z.object({ email: emailSchema });
export const forgotSchema = z.object({ login: z.string().trim().min(3).max(255) });
export const resetSchema = z.object({
  login: z.string().trim().min(3).max(255),
  code: z.string().trim().regex(/^\d{6}$/, 'Kode harus 6 angka'),
  newPassword: passwordSchema,
});
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema });

/** Nomor WA → format kanonik `628…` (8–13 digit setelah 62). null bila tak valid. */
export function normalizeWa(raw: string): string | null {
  let s = raw.replace(/[\s\-().]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('0')) s = '62' + s.slice(1);
  else if (s.startsWith('8')) s = '62' + s;
  return /^628\d{7,12}$/.test(s) ? s : null;
}

/** Kandidat nilai kolom phone untuk dicocokkan (akun lama bisa menyimpan 08…/+62…). */
function phoneCandidates(raw: string): string[] {
  const c = normalizeWa(raw);
  if (!c) return [raw.trim()];
  return [...new Set([c, '0' + c.slice(2), '+' + c, raw.trim()])];
}

export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [u, d] = email.split('@');
  if (!u || !d) return email;
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`;
}

// ── Baca akun ────────────────────────────────────────────────────────────────

export interface AccountRecord {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  password_hash: string;
  email_verified_at: number | null;
  pending_verification: boolean;
  offline_salt: string | null;
  offline_hash: string | null;
  offline_iter: number | null;
  password_changed_at: number | null;
}

const accountCols = () => sql`id, name, email::text AS email, phone, password_hash, email_verified_at, pending_verification,
  offline_salt, offline_hash, offline_iter, password_changed_at`;

function toRecord(r: Row | undefined): AccountRecord | null {
  if (!r) return null;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: r.id as string,
    name: (r.name as string) ?? null,
    email: (r.email as string) ?? null,
    phone: (r.phone as string) ?? null,
    password_hash: r.password_hash as string,
    email_verified_at: num(r.email_verified_at),
    pending_verification: Boolean(r.pending_verification),
    offline_salt: (r.offline_salt as string) ?? null,
    offline_hash: (r.offline_hash as string) ?? null,
    offline_iter: num(r.offline_iter),
    password_changed_at: num(r.password_changed_at),
  };
}

export async function accountById(id: string, db: DbClient = sql): Promise<AccountRecord | null> {
  return toRecord((await db<Row[]>`SELECT ${accountCols()} FROM accounts WHERE id = ${id}`)[0]);
}

/** `login` = email (mengandung @) atau nomor WA (format apa pun yang wajar). */
export async function accountByLogin(login: string): Promise<AccountRecord | null> {
  const v = login.trim();
  if (v.includes('@')) {
    return toRecord((await sql<Row[]>`SELECT ${accountCols()} FROM accounts WHERE email = ${v.toLowerCase()}::citext LIMIT 1`)[0]);
  }
  const cands = phoneCandidates(v);
  return toRecord((await sql<Row[]>`SELECT ${accountCols()} FROM accounts WHERE phone = ANY(${cands}) ORDER BY created_at LIMIT 1`)[0]);
}

// ── Login offline (turunan PBKDF2 khusus HP) ─────────────────────────────────

export interface OfflineAuth {
  algo: 'pbkdf2-sha256';
  iterations: number;
  keyLength: 32;
  salt: string; // base64
  hash: string; // base64
  /** Berubah setiap password diganti → app memperbarui hash lokal bila berbeda. */
  updatedAt: number | null;
}

async function deriveOffline(password: string, saltB64: string, iterations: number): Promise<string> {
  const key = await pbkdf2Async(password, Buffer.from(saltB64, 'base64'), iterations, 32, 'sha256');
  return key.toString('base64');
}

/** Hitung & simpan turunan offline baru (dipanggil saat password diketahui: daftar, login, reset, ganti). */
async function storeOffline(accountId: string, password: string, db: DbClient = sql): Promise<void> {
  const salt = randomBytes(16).toString('base64');
  const hash = await deriveOffline(password, salt, OFFLINE_ITERATIONS);
  await db`UPDATE accounts SET offline_salt = ${salt}, offline_hash = ${hash}, offline_iter = ${OFFLINE_ITERATIONS} WHERE id = ${accountId}`;
}

export function offlineAuthOf(a: AccountRecord): OfflineAuth | null {
  if (!a.offline_salt || !a.offline_hash || !a.offline_iter) return null;
  return {
    algo: 'pbkdf2-sha256',
    iterations: a.offline_iter,
    keyLength: 32,
    salt: a.offline_salt,
    hash: a.offline_hash,
    updatedAt: a.password_changed_at,
  };
}

/** Pastikan akun punya turunan offline (akun lama) — butuh password plaintext dari login. */
export async function ensureOffline(a: AccountRecord, password: string): Promise<AccountRecord> {
  if (a.offline_hash && a.offline_iter === OFFLINE_ITERATIONS) return a;
  await storeOffline(a.id, password);
  return (await accountById(a.id))!;
}

export interface AccountInfo {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
}

export function accountInfo(a: AccountRecord): AccountInfo {
  return { id: a.id, name: a.name, email: a.email, phone: a.phone, emailVerified: !a.pending_verification };
}

// ── Pembatas percobaan login ─────────────────────────────────────────────────

/** IP klien di balik Cloudflare Tunnel (cf-connecting-ip), lalu x-forwarded-for. */
export function clientIp(headers: { get(name: string): string | null | undefined }): string {
  return (
    headers.get('cf-connecting-ip')?.trim() ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

async function lockedFor(key: string): Promise<number> {
  const r = await sql<{ locked_until: string | null }[]>`SELECT locked_until FROM auth_throttle WHERE key = ${key}`;
  const until = Number(r[0]?.locked_until ?? 0);
  return until > nowMs() ? until - nowMs() : 0;
}

async function recordFailure(key: string): Promise<boolean> {
  const ts = nowMs();
  const r = await sql<{ failures: number; locked_until: string | null }[]>`
    INSERT INTO auth_throttle (key, failures, window_start, locked_until) VALUES (${key}, 1, ${ts}, NULL)
    ON CONFLICT (key) DO UPDATE SET
      failures = CASE WHEN auth_throttle.window_start < ${ts - LOCK_MS} OR coalesce(auth_throttle.locked_until, 0) BETWEEN 1 AND ${ts}
                      THEN 1 ELSE auth_throttle.failures + 1 END,
      window_start = CASE WHEN auth_throttle.window_start < ${ts - LOCK_MS} OR coalesce(auth_throttle.locked_until, 0) BETWEEN 1 AND ${ts}
                          THEN ${ts} ELSE auth_throttle.window_start END,
      locked_until = CASE WHEN coalesce(auth_throttle.locked_until, 0) BETWEEN 1 AND ${ts} THEN NULL ELSE auth_throttle.locked_until END
    RETURNING failures, locked_until`;
  if ((r[0]?.failures ?? 0) >= LOCK_FAILURES) {
    await sql`UPDATE auth_throttle SET locked_until = ${ts + LOCK_MS} WHERE key = ${key}`;
    return true;
  }
  return false;
}

async function clearFailures(key: string): Promise<void> {
  await sql`DELETE FROM auth_throttle WHERE key = ${key}`;
}

const lockedError = (ms: number) =>
  new AppError('ACCOUNT_LOCKED', `Terlalu banyak percobaan masuk. Coba lagi dalam ${Math.max(1, Math.ceil(ms / 60_000))} menit.`, {
    retryAfterSeconds: Math.ceil(ms / 1000),
  });

/**
 * Verifikasi kredensial login dengan pembatasan: 5 gagal → kunci 15 menit per akun & per IP.
 * Mengembalikan akun (password benar). Pesan gagal seragam (cegah enumerasi akun).
 */
export async function checkCredentials(login: string, password: string, ip: string): Promise<AccountRecord> {
  const ipKey = `ip:${ip}`;
  const ipLock = await lockedFor(ipKey);
  if (ipLock) throw lockedError(ipLock);
  const invalid = () => unauthenticated('Email/nomor WA atau password salah.');

  const account = await accountByLogin(login);
  if (!account) {
    await verifyPassword(password, '$2a$10$0000000000000000000000000000000000000000000000000000');
    if (await recordFailure(ipKey)) throw lockedError(LOCK_MS);
    throw invalid();
  }
  const acctKey = `acct:${account.id}`;
  const acctLock = await lockedFor(acctKey);
  if (acctLock) throw lockedError(acctLock);

  if (!(await verifyPassword(password, account.password_hash))) {
    const [a, i] = await Promise.all([recordFailure(acctKey), recordFailure(ipKey)]);
    if (a || i) throw lockedError(LOCK_MS);
    throw invalid();
  }
  await clearFailures(acctKey);
  return account;
}

/**
 * Batas laju sederhana per kunci (mis. 'reg:<ip>'): maks `max` kejadian per `windowMs`.
 * Dipakai untuk endpoint yang mengirim email (daftar, lupa password) agar tak bisa dipakai spam.
 */
export async function hitRateLimit(key: string, max: number, windowMs: number, message: string): Promise<void> {
  const ts = nowMs();
  const r = await sql<{ failures: number; window_start: string }[]>`
    INSERT INTO auth_throttle (key, failures, window_start) VALUES (${key}, 1, ${ts})
    ON CONFLICT (key) DO UPDATE SET
      failures = CASE WHEN auth_throttle.window_start < ${ts - windowMs} THEN 1 ELSE auth_throttle.failures + 1 END,
      window_start = CASE WHEN auth_throttle.window_start < ${ts - windowMs} THEN ${ts} ELSE auth_throttle.window_start END
    RETURNING failures, window_start`;
  if ((r[0]?.failures ?? 0) > max) {
    const wait = Math.ceil((Number(r[0]!.window_start) + windowMs - ts) / 1000);
    throw new AppError('RATE_LIMITED', message, { retryAfterSeconds: wait });
  }
}

// ── OTP email ────────────────────────────────────────────────────────────────

type OtpPurpose = 'verify_email' | 'reset_password';

const otpHash = (otpId: string, code: string) => createHmac('sha256', env.JWT_SECRET).update(`${otpId}:${code}`).digest('hex');

export interface OtpSent {
  sentTo: string | null; // email tersamar
  expiresAt: number;
  /** HANYA bila AUTH_DEV_OTP_ECHO=true & bukan production — untuk uji tanpa email. */
  devCode?: string;
}

function devEcho(): boolean {
  return Boolean(env.AUTH_DEV_OTP_ECHO) && env.APP_ENV !== 'production';
}

/**
 * Buat & kirim OTP baru (kode lama tujuan sama dinonaktifkan). Jeda kirim ulang
 * 60 dtk & maks 5/jam per akun → RATE_LIMITED.
 */
async function issueOtp(a: AccountRecord, purpose: OtpPurpose): Promise<OtpSent> {
  if (!a.email) throw validation('Akun ini belum punya email. Hubungi admin Sirko.');
  const ts = nowMs();
  const recent = await sql<{ created_at: string }[]>`
    SELECT created_at FROM auth_otps WHERE account_id = ${a.id} AND purpose = ${purpose} AND created_at > ${ts - 3_600_000}
    ORDER BY created_at DESC`;
  if (recent[0] && ts - Number(recent[0].created_at) < OTP_RESEND_GAP_MS) {
    const wait = Math.ceil((OTP_RESEND_GAP_MS - (ts - Number(recent[0].created_at))) / 1000);
    throw new AppError('RATE_LIMITED', `Kode baru saja dikirim. Tunggu ${wait} detik untuk kirim ulang.`, { retryAfterSeconds: wait });
  }
  if (recent.length >= OTP_MAX_PER_HOUR) {
    throw new AppError('RATE_LIMITED', 'Terlalu sering meminta kode. Coba lagi dalam 1 jam.', { retryAfterSeconds: 3600 });
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const id = uuid();
  await sql.begin(async (tx) => {
    await tx`UPDATE auth_otps SET consumed_at = ${ts} WHERE account_id = ${a.id} AND purpose = ${purpose} AND consumed_at IS NULL`;
    await tx`INSERT INTO auth_otps ${tx({ id, account_id: a.id, purpose, code_hash: otpHash(id, code), expires_at: ts + OTP_TTL_MS, created_at: ts })}`;
  });
  const what = purpose === 'verify_email' ? 'verifikasi email' : 'atur ulang password';
  const res = await sendMail({
    to: [a.email],
    subject: `${code} — kode ${what} Sirko`,
    text: `Kode ${what} Sirko Anda: ${code}\n\nBerlaku 10 menit. Jangan berikan kode ini kepada siapa pun, termasuk yang mengaku dari Sirko.\nAbaikan email ini bila Anda tidak memintanya.\n\n— Sirko`,
    html: `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:480px;margin:auto;color:#151a2d">
  <h2 style="margin:0 0 8px">Kode ${htmlEsc(what)}</h2>
  <p style="margin:0 0 16px;color:#5f6784">Halo ${htmlEsc(a.name ?? '')}, masukkan kode berikut di aplikasi Sirko:</p>
  <div style="font-size:32px;font-weight:800;letter-spacing:.3em;text-align:center;border:1px solid #e2e6ef;border-radius:12px;padding:16px;font-family:ui-monospace,Consolas,monospace">${code}</div>
  <p style="font-size:13px;color:#5f6784">Berlaku <b>10 menit</b>. Jangan berikan kode ini kepada siapa pun, termasuk yang mengaku dari Sirko.</p>
  <p style="font-size:12px;color:#8a90a6">Abaikan email ini bila Anda tidak memintanya. — Sirko</p>
</div>`,
  });
  if (!res.ok) console.warn(`[akun] OTP ${purpose} untuk ${maskEmail(a.email)} tidak terkirim: ${res.error ?? ''}`);
  if (devEcho()) console.log(`[akun][dev] OTP ${purpose} ${a.email}: ${code}`);
  return { sentTo: maskEmail(a.email), expiresAt: ts + OTP_TTL_MS, ...(devEcho() ? { devCode: code } : {}) };
}

/** Cocokkan OTP; berhasil → ditandai terpakai (sekali pakai). */
async function consumeOtp(accountId: string, purpose: OtpPurpose, code: string): Promise<void> {
  const bad = (m = 'Kode salah atau sudah tidak berlaku. Minta kode baru.') => new AppError('OTP_INVALID', m);
  await sql.begin(async (tx) => {
    const r = await tx<Row[]>`
      SELECT * FROM auth_otps WHERE account_id = ${accountId} AND purpose = ${purpose} AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE`;
    const o = r[0];
    const ts = nowMs();
    if (!o || Number(o.expires_at) < ts) throw bad('Kode sudah kedaluwarsa. Minta kode baru.');
    if (Number(o.attempts) >= OTP_MAX_ATTEMPTS) throw bad('Terlalu banyak salah kode. Minta kode baru.');
    const want = Buffer.from(o.code_hash as string, 'hex');
    const got = Buffer.from(otpHash(o.id as string, code), 'hex');
    if (want.length !== got.length || !timingSafeEqual(want, got)) {
      await tx`UPDATE auth_otps SET attempts = attempts + 1 WHERE id = ${o.id as string}`;
      const left = OTP_MAX_ATTEMPTS - Number(o.attempts) - 1;
      throw bad(left > 0 ? `Kode salah. Sisa ${left} kali percobaan.` : 'Terlalu banyak salah kode. Minta kode baru.');
    }
    await tx`UPDATE auth_otps SET consumed_at = ${ts} WHERE id = ${o.id as string}`;
  });
}

// ── Sesi akun (pemilik tanpa toko) ───────────────────────────────────────────

/** Terbitkan token sesi AKUN (scope 'account') + refresh token terikat akun. */
export async function issueAccountTokens(accountId: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const jti = uuid();
  const ts = nowMs();
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({ userId: accountId, businessId: null, role: 'owner', scope: 'account' }),
    signRefreshToken({ userId: accountId, jti }),
  ]);
  await sql`INSERT INTO refresh_tokens (jti, user_id, account_id, expires_at, revoked, created_at)
            VALUES (${jti}, NULL, ${accountId}, ${ts + REFRESH_TOKEN_TTL_SECONDS * 1000}, false, ${ts})`;
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

export interface AccountSessionPayload {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; name: string; role: 'owner'; businessId: null };
  business: null;
  businesses: [];
  plan: EffectivePlan;
  account: AccountInfo;
  offlineAuth: OfflineAuth | null;
}

/** Bentuk sama dengan sesi toko (login), tanpa toko: `business: null`, `businesses: []`. */
export async function accountSession(a: AccountRecord): Promise<AccountSessionPayload> {
  const [tokens, plan] = await Promise.all([issueAccountTokens(a.id), plans.effective(a.id)]);
  return {
    ...tokens,
    user: { id: a.id, name: a.name ?? 'Pemilik', role: 'owner', businessId: null },
    business: null,
    businesses: [],
    plan,
    account: accountInfo(a),
    offlineAuth: offlineAuthOf(a),
  };
}

/** Cabut SEMUA refresh token akun (sesi akun + semua toko) — dipakai saat reset password. */
export async function revokeAllSessions(accountId: string, db: DbClient = sql): Promise<void> {
  await db`UPDATE refresh_tokens SET revoked = true
           WHERE revoked = false AND (account_id = ${accountId} OR user_id IN (SELECT id FROM users WHERE account_id = ${accountId}))`;
}

// ── Daftar & verifikasi ──────────────────────────────────────────────────────

export interface RegisterResult extends OtpSent {
  accountId: string;
  email: string;
}

/**
 * Daftar akun pemilik (belum ada toko). Akun belum terverifikasi; OTP dikirim ke email.
 * Email/WA milik akun TERVERIFIKASI → 409. Akun belum terverifikasi & tanpa toko yang
 * memakai email/WA ini dianggap pendaftaran tertinggal → digantikan.
 */
export async function register(input: z.infer<typeof registerSchema>): Promise<RegisterResult> {
  const phone = normalizeWa(input.phone);
  if (!phone) throw validation('Nomor WA tidak valid. Contoh: 0812xxxxxxxx.');
  const cands = phoneCandidates(phone);
  const clash = await sql<{ id: string; email: string | null; verified: boolean; has_store: boolean }[]>`
    SELECT a.id, a.email::text AS email, NOT a.pending_verification AS verified,
           EXISTS (SELECT 1 FROM users u WHERE u.account_id = a.id) AS has_store
    FROM accounts a WHERE a.email = ${input.email}::citext OR a.phone = ANY(${cands})`;
  const blocking = clash.find((c) => c.verified || c.has_store);
  if (blocking) {
    throw conflict(
      blocking.email?.toLowerCase() === input.email
        ? 'Email sudah terdaftar. Silakan masuk atau gunakan "Lupa password".'
        : 'Nomor WA sudah terdaftar. Silakan masuk atau gunakan "Lupa password".',
    );
  }
  const ts = nowMs();
  const id = uuid();
  const passwordHash = await hashPassword(input.password);
  try {
    await sql.begin(async (tx) => {
      for (const c of clash) await tx`DELETE FROM accounts WHERE id = ${c.id}`; // pendaftaran tertinggal
      await tx`INSERT INTO accounts ${tx({
        id, name: input.name, email: input.email, phone, password_hash: passwordHash,
        created_at: ts, updated_at: ts, password_changed_at: ts, pending_verification: true,
      })}`;
      await storeOffline(id, input.password, tx);
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('Email atau nomor WA sudah terdaftar.');
    throw e;
  }
  const a = (await accountById(id))!;
  const sent = await issueOtp(a, 'verify_email');
  return { accountId: id, email: input.email, ...sent };
}

export async function resendVerification(email: string): Promise<OtpSent> {
  const a = await accountByLogin(email);
  // Tak membocorkan keberadaan akun: akun tak ada / sudah aktif → respons sukses generik.
  if (!a || !a.pending_verification) return { sentTo: maskEmail(email), expiresAt: nowMs() + OTP_TTL_MS };
  return issueOtp(a, 'verify_email');
}

/** OTP benar → akun aktif → sesi akun (belum ada toko). */
export async function verifyEmail(email: string, code: string): Promise<AccountRecord> {
  const a = await accountByLogin(email);
  if (!a) throw new AppError('OTP_INVALID', 'Kode salah atau sudah tidak berlaku. Minta kode baru.');
  if (!a.pending_verification) throw conflict('Email sudah terverifikasi. Silakan masuk.');
  await consumeOtp(a.id, 'verify_email', code);
  await sql`UPDATE accounts SET pending_verification = false, email_verified_at = ${nowMs()}, updated_at = ${nowMs()} WHERE id = ${a.id}`;
  return (await accountById(a.id))!;
}

/** Login dengan akun belum terverifikasi → kirim ulang OTP (bila boleh) & tolak. */
export async function rejectUnverified(a: AccountRecord): Promise<never> {
  let sent: OtpSent | null = null;
  try {
    sent = await issueOtp(a, 'verify_email');
  } catch (e) {
    if (!(e instanceof AppError && e.code === 'RATE_LIMITED')) throw e;
  }
  throw new AppError('EMAIL_NOT_VERIFIED', 'Email belum diverifikasi. Masukkan kode yang kami kirim ke email Anda.', {
    email: a.email,
    sentTo: maskEmail(a.email),
    codeSent: Boolean(sent),
    ...(sent?.devCode ? { devCode: sent.devCode } : {}),
  });
}

// ── Lupa / reset / ganti password ────────────────────────────────────────────

/** Selalu sukses (tak membocorkan akun). Bila akun ada → OTP ke emailnya. */
export async function forgotPassword(login: string): Promise<OtpSent & { message: string }> {
  const message = 'Bila akun terdaftar, kode atur ulang password dikirim ke email akun.';
  const a = await accountByLogin(login);
  if (!a || !a.email) return { message, sentTo: null, expiresAt: nowMs() + OTP_TTL_MS };
  const sent = await issueOtp(a, 'reset_password');
  return { message, ...sent };
}

/** OTP benar → password baru, email dianggap terverifikasi, SEMUA sesi lama dicabut. */
export async function resetPassword(login: string, code: string, newPassword: string): Promise<AccountRecord> {
  const a = await accountByLogin(login);
  if (!a) throw new AppError('OTP_INVALID', 'Kode salah atau sudah tidak berlaku. Minta kode baru.');
  await consumeOtp(a.id, 'reset_password', code);
  const ts = nowMs();
  const hash = await hashPassword(newPassword);
  await sql.begin(async (tx) => {
    // OTP reset membuktikan kepemilikan email → akun sekaligus terverifikasi.
    await tx`UPDATE accounts SET password_hash = ${hash}, password_changed_at = ${ts}, updated_at = ${ts},
             pending_verification = false, email_verified_at = coalesce(email_verified_at, ${ts}) WHERE id = ${a.id}`;
    await storeOffline(a.id, newPassword, tx);
    await revokeAllSessions(a.id, tx);
  });
  await clearFailures(`acct:${a.id}`);
  return (await accountById(a.id))!;
}

/** Ganti password saat masuk. Sesi lain TIDAK dicabut; HP lain memperbarui hash offline lewat GET /v1/me. */
export async function changePassword(accountId: string, current: string, next: string): Promise<AccountRecord> {
  const a = await accountById(accountId);
  if (!a) throw unauthenticated('Akun tidak ditemukan');
  if (!(await verifyPassword(current, a.password_hash))) throw validation('Password saat ini salah.');
  const ts = nowMs();
  const hash = await hashPassword(next);
  await sql.begin(async (tx) => {
    await tx`UPDATE accounts SET password_hash = ${hash}, password_changed_at = ${ts}, updated_at = ${ts} WHERE id = ${accountId}`;
    await storeOffline(accountId, next, tx);
  });
  return (await accountById(accountId))!;
}

/** account_id dari konteks auth (sesi akun → userId; sesi toko → users.account_id). */
export async function accountIdOfAuth(auth: { userId: string; scope?: 'account' }): Promise<string | null> {
  if (auth.scope === 'account') return auth.userId;
  return plans.accountIdOfUser(auth.userId);
}
