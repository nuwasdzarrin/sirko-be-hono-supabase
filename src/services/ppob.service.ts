import { z } from 'zod';
import { sql, type DbClient } from '../db/client.js';
import { env } from '../config/env.js';
import { uuid } from '../lib/uuid.js';
import { nowMs } from '../lib/time.js';
import { AppError, notFound, validation } from '../lib/errors.js';
import { notifyAdmin, tgEsc } from '../lib/notify.js';
import * as df from '../ppob/digiflazz.js';
import { applyLedger, ownerAccountId } from './points.service.js';

/**
 * PPOB — pulsa & paket data via Digiflazz (tahap 2). Server = sumber kebenaran.
 *
 * Alur order (rancangan §7):
 *  1. SATU transaksi DB: order `processing` + potong Poin (ledger `purchase`).
 *     Saldo kurang → rollback, tak ada order. `clientRef` sama → order lama.
 *  2. Setelah commit, kirim ke Digiflazz (ref_id = order.id).
 *  3. Semua hasil (balasan langsung, webhook, cek ulang) lewat {@link applyResult}
 *     yang mengunci baris order: order final tak berubah lagi, refund maks 1×.
 *  Timeout/jaringan ≠ gagal → `pending` (Digiflazz mungkin sudah memproses).
 */

type Row = Record<string, unknown>;
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rupiah = (v: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(v);

const STATUS_CHECK_MIN_GAP_MS = 60_000; // Digiflazz: jangan cek status trx sama > 1×/menit
const STATUS_CHECK_MAX_AGE_MS = 85 * 86_400_000; // > 90 hari → Digiflazz membuat trx BARU
const PRICELIST_MIN_GAP_MS = 5 * 60_000; // Digiflazz: price-list maks 1× per 5 menit

// ── Konfigurasi (app_config.ppob) ────────────────────────────────────────────

export interface PpobConfig {
  markupPulsa: number;
  markupData: number;
  markupPln: number;
  /** Harga jual dibulatkan ke atas ke kelipatan ini. */
  roundTo: number;
  /** Kirim alarm Telegram bila deposit Digiflazz di bawah nilai ini. */
  lowDepositAlert: number;
}

export const DEFAULT_PPOB_CONFIG: PpobConfig = {
  markupPulsa: 500,
  markupData: 500,
  markupPln: 1_500,
  roundTo: 100,
  lowDepositAlert: 500_000,
};

export async function getConfig(db: DbClient = sql): Promise<PpobConfig> {
  const r = await db<{ value: Partial<PpobConfig> }[]>`SELECT value FROM app_config WHERE key = 'ppob'`;
  return { ...DEFAULT_PPOB_CONFIG, ...(r[0]?.value ?? {}) };
}

export const configSchema = z.object({
  markupPulsa: z.coerce.number().int().min(0).max(100_000),
  markupData: z.coerce.number().int().min(0).max(100_000),
  markupPln: z.coerce.number().int().min(0).max(100_000),
  roundTo: z.coerce.number().int().min(1).max(10_000),
  lowDepositAlert: z.coerce.number().int().min(0).max(1_000_000_000),
});

/** Simpan konfigurasi & hitung ulang harga jual produk yang tak dikunci. */
export async function saveConfig(input: unknown, admin: string): Promise<PpobConfig> {
  const cfg = configSchema.parse(input);
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO app_config (key, value, updated_by, updated_at) VALUES ('ppob', ${tx.json(cfg)}, ${admin}, ${nowMs()})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`;
    await repriceUnlocked(tx, cfg);
  });
  return cfg;
}

export function sellPriceFor(cost: number, category: string, cfg: PpobConfig): number {
  const markup = category === 'pulsa' ? cfg.markupPulsa : category === 'data' ? cfg.markupData : cfg.markupPln;
  const raw = cost + markup;
  return Math.ceil(raw / cfg.roundTo) * cfg.roundTo;
}

async function repriceUnlocked(db: DbClient, cfg: PpobConfig) {
  const ts = nowMs();
  for (const cat of ['pulsa', 'data', 'pln'] as const) {
    const markup = cat === 'pulsa' ? cfg.markupPulsa : cat === 'data' ? cfg.markupData : cfg.markupPln;
    await db`
      UPDATE ppob_products SET sell_price = ceil((cost_price + ${markup})::numeric / ${cfg.roundTo}) * ${cfg.roundTo},
        updated_at = ${ts}
      WHERE category = ${cat} AND NOT price_locked`;
  }
}

export function ppobEnabled(): boolean {
  return Boolean(env.PPOB_ENABLED);
}

// ── Sinkron harga Digiflazz ──────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, 'pulsa' | 'data'> = { pulsa: 'pulsa', data: 'data' };

export interface SyncResult {
  received: number;
  upserted: number;
  deactivated: number;
}

/** Tarik price-list prabayar → simpan produk pulsa & data. Maks 1× per 5 menit. */
export async function syncDigiflazzProducts(admin: string): Promise<SyncResult> {
  const ts = nowMs();
  const last = await sql<{ value: { at?: number } }[]>`SELECT value FROM app_config WHERE key = 'ppob_sync'`;
  const lastAt = last[0]?.value?.at ?? 0;
  if (ts - lastAt < PRICELIST_MIN_GAP_MS) {
    const wait = Math.ceil((PRICELIST_MIN_GAP_MS - (ts - lastAt)) / 60_000);
    throw new AppError('RATE_LIMITED', `Sinkron harga maksimal 1× per 5 menit (aturan Digiflazz). Coba lagi ±${wait} menit.`);
  }
  await sql`
    INSERT INTO app_config (key, value, updated_by, updated_at) VALUES ('ppob_sync', ${sql.json({ at: ts })}, ${admin}, ${ts})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`;

  const list = await df.priceList();
  const cfg = await getConfig();
  const rows = list
    .map((p) => ({ p, cat: CATEGORY_MAP[String(p.category ?? '').trim().toLowerCase()] }))
    .filter((x): x is { p: df.DfProduct; cat: 'pulsa' | 'data' } => Boolean(x.cat && x.p.buyer_sku_code))
    .map(({ p, cat }) => {
      const cost = Math.round(Number(p.price));
      return {
        id: uuid(),
        provider: 'digiflazz',
        sku: String(p.buyer_sku_code),
        category: cat,
        brand: df.brandKey(String(p.brand ?? '')),
        name: String(p.product_name ?? p.buyer_sku_code),
        description: p.desc ? String(p.desc) : null,
        cost_price: Number.isFinite(cost) ? cost : 0,
        sell_price: sellPriceFor(Number.isFinite(cost) ? cost : 0, cat, cfg),
        provider_active: Boolean(p.buyer_product_status && p.seller_product_status),
        cutoff_start: p.start_cut_off || null,
        cutoff_end: p.end_cut_off || null,
        synced_at: ts,
        created_at: ts,
        updated_at: ts,
      };
    });

  let upserted = 0;
  await sql.begin(async (tx) => {
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const r = await tx`
        INSERT INTO ppob_products ${tx(chunk)}
        ON CONFLICT (provider, sku) DO UPDATE SET
          category = EXCLUDED.category, brand = EXCLUDED.brand, name = EXCLUDED.name,
          description = EXCLUDED.description, cost_price = EXCLUDED.cost_price,
          sell_price = CASE WHEN ppob_products.price_locked THEN ppob_products.sell_price ELSE EXCLUDED.sell_price END,
          provider_active = EXCLUDED.provider_active, cutoff_start = EXCLUDED.cutoff_start,
          cutoff_end = EXCLUDED.cutoff_end, synced_at = EXCLUDED.synced_at, updated_at = EXCLUDED.updated_at
        RETURNING id`;
      upserted += r.length;
    }
  });
  const gone = await sql`
    UPDATE ppob_products SET provider_active = false, updated_at = ${ts}
    WHERE provider = 'digiflazz' AND (synced_at IS NULL OR synced_at < ${ts}) AND provider_active
    RETURNING id`;
  return { received: list.length, upserted, deactivated: gone.length };
}

// ── Katalog untuk app ────────────────────────────────────────────────────────

export interface ProductView {
  id: string;
  category: string;
  brand: string;
  name: string;
  description: string | null;
  price: number; // harga Poin
  available: boolean;
  unavailableReason: string | null;
}

/** "hh:mm" WIB sekarang dalam rentang cut-off (boleh melewati tengah malam)? */
export function inCutoff(start: string | null, end: string | null, now = nowMs()): boolean {
  if (!start || !end || start === end) return false;
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  return start < end ? hm >= start && hm < end : hm >= start || hm < end;
}

function productView(r: Row): ProductView {
  const cut = inCutoff((r.cutoff_start as string) ?? null, (r.cutoff_end as string) ?? null);
  return {
    id: r.id as string,
    category: r.category as string,
    brand: r.brand as string,
    name: r.name as string,
    description: (r.description as string) ?? null,
    price: n(r.sell_price),
    available: !cut,
    unavailableReason: cut ? `Sedang cut-off ${r.cutoff_start}–${r.cutoff_end} WIB` : null,
  };
}

export async function listProducts(opts: { category: string; customerNo?: string }) {
  if (!['pulsa', 'data'].includes(opts.category)) throw validation('Kategori harus pulsa atau data');
  let operator: string | null = null;
  if (opts.customerNo) {
    if (!df.normalizePhone(opts.customerNo)) throw new AppError('VALIDATION', 'Nomor HP tidak valid.');
    operator = df.detectOperator(opts.customerNo);
    if (!operator) throw new AppError('VALIDATION', 'Operator nomor ini belum dikenali.');
  }
  const rows = await sql<Row[]>`
    SELECT * FROM ppob_products
    WHERE category = ${opts.category} AND active AND provider_active
      ${operator ? sql`AND brand = ${operator}` : sql``}
    ORDER BY brand, sell_price, name`;
  return { operator, items: rows.map(productView) };
}

// ── Order ────────────────────────────────────────────────────────────────────

export type OrderStatus = 'processing' | 'pending' | 'waiting_admin' | 'success' | 'failed';

export interface OrderView {
  id: string;
  clientRef: string;
  businessId: string;
  businessName?: string | null;
  category: string;
  brand: string | null;
  productName: string;
  sku: string;
  customerNo: string;
  price: number;
  status: OrderStatus;
  refunded: boolean;
  sn: string | null;
  message: string | null;
  createdAt: number;
  completedAt: number | null;
}

function orderView(r: Row): OrderView {
  return {
    id: r.id as string,
    clientRef: r.client_ref as string,
    businessId: r.business_id as string,
    businessName: (r.business_name as string) ?? null,
    category: r.category as string,
    brand: (r.brand as string) ?? null,
    productName: r.product_name as string,
    sku: r.sku as string,
    customerNo: r.customer_no as string,
    price: n(r.price),
    status: r.status as OrderStatus,
    refunded: Boolean(r.refunded),
    sn: (r.sn as string) ?? null,
    message: friendlyMessage(r),
    createdAt: n(r.created_at),
    completedAt: r.completed_at == null ? null : n(r.completed_at),
  };
}

/** Pesan ramah untuk app (tanpa membocorkan detail internal penyedia). */
function friendlyMessage(r: Row): string | null {
  switch (r.status) {
    case 'success':
      return 'Transaksi berhasil.';
    case 'failed':
      return `Transaksi gagal${r.provider_message ? `: ${String(r.provider_message)}` : ''}. Poin sudah dikembalikan.`;
    case 'pending':
    case 'processing':
      return 'Sedang diproses penyedia. Status akan diperbarui otomatis.';
    case 'waiting_admin':
      return 'Menunggu diproses admin Sirko.';
    default:
      return null;
  }
}

async function addEvent(db: DbClient, orderId: string, event: string, detail?: unknown) {
  await db`INSERT INTO ppob_order_events (id, order_id, event, detail, created_at)
           VALUES (${uuid()}, ${orderId}, ${event}, ${detail === undefined ? null : db.json(detail as never)}, ${nowMs()})`;
}

export const orderCreateSchema = z.object({
  clientRef: z.string().trim().min(8).max(64),
  productId: z.string().uuid(),
  customerNo: z.string().trim().min(6).max(30),
});
export type OrderCreateInput = z.infer<typeof orderCreateSchema>;

async function getOrderRow(id: string): Promise<Row | null> {
  if (!UUID_RE.test(id)) return null;
  const r = await sql<Row[]>`
    SELECT o.*, b.name AS business_name FROM ppob_orders o LEFT JOIN businesses b ON b.id = o.business_id
    WHERE o.id = ${id}`;
  return r[0] ?? null;
}

/** Beli pulsa/data. Idempoten per (toko, clientRef). */
export async function createOrder(
  auth: { businessId: string; userId: string },
  input: OrderCreateInput,
): Promise<OrderView> {
  if (!ppobEnabled()) throw new AppError('PPOB_UNAVAILABLE', 'Layanan PPOB belum aktif.');

  const existing = await sql<Row[]>`
    SELECT id FROM ppob_orders WHERE business_id = ${auth.businessId} AND client_ref = ${input.clientRef}`;
  if (existing[0]) return orderView((await getOrderRow(existing[0].id as string))!);

  const accountId = await ownerAccountId(auth.businessId);
  if (!accountId) throw new AppError('OWNER_ACCOUNT_MISSING', 'Toko ini belum punya akun pemilik (login cloud) — Poin Sirko tidak tersedia.');

  const pr = await sql<Row[]>`SELECT * FROM ppob_products WHERE id = ${input.productId}`;
  const p = pr[0];
  if (!p || !p.active || !p.provider_active) throw new AppError('PRODUCT_UNAVAILABLE', 'Produk tidak tersedia.');
  if (p.provider !== 'digiflazz' || !['pulsa', 'data'].includes(p.category as string)) {
    throw new AppError('PRODUCT_UNAVAILABLE', 'Produk ini belum bisa dibeli lewat jalur otomatis.');
  }
  if (!df.digiflazzConfigured()) throw new AppError('PPOB_UNAVAILABLE', 'Layanan PPOB belum dikonfigurasi.');
  if (inCutoff((p.cutoff_start as string) ?? null, (p.cutoff_end as string) ?? null)) {
    throw new AppError('PRODUCT_UNAVAILABLE', `Produk sedang cut-off ${p.cutoff_start}–${p.cutoff_end} WIB.`);
  }
  const phone = df.normalizePhone(input.customerNo);
  if (!phone) throw validation('Nomor HP tidak valid.');
  const op = df.detectOperator(phone);
  if (op !== p.brand) throw validation(`Nomor ${phone} bukan nomor ${String(p.brand)}${op ? ` (terdeteksi ${op})` : ''}.`);

  const id = uuid();
  const ts = nowMs();
  try {
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO ppob_orders ${tx({
          id,
          business_id: auth.businessId,
          account_id: accountId,
          user_ref: auth.userId,
          client_ref: input.clientRef,
          product_id: p.id as string,
          provider: 'digiflazz',
          sku: p.sku as string,
          product_name: p.name as string,
          category: p.category as string,
          brand: p.brand as string,
          customer_no: phone,
          price: n(p.sell_price),
          cost: n(p.cost_price),
          status: 'processing',
          created_at: ts,
          updated_at: ts,
        })}`;
      await applyLedger(tx, {
        accountId,
        businessId: auth.businessId,
        type: 'purchase',
        amount: -n(p.sell_price),
        refType: 'ppob_order',
        refId: id,
        note: `${p.name as string} → ${phone}`,
        createdBy: `app:${auth.userId}`,
      });
      await addEvent(tx, id, 'created', { price: n(p.sell_price), cost: n(p.cost_price) });
    });
  } catch (e) {
    // Balapan clientRef yang sama → kembalikan order yang menang.
    if ((e as { code?: string; constraint_name?: string }).constraint_name === 'uq_ppob_orders_client') {
      const r = await sql<Row[]>`SELECT id FROM ppob_orders WHERE business_id = ${auth.businessId} AND client_ref = ${input.clientRef}`;
      if (r[0]) return orderView((await getOrderRow(r[0].id as string))!);
    }
    throw e;
  }

  await submitToProvider(id);
  return orderView((await getOrderRow(id))!);
}

