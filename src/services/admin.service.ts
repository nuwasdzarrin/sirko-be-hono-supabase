import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../db/client.js';
import { env } from '../config/env.js';
import { uuid } from '../lib/uuid.js';
import { nowMs } from '../lib/time.js';
import { AppError, validation } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { sendMail } from '../lib/mail.js';
import { loginThrottle, maskEmail } from './account.service.js';

/**
 * Admin dashboard Sirko (tabel admin_users, migrasi 0014).
 *
 * - Bootstrap: tabel kosong + DASHBOARD_USER/PASSWORD di .env → admin pertama dibuat dari
 *   .env (beserta TELEGRAM_ADMIN_CHAT_ID lama). Setelah itu database = sumber kebenaran:
 *   ganti password di dashboard TIDAK mengubah .env.
 * - Login: email (atau username lama) + password; 5 gagal → kunci 15 menit per admin & per IP.
 * - Lupa password: OTP 6 digit ke email (10 menit, 5 percobaan, jeda kirim 60 dtk, maks 5/jam).
 * - Ganti/reset password memajukan password_changed_at → sesi lama di perangkat lain gugur.
 * - Telegram: token deep link sekali pakai (10 menit) → /start <token> di bot menautkan chat.
 */

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  passwordChangedAt: number;
  telegramChatId: number | null;
  telegramUsername: string | null;
  telegramLinkedAt: number | null;
  createdAt: number;
}

type Row = Record<string, unknown>;

const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_GAP_MS = 60_000;
const OTP_MAX_PER_HOUR = 5;
const TG_LINK_TTL_MS = 10 * 60_000;

const toAdmin = (r: Row): AdminUser => ({
  id: r.id as string,
  email: String(r.email),
  name: (r.name as string) || '',
  passwordChangedAt: Number(r.password_changed_at),
  telegramChatId: r.telegram_chat_id == null ? null : Number(r.telegram_chat_id),
  telegramUsername: (r.telegram_username as string) ?? null,
  telegramLinkedAt: r.telegram_linked_at == null ? null : Number(r.telegram_linked_at),
  createdAt: Number(r.created_at),
});

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Admin pertama dari .env bila tabel masih kosong (idempoten, aman dipanggil berkali-kali). */
let bootstrapped = false;
export async function ensureBootstrap(): Promise<void> {
  if (bootstrapped || !env.DASHBOARD_USER || !env.DASHBOARD_PASSWORD) return;
  const n = await sql<{ c: number }[]>`SELECT count(*)::int c FROM admin_users`;
  if ((n[0]?.c ?? 0) > 0) {
    bootstrapped = true;
    return;
  }
  const ts = nowMs();
  const chat = Number(env.TELEGRAM_ADMIN_CHAT_ID);
  await sql`
    INSERT INTO admin_users ${sql({
      id: uuid(),
      email: env.DASHBOARD_USER.trim(),
      name: 'Admin Sirko',
      password_hash: await hashPassword(env.DASHBOARD_PASSWORD),
      password_changed_at: 0,
      telegram_chat_id: Number.isSafeInteger(chat) && chat !== 0 ? chat : null,
      telegram_linked_at: Number.isSafeInteger(chat) && chat !== 0 ? ts : null,
      created_at: ts,
      updated_at: ts,
    })}
    ON CONFLICT DO NOTHING`;
}

export async function adminByEmail(email: string): Promise<AdminUser | null> {
  const r = await sql<Row[]>`SELECT * FROM admin_users WHERE email = ${email.trim()}`;
  return r[0] ? toAdmin(r[0]) : null;
}

export async function adminById(id: string): Promise<AdminUser | null> {
  const r = await sql<Row[]>`SELECT * FROM admin_users WHERE id = ${id}`;
  return r[0] ? toAdmin(r[0]) : null;
}

export async function adminByTelegramChat(chatId: number): Promise<AdminUser | null> {
  const r = await sql<Row[]>`SELECT * FROM admin_users WHERE telegram_chat_id = ${chatId}`;
  return r[0] ? toAdmin(r[0]) : null;
}

/** Chat Telegram semua admin yang tertaut (tujuan notifikasi). */
export async function linkedTelegramChats(): Promise<number[]> {
  const r = await sql<{ c: string }[]>`SELECT telegram_chat_id::text c FROM admin_users WHERE telegram_chat_id IS NOT NULL`;
  return r.map((x) => Number(x.c));
}

/**
 * Login dashboard. Pesan gagal seragam (cegah enumerasi). Lempar ACCOUNT_LOCKED saat terkunci.
 */
