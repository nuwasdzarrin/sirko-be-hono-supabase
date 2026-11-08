import { sql } from '../db/client.js';
import { env } from '../config/env.js';
import { nowMs } from '../lib/time.js';
import { tg, tgEsc, tgSend, type TgButton } from '../lib/telegram.js';
import * as adminSvc from './admin.service.js';
import * as points from './points.service.js';
import * as ppob from './ppob.service.js';

const rupiah = (v: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(v);

/**
 * Bot admin Sirko (Telegram, lewat webhook POST /v1/webhooks/telegram).
 *
 * Hanya chat pribadi admin yang sudah ditautkan (Profil → Hubungkan Telegram) yang dilayani.
 * Perintah: /ringkasan, /token, /topup, /saldo, /login, /menu.
 * Aksi tanpa membuka web:
 *  - Order token PLN: tombol "Salin no meter" (copy_text), "Kirim token" → bot meminta balasan
 *    token 20 digit (force_reply; id order ikut di teks "Ref PLN-FILL:<id>") → token disimpan &
 *    email terkirim ke pelanggan. "Gagalkan" → balasan alasan → Poin dikembalikan.
 *  - Top-up Poin: "Dana masuk" → konfirmasi 2 langkah → Poin dikredit; "Tolak" → balasan alasan.
 */

type Row = Record<string, unknown>;
type Admin = adminSvc.AdminUser;

interface TgUser { id: number; username?: string; first_name?: string; is_bot?: boolean }
interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  reply_to_message?: TgMessage;
}
interface TgCallback { id: string; from: TgUser; data?: string; message?: TgMessage }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback }

const dashUrl = (path = '/dashboard') => `${(env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '')}${path}`;
const hasDashUrl = () => Boolean(env.PUBLIC_BASE_URL);

const MENU_BUTTONS = (): TgButton[][] => [
  [
    { text: '📊 Ringkasan', callback_data: 'm:sum' },
    { text: '⚡ Antrean token', callback_data: 'm:token' },
  ],
  [
    { text: '💰 Top-up menunggu', callback_data: 'm:topup' },
    { text: '🏦 Saldo Digiflazz', callback_data: 'm:saldo' },
  ],
  ...(hasDashUrl() ? [[{ text: '🌐 Buka dashboard', url: dashUrl() }]] : []),
];

const HELP =
  `<b>Perintah</b>\n` +
  `/ringkasan — angka penting hari ini\n` +
  `/token — order token listrik yang menunggu\n` +
  `/topup — top-up Poin yang menunggu konfirmasi\n` +
  `/saldo — saldo deposit Digiflazz\n` +
  `/login — tautan dashboard\n` +
  `/menu — tampilkan tombol menu`;

const NOT_LINKED = 'Akun Telegram ini belum tertaut ke admin Sirko.\nBuka dashboard Sirko → <b>Profil</b> → <b>Hubungkan Telegram</b>.';

/** Admin pemilik chat ini (tautan di admin_users; cadangan: TELEGRAM_ADMIN_CHAT_ID lama). */
async function adminForChat(chatId: number): Promise<Admin | null> {
  await adminSvc.ensureBootstrap();
  const a = await adminSvc.adminByTelegramChat(chatId);
  if (a) return a;
  if (env.TELEGRAM_ADMIN_CHAT_ID && String(env.TELEGRAM_ADMIN_CHAT_ID).trim() === String(chatId)) {
    const r = await sql<Row[]>`SELECT email FROM admin_users ORDER BY created_at LIMIT 1`;
    return r[0] ? adminSvc.adminByEmail(String(r[0].email)) : null;
  }
  return null;
}

const actor = (a: Admin) => `${a.email} (Telegram)`;

export async function handleUpdate(u: TgUpdate): Promise<void> {
  try {
    if (u.callback_query) await onCallback(u.callback_query);
    else if (u.message) await onMessage(u.message);
  } catch (e) {
    console.error('[telegram-bot] gagal memproses update', u.update_id, (e as Error).message);
  }
}

// ── Pesan teks ───────────────────────────────────────────────────────────────