/** Kirim order ke Digiflazz & terapkan hasilnya. Aman dipanggil ulang (ref_id sama). */
async function submitToProvider(orderId: string, source = 'submit'): Promise<void> {
  const o = await getOrderRow(orderId);
  if (!o) return;
  const maxPrice = n(o.cost) + Math.max(100, Math.ceil(n(o.cost) * 0.02)); // toleransi naik modal kecil
  try {
    const res = await df.transaction({ sku: o.sku as string, customerNo: o.customer_no as string, refId: orderId, maxPrice });
    await applyResult(orderId, res, source);
  } catch (e) {
    const err = e as df.DigiflazzError;
    if (err instanceof df.DigiflazzError && !err.uncertain) {
      // Pasti tidak diproses (mis. belum dikonfigurasi) → gagal + refund.
      await applyResult(orderId, { ref_id: orderId, status: 'Gagal', rc: err.rc, message: err.message }, `${source}_error`);
    } else {
      await sql.begin(async (tx) => {
        await tx`UPDATE ppob_orders SET status = 'pending', provider_message = ${String(err.message).slice(0, 300)}, updated_at = ${nowMs()}
                 WHERE id = ${orderId} AND status = 'processing'`;
        await addEvent(tx, orderId, `${source}_uncertain`, { error: String(err.message).slice(0, 300) });
      });
    }
  }
}