export async function login(email: string, password: string, ip: string): Promise<AdminUser | null> {
  await ensureBootstrap();
  const { lockedFor, recordFailure, clearFailures, lockedError } = loginThrottle;
  const ipKey = `adm-ip:${ip}`;
  const userKey = `adm:${email.trim().toLowerCase()}`;
  const lock = Math.max(await lockedFor(ipKey), await lockedFor(userKey));
  if (lock) throw lockedError(lock);
  const r = await sql<Row[]>`SELECT * FROM admin_users WHERE email = ${email.trim()}`;
  const ok = r[0] ? await verifyPassword(password, r[0].password_hash as string) : (await verifyPassword(password, await dummyHash()), false);
  if (!ok) {
    const lockedNow = (await recordFailure(ipKey)) || (await recordFailure(userKey));
    if (lockedNow) throw lockedError(15 * 60_000);
    return null;
  }
  await clearFailures(userKey);
  return toAdmin(r[0]!);
}
// Hash dummy agar waktu respons email tak terdaftar ≈ email terdaftar.
let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= hashPassword(randomBytes(12).toString('hex')));

// ── OTP reset password ───────────────────────────────────────────────────────

const otpHash = (id: string, code: string) => createHmac('sha256', `admin-otp:${env.JWT_SECRET}`).update(`${id}:${code}`).digest('hex');

export interface ForgotResult {
  sentTo: string | null;
  devCode?: string;
}

/** Kirim OTP reset ke email admin. Email tak terdaftar → hasil sama (tanpa kirim). */
export async function forgotPassword(email: string): Promise<ForgotResult> {
  await ensureBootstrap();
  const a = await adminByEmail(email);
  if (!a || !isEmail(a.email)) return { sentTo: maskEmail(email.trim()) };
  const ts = nowMs();
  const recent = await sql<{ created_at: string }[]>`
    SELECT created_at FROM admin_otps WHERE admin_id = ${a.id} AND purpose = 'reset' AND created_at > ${ts - 3_600_000}
    ORDER BY created_at DESC`;
  if (recent[0] && ts - Number(recent[0].created_at) < OTP_RESEND_GAP_MS) {
    const wait = Math.ceil((OTP_RESEND_GAP_MS - (ts - Number(recent[0].created_at))) / 1000);
    throw new AppError('RATE_LIMITED', `Kode baru saja dikirim. Tunggu ${wait} detik untuk kirim ulang.`);
  }
  if (recent.length >= OTP_MAX_PER_HOUR) throw new AppError('RATE_LIMITED', 'Terlalu sering meminta kode. Coba lagi dalam 1 jam.');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const id = uuid();
  await sql.begin(async (tx) => {
    await tx`UPDATE admin_otps SET used_at = ${ts} WHERE admin_id = ${a.id} AND purpose = 'reset' AND used_at IS NULL`;
    await tx`INSERT INTO admin_otps ${tx({ id, admin_id: a.id, purpose: 'reset', code_hash: otpHash(id, code), expires_at: ts + OTP_TTL_MS, created_at: ts })}`;
  });
  const res = await sendMail({
    to: [a.email],
    subject: `${code} — kode reset password Admin Sirko`,
    text: `Kode reset password dashboard Admin Sirko: ${code}\n\nBerlaku 10 menit. Jangan berikan kode ini kepada siapa pun.\nAbaikan email ini bila Anda tidak memintanya.`,
    html: `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:480px;margin:auto;color:#151a2d">
  <h2 style="margin:0 0 8px">Reset password Admin Sirko</h2>
  <p style="margin:0 0 16px;color:#5f6784">Masukkan kode berikut di halaman reset password dashboard:</p>
  <div style="font-size:32px;font-weight:800;letter-spacing:.3em;text-align:center;border:1px solid #e2e6ef;border-radius:12px;padding:16px;font-family:ui-monospace,Consolas,monospace">${code}</div>
  <p style="font-size:13px;color:#5f6784">Berlaku <b>10 menit</b>. Jangan berikan kode ini kepada siapa pun.</p>
  <p style="font-size:12px;color:#8a90a6">Abaikan email ini bila Anda tidak memintanya.</p>
</div>`,
  });
  if (!res.ok) console.warn(`[admin] OTP reset untuk ${maskEmail(a.email)} tidak terkirim: ${res.error ?? ''}`);
  const dev = Boolean(env.AUTH_DEV_OTP_ECHO) && env.APP_ENV !== 'production';
  return { sentTo: maskEmail(a.email), ...(dev ? { devCode: code } : {}) };
}

const passwordSchema = z.string().min(8, 'Password minimal 8 karakter').max(200);