async function onMessage(m: TgMessage): Promise<void> {
  if (m.chat.type !== 'private' || !m.text) return;
  const chatId = m.chat.id;
  const text = m.text.trim();

  const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(text);
  if (start?.[1]) {
    const a = await adminSvc.linkTelegram(start[1], chatId, m.from?.username ?? null);
    if (!a) {
      await tgSend(chatId, 'Tautan sudah kedaluwarsa atau sudah dipakai. Buat tautan baru di dashboard → <b>Profil</b> → <b>Hubungkan Telegram</b>.');
      return;
    }
    await tgSend(
      chatId,
      `✅ Halo <b>${tgEsc(a.name || a.email)}</b>! Telegram ini sudah tertaut ke dashboard Admin Sirko.\n` +
        `Mulai sekarang notifikasi order token, top-up Poin & gangguan PPOB dikirim ke sini.\n\n${HELP}`,
      { reply_markup: { inline_keyboard: MENU_BUTTONS() } },
    );
    return;
  }

  const admin = await adminForChat(chatId);
  if (!admin) {
    await tgSend(chatId, NOT_LINKED);
    return;
  }

  const ref = m.reply_to_message?.from?.is_bot ? /Ref (PLN-FILL|PLN-FAIL|TOPUP-REJECT):([0-9a-f-]{36})/.exec(m.reply_to_message.text ?? '') : null;
  if (ref) {
    await onReply(admin, chatId, ref[1]!, ref[2]!, text);
    return;
  }

  const cmd = /^\/(\w+)/.exec(text)?.[1]?.toLowerCase();
  switch (cmd) {
    case 'ringkasan':
    case 'status':
      return sendSummary(chatId);
    case 'token':
      return sendPlnQueue(chatId);
    case 'topup':
      return sendTopupQueue(chatId);
    case 'saldo':
      return sendDeposit(chatId);
    case 'login':
      await tgSend(chatId, hasDashUrl() ? `Dashboard: ${dashUrl()}` : 'PUBLIC_BASE_URL belum diisi di server.');
      return;
    case 'help':
    case 'bantuan':
      await tgSend(chatId, HELP);
      return;
    default:
      await tgSend(chatId, `Halo <b>${tgEsc(admin.name || admin.email)}</b>, pilih menu:`, { reply_markup: { inline_keyboard: MENU_BUTTONS() } });
  }
}

/** Balasan atas prompt force_reply (token / alasan). */
async function onReply(admin: Admin, chatId: number, kind: string, id: string, text: string): Promise<void> {
  if (kind === 'PLN-FILL') {
    const r = await ppob.adminFulfillPln(id, text, actor(admin));
    await tgSend(chatId, r.ok ? `✅ ${tgEsc(r.message)}` : `⚠️ ${tgEsc(r.message)}`, r.ok ? {} : { reply_markup: { inline_keyboard: [[{ text: '✍️ Kirim token lagi', callback_data: `pln:f:${id}` }]] } });
    return;
  }
  if (kind === 'PLN-FAIL') {
    const r = await ppob.adminFailPln(id, text, actor(admin));
    await tgSend(chatId, `${r.ok ? '✅' : '⚠️'} ${tgEsc(r.message)}`);
    return;
  }
  if (kind === 'TOPUP-REJECT') {
    const r = await points.adminRejectTopup(id, actor(admin), text.slice(0, 300) || null);
    await tgSend(chatId, `${r.ok ? '✅' : '⚠️'} ${tgEsc(r.message)}`);
  }
}

// ── Tombol (callback) ────────────────────────────────────────────────────────