/**
 * Terapkan hasil Digiflazz ke order (dari balasan langsung, webhook, atau cek ulang).
 * Mengunci baris order; order yang sudah final diabaikan; refund lewat ledger (maks 1×).
 */
export async function applyResult(orderId: string, res: Partial<df.DfTransaction> & { status: df.DfStatus }, source: string): Promise<OrderStatus | null> {
  const mapped = df.mapStatus(res);
  let alarm: string | null = null;
  const final = await sql.begin(async (tx) => {
    const rows = await tx<Row[]>`SELECT * FROM ppob_orders WHERE id = ${orderId} FOR UPDATE`;
    const o = rows[0];
    if (!o) return null;
    const detail = { status: res.status, rc: res.rc ?? null, sn: res.sn ?? null, message: res.message ?? null, price: res.price ?? null, saldo: res.buyer_last_saldo ?? null };
    if (o.status === 'success' || o.status === 'failed') {
      await addEvent(tx, orderId, `${source}_ignored_final`, detail);
      return o.status as OrderStatus;
    }
    const ts = nowMs();
    const common = {
      provider_rc: res.rc ?? null,
      provider_message: res.message ? String(res.message).slice(0, 300) : null,
      updated_at: ts,
    };
    if (mapped === 'success') {
      await tx`UPDATE ppob_orders SET ${tx({ ...common, status: 'success', sn: res.sn ?? null, provider_price: res.price ?? null, completed_at: ts })}
               WHERE id = ${orderId}`;
    } else if (mapped === 'failed') {
      await tx`UPDATE ppob_orders SET ${tx({ ...common, status: 'failed', refunded: true, completed_at: ts })} WHERE id = ${orderId}`;
      await applyLedger(tx, {
        accountId: o.account_id as string,
        businessId: o.business_id as string,
        type: 'refund',
        amount: n(o.price),
        refType: 'ppob_order',
        refId: orderId,
        note: `Refund ${o.product_name as string} → ${o.customer_no as string}`,
        createdBy: 'system',
      });
      if (res.rc && df.ALARM_RC.has(res.rc)) alarm = `RC ${res.rc}: ${res.message ?? ''}`;
    } else {
      await tx`UPDATE ppob_orders SET ${tx({ ...common, status: 'pending' })} WHERE id = ${orderId}`;
    }
    await addEvent(tx, orderId, `${source}_${mapped}`, detail);
    return mapped === 'success' ? 'success' : mapped === 'failed' ? 'failed' : 'pending';
  });

  if (alarm) {
    void notifyAdmin({
      text: `🚨 <b>PPOB gagal karena masalah akun/deposit Digiflazz</b>\n${tgEsc(alarm)}\nOrder <code>${orderId}</code> sudah di-refund otomatis.`,
      linkPath: `/dashboard/ppob/orders/${orderId}`,
      linkLabel: 'Lihat order',
    });
  }
  if (typeof res.buyer_last_saldo === 'number') void checkLowDeposit(res.buyer_last_saldo);
  return final;
}

