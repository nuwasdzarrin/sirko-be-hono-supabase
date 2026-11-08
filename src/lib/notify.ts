import { env } from '../config/env.js';
import { sql } from '../db/client.js';
import { tg, type TgButton } from './telegram.js';

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
  /** Baris tombol inline tambahan (di atas tombol tautan dashboard), mis. salin no meter. */
  buttons?: TgButton[][];
}

/** Transport yang bisa diganti di test. */
export type NotifyTransport = (n: AdminNotice) => Promise<void>;

export const sentNotices: AdminNotice[] = []; // jejak untuk test/debug (dibatasi)

/** Tujuan notifikasi: semua admin yang menautkan Telegram + TELEGRAM_ADMIN_CHAT_ID lama. */
export async function adminChatIds(): Promise<string[]> {
  const ids = new Set<string>();
  if (env.TELEGRAM_ADMIN_CHAT_ID) ids.add(String(env.TELEGRAM_ADMIN_CHAT_ID).trim());
  try {
    const r = await sql<{ c: string }[]>`SELECT telegram_chat_id::text c FROM admin_users WHERE telegram_chat_id IS NOT NULL`;
    for (const x of r) ids.add(x.c);
  } catch {
    // tabel belum ada (migrasi belum jalan) → pakai .env saja
  }
  return [...ids].filter(Boolean);
}

/** reply_markup untuk notifikasi: tombol tambahan + tombol tautan dashboard. */
export function noticeMarkup(n: AdminNotice): Record<string, unknown> | undefined {
  const base = (env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  const url = n.linkPath && base ? `${base}${n.linkPath}` : null;
  const rows: TgButton[][] = [...(n.buttons ?? [])];
  if (url) rows.push([{ text: n.linkLabel ?? 'Buka dashboard', url }]);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

async function telegramTransport(n: AdminNotice): Promise<void> {
  const chats = env.TELEGRAM_BOT_TOKEN ? await adminChatIds() : [];
  if (!chats.length) {
    console.log(`[notify] (Telegram belum dikonfigurasi) ${n.text.replace(/<[^>]+>/g, '')}`);
    return;
  }
  const markup = noticeMarkup(n);
  const errors: string[] = [];
  for (const chatId of chats) {
    try {
      await tg('sendMessage', {
        chat_id: chatId,
        text: n.text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(markup ? { reply_markup: markup } : {}),
      });
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (errors.length) throw new Error(errors.join(' | '));
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