async function onCallback(q: TgCallback): Promise<void> {
  const chatId = q.message?.chat.id ?? q.from.id;
  const answer = (text?: string) => tg('answerCallbackQuery', { callback_query_id: q.id, ...(text ? { text } : {}) }).catch(() => null);
  const admin = await adminForChat(chatId);
  if (!admin) {
    await answer('Telegram ini belum tertaut ke admin Sirko.');
    return;
  }
  const data = q.data ?? '';
  const [ns, act, id] = data.split(':');
  await answer();

  if (ns === 'm') {
    if (act === 'sum') return sendSummary(chatId);
    if (act === 'token') return sendPlnQueue(chatId);
    if (act === 'topup') return sendTopupQueue(chatId);
    if (act === 'saldo') return sendDeposit(chatId);
    await tgSend(chatId, 'Pilih menu:', { reply_markup: { inline_keyboard: MENU_BUTTONS() } });
    return;
  }

  if (ns === 'pln' && id) {
    const o = await plnOrder(id);
    if (!o) return void tgSend(chatId, 'Order tidak ditemukan.');
    if (o.status !== 'waiting_admin') return void tgSend(chatId, `Order ${tgEsc(o.product_name)} → <code>${tgEsc(o.customer_no)}</code> sudah berstatus <b>${tgEsc(o.status)}</b>.`);
    if (act === 'f') {
      await tgSend(
        chatId,
        `✍️ <b>Balas pesan ini dengan token 20 digit</b>\n${tgEsc(o.product_name)} · meter <code>${tgEsc(o.customer_no)}</code>${o.pln_name ? ` (${tgEsc(o.pln_name)})` : ''}\nToko: ${tgEsc(o.business_name ?? '—')}\n\nRef PLN-FILL:${id}`,
        { reply_markup: { force_reply: true, input_field_placeholder: 'Tempel token 20 digit' } },
      );
    } else if (act === 'x') {
      await tgSend(
        chatId,
        `❌ <b>Balas pesan ini dengan alasan gagal</b> (dikirim ke pelanggan, Poin dikembalikan)\n${tgEsc(o.product_name)} · meter <code>${tgEsc(o.customer_no)}</code>\n\nRef PLN-FAIL:${id}`,
        { reply_markup: { force_reply: true, input_field_placeholder: 'mis. Nomor meter salah' } },
      );
    }
    return;
  }

  if (ns === 'tu' && id) {
    const t = await points.getTopup(id);
    if (!t) return void tgSend(chatId, 'Top-up tidak ditemukan.');
    if (t.status !== 'pending' && t.status !== 'expired') return void tgSend(chatId, `Top-up ${tgEsc(rupiah(t.transferAmount))} sudah berstatus <b>${tgEsc(t.status)}</b>.`);
    if (act === 'a') {
      await tgSend(
        chatId,
        `Konfirmasi top-up <b>${tgEsc(rupiah(t.transferAmount))}</b> dari <b>${tgEsc(t.businessName ?? '—')}</b>?\nPastikan dana <b>sudah masuk</b> di mutasi rekening/QRIS dengan nominal persis sama.`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Ya, dana sudah masuk', callback_data: `tu:y:${id}` },
              { text: 'Batal', callback_data: 'x:x' },
            ]],
          },
        },
      );
    } else if (act === 'y') {
      const r = await points.adminConfirmTopup(id, actor(admin));
      if (q.message) {
        await tg('editMessageText', { chat_id: chatId, message_id: q.message.message_id, text: `${r.ok ? '✅' : '⚠️'} ${tgEsc(r.message)}`, parse_mode: 'HTML' }).catch(
          () => tgSend(chatId, `${r.ok ? '✅' : '⚠️'} ${tgEsc(r.message)}`),
        );
      } else await tgSend(chatId, `${r.ok ? '✅' : '⚠️'} ${tgEsc(r.message)}`);
    } else if (act === 'r') {
      await tgSend(
        chatId,
        `❌ <b>Balas pesan ini dengan alasan menolak</b> top-up ${tgEsc(rupiah(t.transferAmount))} dari ${tgEsc(t.businessName ?? '—')}\n\nRef TOPUP-REJECT:${id}`,
        { reply_markup: { force_reply: true, input_field_placeholder: 'mis. Dana tidak ditemukan' } },
      );
    }
    return;
  }

  if (ns === 'x' && q.message) {
    await tg('editMessageText', { chat_id: chatId, message_id: q.message.message_id, text: 'Dibatalkan.' }).catch(() => null);
  }
}

// ── Isi pesan ────────────────────────────────────────────────────────────────

async function plnOrder(id: string): Promise<Row | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await sql<Row[]>`
    SELECT o.*, b.name AS business_name FROM ppob_orders o LEFT JOIN businesses b ON b.id = o.business_id
    WHERE o.id = ${id} AND o.category = 'pln' AND o.provider = 'manual'`;
  return r[0] ?? null;
}

/** 00:00 WIB hari ini (epoch ms). */
function startOfTodayWib(now = nowMs()): number {
  const off = 7 * 3_600_000;
  return Math.floor((now + off) / 86_400_000) * 86_400_000 - off;
}