let lastDepositAlertAt = 0;
async function checkLowDeposit(saldo: number) {
  const cfg = await getConfig();
  if (saldo >= cfg.lowDepositAlert || nowMs() - lastDepositAlertAt < 3_600_000) return;
  lastDepositAlertAt = nowMs();
  await notifyAdmin({
    text: `⚠️ <b>Deposit Digiflazz menipis</b>: ${tgEsc(rupiah(saldo))} (ambang ${tgEsc(rupiah(cfg.lowDepositAlert))}). Segera isi deposit agar pembelian tidak gagal.`,
    linkPath: '/dashboard/ppob?tab=products',
    linkLabel: 'Buka PPOB',
  });
}

/**
 * Cek ulang status ke Digiflazz (kirim ulang ref_id sama). Mematuhi aturan:
 * maks 1×/menit per order (dijaga atomik lewat last_checked_at) & tidak untuk
 * order > 85 hari. Order `processing` yang belum sempat terkirim ikut terkirim
 * (ref_id sama → Digiflazz memproses sekali).
 */
export async function checkStatus(orderId: string, opts: { source?: string } = {}): Promise<{ checked: boolean; reason?: string }> {
  const o = await getOrderRow(orderId);
  if (!o) return { checked: false, reason: 'Order tidak ditemukan' };
  if (o.provider !== 'digiflazz') return { checked: false, reason: 'Bukan order otomatis' };
  if (!['pending', 'processing'].includes(o.status as string)) return { checked: false, reason: 'Order sudah final' };
  if (nowMs() - n(o.created_at) > STATUS_CHECK_MAX_AGE_MS) {
    return { checked: false, reason: 'Order > 85 hari — cek manual di dashboard Digiflazz (cek ulang otomatis bisa membuat transaksi baru).' };
  }
  const ts = nowMs();
  const claimed = await sql`
    UPDATE ppob_orders SET last_checked_at = ${ts}
    WHERE id = ${orderId} AND status IN ('pending', 'processing')
      AND (last_checked_at IS NULL OR last_checked_at <= ${ts - STATUS_CHECK_MIN_GAP_MS})
    RETURNING id`;
  if (!claimed.length) return { checked: false, reason: 'Baru saja dicek (maks 1× per menit)' };
  await submitToProvider(orderId, opts.source ?? 'check');
  return { checked: true };
}

