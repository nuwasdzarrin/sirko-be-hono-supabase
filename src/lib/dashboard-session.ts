import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { env } from '../config/env.js';

/**
 * Sesi login dashboard admin — cookie bertanda-tangan HMAC (stateless, aman di
 * serverless). Kredensial = DASHBOARD_USER/DASHBOARD_PASSWORD (env, sama seperti
 * Basic Auth sebelumnya). Cookie HttpOnly + SameSite=Lax → JS tak bisa membaca &
 * POST lintas-situs (CSRF) tak membawa sesi.
 *
 * Isi cookie: `<user>|<expiresMs>`; kedaluwarsa dicek di server (tak hanya Max-Age).
 */

export const SESSION_COOKIE = 'sirko_admin';
const SHORT_TTL_S = 60 * 60 * 12; // 12 jam
const LONG_TTL_S = 60 * 60 * 24 * 30; // "ingat saya": 30 hari

/** Kunci HMAC diturunkan dari JWT_SECRET (tujuan berbeda → kunci berbeda). */
const SECRET = createHash('sha256').update(`dashboard-session:${env.JWT_SECRET}`).digest('hex');

/** Login dashboard aktif hanya bila kredensial diset (dev tanpa kredensial = terbuka). */
export const dashboardAuthEnabled = Boolean(env.DASHBOARD_USER && env.DASHBOARD_PASSWORD);

function sameSecret(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function checkCredentials(user: string, password: string): boolean {
  // Evaluasi keduanya (tanpa short-circuit) → waktu respons tak membocorkan mana yang salah.
  const u = sameSecret(user, env.DASHBOARD_USER ?? '');
  const p = sameSecret(password, env.DASHBOARD_PASSWORD ?? '');
  return dashboardAuthEnabled && u && p;
}

const secure = () => env.APP_ENV === 'production';

export async function startSession(c: Context, user: string, remember: boolean): Promise<void> {
  const ttl = remember ? LONG_TTL_S : SHORT_TTL_S;
  const exp = Date.now() + ttl * 1000;
  await setSignedCookie(c, SESSION_COOKIE, `${user}|${exp}`, SECRET, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'Lax',
    path: '/',
    maxAge: ttl,
  });
}

export function endSession(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: secure() });
}

/** Nama admin dari sesi valid, atau null. */
export async function sessionUser(c: Context): Promise<string | null> {
  const raw = await getSignedCookie(c, SECRET, SESSION_COOKIE);
  if (!raw) return null;
  const sep = raw.lastIndexOf('|');
  const user = raw.slice(0, sep);
  const exp = Number(raw.slice(sep + 1));
  if (sep < 1 || !Number.isFinite(exp) || exp < Date.now()) return null;
  return user;
}

/** Hanya izinkan redirect pasca-login ke dalam /dashboard (cegah open redirect). */
export function safeNext(next: string | undefined): string {
  if (next && /^\/dashboard(\/[\w\-/]*)?(\?[^\\]*)?$/.test(next) && !next.startsWith('/dashboard/login')) {
    return next;
  }
  return '/dashboard';
}