const ago = (ms: number) => {
  const m = Math.max(0, Math.round((nowMs() - ms) / 60_000));
  return m < 60 ? `${m} menit` : m < 1440 ? `${Math.floor(m / 60)} jam ${m % 60} menit` : `${Math.floor(m / 1440)} hari`;
};

export async function sendSummary(chatId: number): Promise<void> {
  const today = startOfTodayWib();
  const [u, p, t, dep] = await Promise.all([
    sql<Row[]>`
      SELECT (SELECT count(*)::int FROM accounts) AS accounts,
             (SELECT count(*)::int FROM accounts WHERE created_at >= ${today}) AS accounts_today,
             (SELECT count(*)::int FROM businesses WHERE deleted_at IS NULL) AS stores`,
    sql<Row[]>`
      SELECT count(*) FILTER (WHERE status = 'success')::int AS ok,
             coalesce(sum(price) FILTER (WHERE status = 'success'), 0)::bigint AS omzet,
             coalesce(sum(price - coalesce(provider_price, cost)) FILTER (WHERE status = 'success'), 0)::bigint AS laba,
             count(*) FILTER (WHERE status = 'failed')::int AS failed,
             (SELECT count(*)::int FROM ppob_orders WHERE status = 'waiting_admin') AS waiting,
             (SELECT count(*)::int FROM ppob_orders WHERE status IN ('pending', 'processing')) AS pending
      FROM ppob_orders WHERE created_at >= ${today}`,
    sql<Row[]>`
      SELECT (SELECT count(*)::int FROM point_topups WHERE status = 'pending') AS pending,
             (SELECT coalesce(sum(transfer_amount), 0)::bigint FROM point_topups WHERE status = 'pending') AS pending_sum,
             (SELECT coalesce(sum(amount), 0)::bigint FROM point_topups WHERE status = 'paid' AND paid_at >= ${today}) AS paid_today,
             (SELECT coalesce(sum(balance), 0)::bigint FROM point_accounts) AS outstanding`,
    ppob.depositBalance(),
  ]);
  const U = u[0]!;
  const P = p[0]!;
  const T = t[0]!;
  const n = (v: unknown) => Number(v ?? 0);
  const text =
    `📊 <b>Ringkasan Sirko</b> — hari ini\n\n` +
    `👤 Akun: <b>${n(U.accounts)}</b> (+${n(U.accounts_today)} hari ini) · Toko: <b>${n(U.stores)}</b>\n\n` +
    `<b>PPOB hari ini</b>\n` +
    `Sukses ${n(P.ok)} · gagal ${n(P.failed)}\n` +
    `Penjualan ${tgEsc(rupiah(n(P.omzet)))} · laba ${tgEsc(rupiah(n(P.laba)))}\n` +
    `${n(P.waiting) ? '⚡ ' : ''}Token menunggu admin: <b>${n(P.waiting)}</b> · pending penyedia: ${n(P.pending)}\n\n` +
    `<b>Poin</b>\n` +
    `${n(T.pending) ? '💰 ' : ''}Top-up menunggu: <b>${n(T.pending)}</b> (${tgEsc(rupiah(n(T.pending_sum)))})\n` +
    `Top-up dikonfirmasi hari ini: ${tgEsc(rupiah(n(T.paid_today)))}\n` +
    `Poin beredar: ${tgEsc(rupiah(n(T.outstanding)))}\n\n` +
    `🏦 Deposit Digiflazz: ${dep.value == null ? tgEsc(dep.error ?? '—') : `<b>${tgEsc(rupiah(dep.value))}</b>`}${env.DIGIFLAZZ_TESTING ? ' <i>(mode uji)</i>' : ''}`;
  const btn: TgButton[][] = [];
  if (n(P.waiting)) btn.push([{ text: `⚡ Proses ${n(P.waiting)} token`, callback_data: 'm:token' }]);
  if (n(T.pending)) btn.push([{ text: `💰 Cek ${n(T.pending)} top-up`, callback_data: 'm:topup' }]);
  btn.push([{ text: '🔄 Perbarui', callback_data: 'm:sum' }]);
  await tgSend(chatId, text, { reply_markup: { inline_keyboard: btn } });
}