// ── Webhook Digiflazz ────────────────────────────────────────────────────────

export async function handleWebhook(rawBody: string, headers: { signature?: string; event?: string }): Promise<{ status: number; body: string }> {
  if (!df.verifyWebhookSignature(rawBody, headers.signature, env.DIGIFLAZZ_WEBHOOK_SECRET)) {
    return { status: 401, body: 'invalid signature' };
  }
  let payload: { data?: Partial<df.DfTransaction> & { ref_id?: string } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: 'invalid json' };
  }
  if (headers.event === 'ping' || !payload.data?.ref_id) return { status: 200, body: 'ok' };
  const d = payload.data;
  if (!UUID_RE.test(String(d.ref_id)) || typeof d.status !== 'string') return { status: 200, body: 'ignored' };
  await applyResult(String(d.ref_id), { ...d, status: d.status as df.DfStatus }, 'webhook');
  return { status: 200, body: 'ok' };
}

// ── Baca order (app) ─────────────────────────────────────────────────────────

/** Detail order milik toko; bila masih pending > 1 menit → cek ulang dulu (lazy). */
export async function getOrderForBusiness(businessId: string, id: string): Promise<OrderView> {
  const o = await getOrderRow(id);
  if (!o || o.business_id !== businessId) throw notFound('Order tidak ditemukan');
  if ((o.status === 'pending' || o.status === 'processing') && nowMs() - n(o.created_at) > STATUS_CHECK_MIN_GAP_MS) {
    await checkStatus(id, { source: 'lazy_check' }).catch(() => undefined);
    return orderView((await getOrderRow(id))!);
  }
  return orderView(o);
}

