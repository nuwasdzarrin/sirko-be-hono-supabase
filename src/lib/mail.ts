import { env } from '../config/env.js';

/**
 * Email transaksional via Resend (https://api.resend.com/emails).
 * Tak pernah melempar: hasil dikembalikan sebagai {ok, id?, error?} agar pemanggil
 * bisa mencatatnya (mis. event order). Tanpa RESEND_API_KEY/MAIL_FROM → dilewati.
 * Transport bisa diganti di test via {@link setMailTransport}.
 */

export interface MailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export interface MailResult {
  ok: boolean;
  id?: string;
  skipped?: boolean;
  error?: string;
}

export type MailTransport = (m: MailMessage) => Promise<MailResult>;

async function resendTransport(m: MailMessage): Promise<MailResult> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    console.log(`[mail] (Resend belum dikonfigurasi) ke ${m.to.join(', ')}: ${m.subject}`);
    return { ok: false, skipped: true, error: 'Resend belum dikonfigurasi' };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: m.to, subject: m.subject, html: m.html, text: m.text }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) return { ok: false, error: `Resend HTTP ${res.status}: ${body.message ?? ''}`.trim() };
  return { ok: true, id: body.id };
}

let transport: MailTransport = resendTransport;

export function setMailTransport(t: MailTransport): () => void {
  const prev = transport;
  transport = t;
  return () => {
    transport = prev;
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function sendMail(m: MailMessage): Promise<MailResult> {
  const to = [...new Set(m.to.map((x) => x.trim().toLowerCase()).filter((x) => EMAIL_RE.test(x)))];
  if (to.length === 0) return { ok: false, skipped: true, error: 'Tidak ada alamat email penerima' };
  try {
    return await transport({ ...m, to });
  } catch (e) {
    console.error('[mail] gagal mengirim:', (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}

/** Escape teks untuk disisipkan ke HTML email. */
export const htmlEsc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