export async function sendPlnQueue(chatId: number): Promise<void> {
  const rows = await sql<Row[]>`
    SELECT o.id, o.product_name, o.customer_no, o.pln_name, o.created_at, o.price, b.name AS business_name
    FROM ppob_orders o LEFT JOIN businesses b ON b.id = o.business_id
    WHERE o.status = 'waiting_admin' ORDER BY o.created_at LIMIT 10`;
  if (!rows.length) {
    await tgSend(chatId, '⚡ Tidak ada order token listrik yang menunggu. 🎉');
    return;
  }
  await tgSend(chatId, `⚡ <b>${rows.length} order token menunggu</b>${rows.length === 10 ? ' (10 terlama)' : ''} — terlama di atas:`);
  for (const o of rows) {
    await tgSend(
      chatId,
      `<b>${tgEsc(o.product_name)}</b> → <code>${tgEsc(o.customer_no)}</code>${o.pln_name ? ` (${tgEsc(o.pln_name)})` : ''}\n` +
        `Toko: ${tgEsc(o.business_name ?? '—')} · Poin ${tgEsc(rupiah(Number(o.price)))}\nMenunggu ${ago(Number(o.created_at))}`,
      { reply_markup: { inline_keyboard: [...ppob.plnOrderButtons(o.id as string, String(o.customer_no)), ...(hasDashUrl() ? [[{ text: 'Buka di dashboard', url: dashUrl(`/dashboard/ppob/orders/${o.id as string}`) }]] : [])] } },
    );
  }
}

export async function sendTopupQueue(chatId: number): Promise<void> {
  const rows = await sql<Row[]>`
    SELECT t.id, t.transfer_amount, t.unique_code, t.created_at, t.expires_at, b.name AS business_name
    FROM point_topups t LEFT JOIN businesses b ON b.id = t.business_id
    WHERE t.status = 'pending' ORDER BY t.created_at LIMIT 10`;
  if (!rows.length) {
    await tgSend(chatId, '💰 Tidak ada top-up yang menunggu konfirmasi. 🎉');
    return;
  }
  await tgSend(chatId, `💰 <b>${rows.length} top-up menunggu</b> — cocokkan nominal persis dengan mutasi rekening/QRIS:`);
  for (const t of rows) {
    const amt = Number(t.transfer_amount);
    await tgSend(chatId, `<b>${tgEsc(rupiah(amt))}</b> (kode unik ${tgEsc(t.unique_code)})\nToko: ${tgEsc(t.business_name ?? '—')} · diminta ${ago(Number(t.created_at))} lalu`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: `📋 Salin nominal ${amt}`, copy_text: { text: String(amt) } }],
          [
            { text: '✅ Dana masuk', callback_data: `tu:a:${t.id as string}` },
            { text: '❌ Tolak', callback_data: `tu:r:${t.id as string}` },
          ],
        ],
      },
    });
  }
}

export async function sendDeposit(chatId: number): Promise<void> {
  const d = await ppob.depositBalance();
  await tgSend(
    chatId,
    d.value == null
      ? `🏦 Deposit Digiflazz: ${tgEsc(d.error ?? 'tidak tersedia')}`
      : `🏦 Deposit Digiflazz: <b>${tgEsc(rupiah(d.value))}</b>${env.DIGIFLAZZ_TESTING ? '\n<i>Mode uji (development key) — saldo akun uji.</i>' : ''}`,
  );
}

/** Pasang webhook & daftar perintah bot (dipanggil dari CLI setelah deploy). */
export async function setupWebhook(secret: string): Promise<{ url: string }> {
  if (!env.PUBLIC_BASE_URL) throw new Error('PUBLIC_BASE_URL belum diisi');
  const url = `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/v1/webhooks/telegram`;
  await tg('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
  await tg('setMyCommands', {
    commands: [
      { command: 'ringkasan', description: 'Angka penting hari ini' },
      { command: 'token', description: 'Order token listrik yang menunggu' },
      { command: 'topup', description: 'Top-up Poin yang menunggu' },
      { command: 'saldo', description: 'Saldo deposit Digiflazz' },
      { command: 'login', description: 'Tautan dashboard' },
      { command: 'menu', description: 'Tombol menu' },
    ],
  });
  return { url };
}