export async function listOrdersForBusiness(businessId: string, opts: { cursor?: string; limit?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  let cur: { ts: number; id: string } | null = null;
  if (opts.cursor) {
    const [ts, id] = Buffer.from(opts.cursor, 'base64url').toString('utf8').split('|');
    if (!ts || !id || !UUID_RE.test(id)) throw validation('Cursor tidak valid');
    cur = { ts: Number(ts), id };
  }
  const rows = await sql<Row[]>`
    SELECT * FROM ppob_orders WHERE business_id = ${businessId}
      ${cur ? sql`AND (created_at, id) < (${cur.ts}, ${cur.id})` : sql``}
    ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`;
  const items = rows.slice(0, limit).map(orderView);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: rows.length > limit && last ? Buffer.from(`${last.createdAt}|${last.id}`, 'utf8').toString('base64url') : null,
  };
}

// ── Tugas berkala (proses VPS) ───────────────────────────────────────────────

/** Selesaikan order pending/processing (≥ 1 menit, < 85 hari) lewat cek ulang. */
export async function reconcilePending(limit = 20): Promise<number> {
  const ts = nowMs();
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM ppob_orders
    WHERE status IN ('pending', 'processing') AND provider = 'digiflazz'
      AND created_at <= ${ts - STATUS_CHECK_MIN_GAP_MS} AND created_at >= ${ts - STATUS_CHECK_MAX_AGE_MS}
      AND (last_checked_at IS NULL OR last_checked_at <= ${ts - 2 * STATUS_CHECK_MIN_GAP_MS})
    ORDER BY created_at LIMIT ${limit}`;
  let done = 0;
  for (const r of rows) {
    const x = await checkStatus(r.id, { source: 'job' }).catch((e) => {
      console.error('[ppob-job] cek status gagal', r.id, (e as Error).message);
      return { checked: false };
    });
    if (x.checked) done++;
  }
  return done;
}

let jobTimer: NodeJS.Timeout | null = null;

/** Mulai tugas berkala (dipanggil src/server.ts di VPS; tak jalan di test/serverless). */
export function startPpobJobs(intervalMs = 120_000): void {
  if (jobTimer || env.PPOB_JOBS === '0') return;
  jobTimer = setInterval(() => {
    if (!ppobEnabled() || !df.digiflazzConfigured()) return;
    reconcilePending().catch((e) => console.error('[ppob-job]', (e as Error).message));
  }, intervalMs);
  jobTimer.unref();
}

// ── Admin ────────────────────────────────────────────────────────────────────

export async function adminListOrders(opts: { status: string; category?: string; page: number; limit: number; q?: string }) {
  const conds = [sql`true`];
  if (opts.status !== 'semua') conds.push(sql`o.status = ${opts.status}`);
  if (opts.category) conds.push(sql`o.category = ${opts.category}`);
  if (opts.q) {
    const like = `%${opts.q}%`;
    conds.push(sql`(o.customer_no ILIKE ${like} OR b.name ILIKE ${like} OR o.product_name ILIKE ${like} OR o.id::text = ${opts.q})`);
  }
  const where = conds.reduce((a, c) => sql`${a} AND ${c}`);
  const from = () => sql`FROM ppob_orders o LEFT JOIN businesses b ON b.id = o.business_id WHERE ${where}`;
  const [totalRows, countRows, sums] = await Promise.all([
    sql<{ c: number }[]>`SELECT count(*)::int c ${from()}`,
    sql<{ status: string; c: number }[]>`SELECT status, count(*)::int c FROM ppob_orders GROUP BY status`,
    sql<{ omzet: string; laba: string }[]>`
      SELECT coalesce(sum(price),0) omzet, coalesce(sum(price - coalesce(provider_price, cost)),0) laba
      FROM ppob_orders WHERE status = 'success'`,
  ]);
  const total = totalRows[0]?.c ?? 0;
  const pages = Math.max(1, Math.ceil(total / opts.limit));
  const page = Math.min(Math.max(1, opts.page), pages);
  const rows = await sql<Row[]>`
    SELECT o.*, b.name AS business_name ${from()}
    ORDER BY o.created_at DESC LIMIT ${opts.limit} OFFSET ${(page - 1) * opts.limit}`;
  const counts: Record<string, number> = { processing: 0, pending: 0, waiting_admin: 0, success: 0, failed: 0 };
  for (const r of countRows) counts[r.status] = r.c;
  counts.semua = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    items: rows.map((r) => ({ ...orderView(r), cost: n(r.cost), providerPrice: r.provider_price == null ? null : n(r.provider_price), rc: (r.provider_rc as string) ?? null, rawMessage: (r.provider_message as string) ?? null })),
    total,
    page,
    pages,
    counts,
    totals: { omzet: n(sums[0]?.omzet), laba: n(sums[0]?.laba) },
  };
}

export async function adminOrderDetail(id: string) {
  const o = await getOrderRow(id);
  if (!o) return null;
  const events = await sql<Row[]>`SELECT * FROM ppob_order_events WHERE order_id = ${id} ORDER BY created_at, id`;
  const ledger = await sql<Row[]>`
    SELECT type, amount, balance_after, created_at FROM point_ledger WHERE ref_type = 'ppob_order' AND ref_id = ${id}
    ORDER BY created_at`;
  return {
    order: { ...orderView(o), cost: n(o.cost), providerPrice: o.provider_price == null ? null : n(o.provider_price), rc: (o.provider_rc as string) ?? null, rawMessage: (o.provider_message as string) ?? null, accountId: o.account_id as string, lastCheckedAt: o.last_checked_at == null ? null : n(o.last_checked_at) },
    events: events.map((e) => ({ event: e.event as string, detail: e.detail ?? null, createdAt: n(e.created_at) })),
    ledger: ledger.map((l) => ({ type: l.type as string, amount: n(l.amount), balanceAfter: n(l.balance_after), createdAt: n(l.created_at) })),
  };
}

export async function adminListProducts(opts: { category?: string; brand?: string; q?: string; page: number; limit: number }) {
  const conds = [sql`provider = 'digiflazz'`];
  if (opts.category) conds.push(sql`category = ${opts.category}`);
  if (opts.brand) conds.push(sql`brand = ${opts.brand}`);
  if (opts.q) conds.push(sql`(name ILIKE ${'%' + opts.q + '%'} OR sku ILIKE ${'%' + opts.q + '%'})`);
  const where = conds.reduce((a, c) => sql`${a} AND ${c}`);
  const [totalRows, brands, lastSync] = await Promise.all([
    sql<{ c: number }[]>`SELECT count(*)::int c FROM ppob_products WHERE ${where}`,
    sql<{ brand: string; c: number }[]>`SELECT brand, count(*)::int c FROM ppob_products WHERE provider = 'digiflazz' GROUP BY brand ORDER BY brand`,
    sql<{ value: { at?: number } }[]>`SELECT value FROM app_config WHERE key = 'ppob_sync'`,
  ]);
  const total = totalRows[0]?.c ?? 0;
  const pages = Math.max(1, Math.ceil(total / opts.limit));
  const page = Math.min(Math.max(1, opts.page), pages);
  const rows = await sql<Row[]>`
    SELECT * FROM ppob_products WHERE ${where}
    ORDER BY category, brand, cost_price, name LIMIT ${opts.limit} OFFSET ${(page - 1) * opts.limit}`;
  return {
    items: rows.map((r) => ({
      id: r.id as string,
      sku: r.sku as string,
      category: r.category as string,
      brand: r.brand as string,
      name: r.name as string,
      cost: n(r.cost_price),
      price: n(r.sell_price),
      locked: Boolean(r.price_locked),
      active: Boolean(r.active),
      providerActive: Boolean(r.provider_active),
      cutoff: r.cutoff_start && r.cutoff_end ? `${r.cutoff_start}–${r.cutoff_end}` : null,
    })),
    total,
    page,
    pages,
    brands,
    lastSyncAt: lastSync[0]?.value?.at ?? null,
  };
}

/** Admin: ubah harga jual (kunci override), aktif/nonaktif, atau buka kunci harga. */
export async function adminUpdateProduct(id: string, patch: { price?: number | null; active?: boolean; unlock?: boolean }): Promise<void> {
  if (!UUID_RE.test(id)) throw notFound('Produk tidak ditemukan');
  const cfg = await getConfig();
  const ts = nowMs();
  await sql.begin(async (tx) => {
    const r = await tx<Row[]>`SELECT * FROM ppob_products WHERE id = ${id} FOR UPDATE`;
    const p = r[0];
    if (!p) throw notFound('Produk tidak ditemukan');
    if (patch.active !== undefined) await tx`UPDATE ppob_products SET active = ${patch.active}, updated_at = ${ts} WHERE id = ${id}`;
    if (patch.unlock) {
      await tx`UPDATE ppob_products SET price_locked = false, sell_price = ${sellPriceFor(n(p.cost_price), p.category as string, cfg)}, updated_at = ${ts} WHERE id = ${id}`;
    } else if (patch.price !== undefined && patch.price !== null) {
      if (!Number.isSafeInteger(patch.price) || patch.price <= 0) throw validation('Harga jual harus bilangan bulat > 0');
      if (patch.price < n(p.cost_price)) throw validation(`Harga jual di bawah modal (${n(p.cost_price)}).`);
      await tx`UPDATE ppob_products SET sell_price = ${patch.price}, price_locked = true, updated_at = ${ts} WHERE id = ${id}`;
    }
  });
}

let depositCache: { at: number; value: number | null; error: string | null } | null = null;

/** Saldo deposit Digiflazz untuk dashboard (cache 60 dtk). */
export async function depositBalance(): Promise<{ value: number | null; error: string | null }> {
  if (!df.digiflazzConfigured()) return { value: null, error: 'Digiflazz belum dikonfigurasi' };
  if (depositCache && nowMs() - depositCache.at < 60_000) return depositCache;
  try {
    depositCache = { at: nowMs(), value: await df.cekSaldo(), error: null };
  } catch (e) {
    depositCache = { at: nowMs(), value: null, error: (e as Error).message };
  }
  return depositCache;
}

export async function countNeedsAttention(): Promise<number> {
  const r = await sql<{ c: number }[]>`
    SELECT count(*)::int c FROM ppob_orders
    WHERE status = 'waiting_admin' OR (status IN ('pending', 'processing') AND created_at < ${nowMs() - 30 * 60_000})`;
  return r[0]?.c ?? 0;
}
