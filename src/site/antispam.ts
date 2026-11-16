import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Penangkal spam formulir publik sirkopos.com (kontak, daftar tunggu, hapus akun). Tiga lapis:
 *
 * 1. **Cloudflare Turnstile** (bila TURNSTILE_SITE_KEY & TURNSTILE_SECRET_KEY diisi): widget di
 *    formulir; token diverifikasi ke siteverify. Gagal → formulir ditolak dengan pesan (manusia
 *    bisa mencoba lagi / pakai WhatsApp).
 * 2. **Jebakan waktu**: field tersembunyi `ft` = waktu halaman dibuat + HMAC. Tanpa token, token
 *    palsu, atau dikirim < 3 detik setelah halaman dibuka → spam. Tanpa JavaScript.
 * 3. **Saringan isi**: pola spam umum (tawaran "submit ke Google index", jasa SEO, email yang
 *    meniru domain situs, pesan penuh tautan).
 *
 * Lapis 2 & 3 tidak memberi tahu pengirim (bot tetap melihat "terkirim"); pesan disimpan berstatus
 * `spam` tanpa notifikasi Telegram, dan admin bisa memulihkannya di dashboard.
 */

const MIN_FILL_MS = 3_000;
const key = () => createHmac('sha256', `site-form:${env.JWT_SECRET}`).update('k').digest();

/** Token waktu untuk field tersembunyi `ft`. `at` hanya untuk test. */
export function formToken(at = Date.now()): string {
  const ts = String(at);
  return `${ts}.${createHmac('sha256', key()).update(ts).digest('base64url').slice(0, 22)}`;
}

/** null = lolos; selain itu alasan spam. */
export function formTokenProblem(token: unknown, now = Date.now()): string | null {
  if (typeof token !== 'string' || !token) return 'tanpa token waktu formulir';
  const [ts, sig] = token.split('.');
  if (!ts || !sig || !/^\d{10,16}$/.test(ts)) return 'token waktu formulir rusak';
  const want = Buffer.from(createHmac('sha256', key()).update(ts).digest('base64url').slice(0, 22));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return 'token waktu formulir palsu';
  if (now - Number(ts) < MIN_FILL_MS) return 'dikirim terlalu cepat (< 3 detik)';
  return null;
}

const SPAM_PATTERNS: Array<[RegExp, string]> = [
  [/search\s*index|google'?s?\s+(search\s+)?index|submit\s+(your\s+)?(site|website|domain|url)|(list|register|include)\s+\S+\.(com|id|net)\s+(now|in\s+google)/i, 'tawaran daftar ke indeks Google'],
  [/domain\s*submit|search\s*register|seo\s+(service|plan|proposal|audit|package|expert)|top\s+google\s+rank|rank(ing)?s?\s+on\s+google|first\s+page\s+of\s+google|backlinks?|guest\s+post|boost\s+your\s+website/i, 'tawaran jasa SEO/backlink'],
  [/crypto(currency)?\s+(invest|trading)|casino|viagra|loan\s+offer|web\s*design\s+(service|agency)|we\s+can\s+help\s+you\s+(get|achieve|rank)/i, 'kata kunci spam umum'],
];

/** Saringan isi: alasan spam atau null. */
export function contentSpamReason(p: { name?: string; contact: string; message?: string }): string | null {
  const host = new URL(env.SITE_URL).hostname.replace(/^www\./, '').toLowerCase();
  const brand = host.split('.')[0]!;
  const emailDomain = /@([^@\s]+)$/.exec(p.contact.trim().toLowerCase())?.[1];
  if (emailDomain && emailDomain !== host && emailDomain.includes(brand)) return `email meniru domain situs (${emailDomain})`;
  const text = `${p.name ?? ''}\n${p.message ?? ''}`;
  for (const [re, why] of SPAM_PATTERNS) if (re.test(text)) return why;
  const links = text.match(/https?:\/\/|www\.|\b[a-z0-9-]+\.(live|pro|xyz|top|click|online|site|info|biz)\b/gi) ?? [];
  if (links.length >= 3) return `pesan berisi ${links.length} tautan`;
  return null;
}

// ── Cloudflare Turnstile ─────────────────────────────────────────────────────

export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

export const turnstileEnabled = () => Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);

/** Widget + skrip Turnstile (kosong bila belum dikonfigurasi). Satu formulir per halaman. */
export function turnstileWidget(): string {
  if (!turnstileEnabled()) return '';
  const k = String(env.TURNSTILE_SITE_KEY).replace(/[^\w-]/g, '');
  return `<div class="cf-turnstile" data-sitekey="${k}" data-language="id" data-theme="auto" data-size="flexible"></div>
<script src="${TURNSTILE_ORIGIN}/turnstile/v0/api.js" async defer></script>`;
}

export type TurnstileVerifier = (token: string, ip: string) => Promise<{ success: boolean; codes: string[] }>;

const siteverify: TurnstileVerifier = async (token, ip) => {
  const body = new URLSearchParams({ secret: String(env.TURNSTILE_SECRET_KEY), response: token });
  if (ip && ip !== 'unknown') body.set('remoteip', ip);
  const res = await fetch(`${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
  const j = (await res.json().catch(() => ({}))) as { success?: boolean; 'error-codes'?: string[] };
  return { success: Boolean(j.success), codes: j['error-codes'] ?? [] };
};

let verifier: TurnstileVerifier = siteverify;

/** Ganti verifikator (test). Kembalikan pemulih. */
export function setTurnstileVerifier(v: TurnstileVerifier): () => void {
  const prev = verifier;
  verifier = v;
  return () => {
    verifier = prev;
  };
}

/** null = lolos (atau Turnstile belum dikonfigurasi); selain itu pesan untuk pengunjung. */
export async function turnstileProblem(token: unknown, ip: string): Promise<string | null> {
  if (!turnstileEnabled()) return null;
  if (typeof token !== 'string' || !token) return 'Centang verifikasi keamanan (Cloudflare) dulu, lalu kirim lagi.';
  try {
    const r = await verifier(token, ip);
    if (r.success) return null;
    console.warn('[site] Turnstile ditolak:', r.codes.join(',') || '-');
    return 'Verifikasi keamanan gagal atau kedaluwarsa. Muat ulang halaman lalu kirim lagi.';
  } catch (e) {
    console.error('[site] Turnstile siteverify gagal:', (e as Error).message);
    return 'Verifikasi keamanan sedang bermasalah. Coba lagi sebentar, atau hubungi kami lewat WhatsApp.';
  }
}
