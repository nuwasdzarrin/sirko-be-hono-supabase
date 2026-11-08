import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Klien Telegram Bot API untuk bot admin Sirko (notifikasi + perintah interaktif).
 * Transport bisa diganti di test (setTelegramApi). Webhook diverifikasi lewat header
 * `X-Telegram-Bot-Api-Secret-Token` = webhookSecret() (diturunkan dari JWT_SECRET).
 */

/** Tombol inline: tautan, callback, atau salin teks (Bot API 7.11+). */
export type TgButton =
  | { text: string; url: string }
  | { text: string; callback_data: string }
  | { text: string; copy_text: { text: string } };

export type TelegramApi = (method: string, body: Record<string, unknown>) => Promise<any>;

async function httpApi(method: string, body: Record<string, unknown>): Promise<any> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN belum diisi');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
  if (!res.ok || !json.ok) throw new Error(`Telegram ${method} HTTP ${res.status}: ${json.description ?? ''}`.slice(0, 240));
  return json.result;
}

let api: TelegramApi = httpApi;

/** Ganti transport (test). Kembalikan fungsi pemulih. */
export function setTelegramApi(t: TelegramApi): () => void {
  const prev = api;
  api = t;
  botName = null;
  return () => {
    api = prev;
    botName = null;
  };
}

export const telegramConfigured = () => Boolean(env.TELEGRAM_BOT_TOKEN) || api !== httpApi;

export function tg(method: string, body: Record<string, unknown>): Promise<any> {
  return api(method, body);
}

/** Kirim pesan HTML; error dicatat, tak dilempar. */
export async function tgSend(chatId: number | string, text: string, extra: Record<string, unknown> = {}): Promise<any> {
  try {
    return await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
  } catch (e) {
    console.error('[telegram] sendMessage gagal:', (e as Error).message);
    return null;
  }
}

let botName: string | null = null;

/** Username bot (tanpa @) untuk deep link t.me/<bot>?start=…; null bila bot belum dikonfigurasi. */
export async function botUsername(): Promise<string | null> {
  if (botName) return botName;
  if (!telegramConfigured()) return null;
  try {
    const me = (await tg('getMe', {})) as { username?: string };
    botName = me.username ?? null;
  } catch (e) {
    console.error('[telegram] getMe gagal:', (e as Error).message);
  }
  return botName;
}

/** Secret webhook (dipasang lewat setWebhook secret_token). Kosong bila bot belum dikonfigurasi. */
export function webhookSecret(): string {
  return createHash('sha256').update(`telegram-webhook:${env.JWT_SECRET}:${env.TELEGRAM_BOT_TOKEN ?? ''}`).digest('hex').slice(0, 48);
}

export function verifyWebhookSecret(header: string | undefined): boolean {
  if (!header) return false;
  const a = createHash('sha256').update(header).digest();
  const b = createHash('sha256').update(webhookSecret()).digest();
  return timingSafeEqual(a, b);
}

/** Escape teks untuk parse_mode HTML. */
export const tgEsc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