/** Reset password dengan OTP → admin (untuk langsung masuk). Semua sesi lama gugur. */
export async function resetPassword(email: string, code: string, newPassword: string): Promise<AdminUser> {
  const pw = passwordSchema.parse(newPassword);
  const a = await adminByEmail(email);
  const bad = (m = 'Kode salah atau sudah tidak berlaku. Minta kode baru.') => new AppError('OTP_INVALID', m);
  if (!a) throw bad();
  await sql.begin(async (tx) => {
    const r = await tx<Row[]>`
      SELECT * FROM admin_otps WHERE admin_id = ${a.id} AND purpose = 'reset' AND used_at IS NULL
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE`;
    const o = r[0];
    const ts = nowMs();
    if (!o || Number(o.expires_at) < ts) throw bad('Kode sudah kedaluwarsa. Minta kode baru.');
    if (Number(o.attempts) >= OTP_MAX_ATTEMPTS) throw bad('Terlalu banyak salah kode. Minta kode baru.');
    const want = Buffer.from(o.code_hash as string, 'hex');
    const got = Buffer.from(otpHash(o.id as string, code.trim()), 'hex');
    if (want.length !== got.length || !timingSafeEqual(want, got)) {
      await tx`UPDATE admin_otps SET attempts = attempts + 1 WHERE id = ${o.id as string}`;
      return; // dicatat; error dilempar di luar transaksi agar attempts tersimpan
    }
    await tx`UPDATE admin_otps SET used_at = ${ts} WHERE id = ${o.id as string}`;
    await tx`UPDATE admin_users SET password_hash = ${await hashPassword(pw)}, password_changed_at = ${ts}, updated_at = ${ts} WHERE id = ${a.id}`;
  });
  const after = (await adminById(a.id))!;
  if (after.passwordChangedAt === a.passwordChangedAt) throw bad();
  await loginThrottle.clearFailures(`adm:${a.email.toLowerCase()}`);
  return after;
}

/** Ganti password dari halaman profil (password lama wajib). Sesi di perangkat lain gugur. */
export async function changePassword(adminId: string, current: string, next: string, confirm: string): Promise<AdminUser> {
  const r = await sql<Row[]>`SELECT * FROM admin_users WHERE id = ${adminId}`;
  if (!r[0]) throw validation('Admin tidak ditemukan.');
  if (!(await verifyPassword(current, r[0].password_hash as string))) throw validation('Password lama salah.');
  const pw = passwordSchema.parse(next);
  if (pw !== confirm) throw validation('Konfirmasi password baru tidak sama.');
  const ts = nowMs();
  await sql`UPDATE admin_users SET password_hash = ${await hashPassword(pw)}, password_changed_at = ${ts}, updated_at = ${ts} WHERE id = ${adminId}`;
  return (await adminById(adminId))!;
}

const profileSchema = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi').max(80),
  email: z.string().trim().toLowerCase().email('Email tidak valid').max(120),
});

export async function updateProfile(adminId: string, input: unknown): Promise<AdminUser> {
  const p = profileSchema.parse(input);
  const clash = await sql`SELECT 1 FROM admin_users WHERE email = ${p.email} AND id <> ${adminId}`;
  if (clash.length) throw validation('Email sudah dipakai admin lain.');
  await sql`UPDATE admin_users SET name = ${p.name}, email = ${p.email}, updated_at = ${nowMs()} WHERE id = ${adminId}`;
  return (await adminById(adminId))!;
}

// ── Telegram ─────────────────────────────────────────────────────────────────

const tokenHash = (t: string) => createHash('sha256').update(`tg-link:${t}`).digest('hex');

/** Token deep link `t.me/<bot>?start=<token>` (sekali pakai, 10 menit). */
export async function createTelegramLinkToken(adminId: string): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(18).toString('base64url');
  const ts = nowMs();
  await sql.begin(async (tx) => {
    await tx`UPDATE admin_otps SET used_at = ${ts} WHERE admin_id = ${adminId} AND purpose = 'telegram' AND used_at IS NULL`;
    await tx`INSERT INTO admin_otps ${tx({ id: uuid(), admin_id: adminId, purpose: 'telegram', code_hash: tokenHash(token), expires_at: ts + TG_LINK_TTL_MS, created_at: ts })}`;
  });
  return { token, expiresAt: ts + TG_LINK_TTL_MS };
}

/** Pakai token dari /start → tautkan chat ke admin. Chat yang sama dilepas dari admin lain. */
export async function linkTelegram(token: string, chatId: number, username: string | null): Promise<AdminUser | null> {
  const ts = nowMs();
  return sql.begin(async (tx) => {
    const r = await tx<Row[]>`
      UPDATE admin_otps SET used_at = ${ts}
      WHERE code_hash = ${tokenHash(token)} AND purpose = 'telegram' AND used_at IS NULL AND expires_at >= ${ts}
      RETURNING admin_id`;
    if (!r[0]) return null;
    const adminId = r[0].admin_id as string;
    await tx`UPDATE admin_users SET telegram_chat_id = NULL, telegram_username = NULL, telegram_linked_at = NULL WHERE telegram_chat_id = ${chatId} AND id <> ${adminId}`;
    await tx`UPDATE admin_users SET telegram_chat_id = ${chatId}, telegram_username = ${username}, telegram_linked_at = ${ts}, updated_at = ${ts} WHERE id = ${adminId}`;
    const a = await tx<Row[]>`SELECT * FROM admin_users WHERE id = ${adminId}`;
    return toAdmin(a[0]!);
  });
}

export async function unlinkTelegram(adminId: string): Promise<void> {
  await sql`UPDATE admin_users SET telegram_chat_id = NULL, telegram_username = NULL, telegram_linked_at = NULL, updated_at = ${nowMs()} WHERE id = ${adminId}`;
}
