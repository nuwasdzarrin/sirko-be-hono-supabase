import { env } from '../config/env.js';

/**
 * Notifikasi ke admin Sirko via Telegram Bot API (sendMessage).
 * Tak pernah melempar error: kegagalan notifikasi tak boleh menggagalkan
 * transaksi bisnis (dicatat di log saja). Tanpa TELEGRAM_* → dilewati.
 */

export interface AdminNotice {
  text: string; // HTML sederhana (<b>, <i>, <code>, <a>)
  /** Path dashboard, mis. `/dashboard/points?tab=topups` → jadi tombol tautan. */
  linkPath?: string;
  linkLabel?: string;
}

/** Transport yang bisa diganti di test. */
export type NotifyTransport = (n: AdminNotice) => Promise<void>;

export const sentNotices: AdminNotice[] = []; // jejak untuk test/debug (dibatasi)

async function telegramTransport(n: AdminNotice): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId) {
    console.log(`[notify] (Telegram belum dikonfigurasi) ${n.text.replace(/<[^>]+>/g, '')}`);
    return;
  }
  const base = (env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  const url = n.linkPath && base ? `${base}${n.linkPath}` : null;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: n.text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (url) body.reply_markup = { inline_keyboard: [[{ text: n.linkLabel ?? 'Buka dashboard', url }]] };
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

let transport: NotifyTransport = telegramTransport;

/** Ganti transport (test). Kembalikan fungsi pemulih. */
export function setNotifyTransport(t: NotifyTransport): () => void {
  const prev = transport;
  transport = t;
  return () => {
    transport = prev;
  };
}

export async function notifyAdmin(n: AdminNotice): Promise<void> {
  sentNotices.push(n);
  if (sentNotices.length > 50) sentNotices.shift();
  try {
    await transport(n);
  } catch (e) {
    console.error('[notify] gagal mengirim notifikasi admin:', (e as Error).message);
  }
}

/** Escape teks untuk parse_mode HTML Telegram. */
export const tgEsc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
