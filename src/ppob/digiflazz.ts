import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Adaptor Digiflazz (prabayar) — diverifikasi dari dokumentasi resmi 2026-11-02
 * (developer.digiflazz.com/api/buyer/). Rancangan §12.
 *
 * - Semua POST JSON ke https://api.digiflazz.com/v1/…, respons dibungkus `data`.
 * - sign = md5(username + apiKey + <suffix>) — suffix: "depo" | "pricelist" | ref_id | customer_no.
 * - WAJIB dari IP yang di-whitelist (VPS Kreatora). Selain itu RC 45.
 * - Transport bisa diganti (test) via {@link setDigiflazzTransport}.
 */

export const DIGIFLAZZ_BASE = 'https://api.digiflazz.com/v1';

export type DfStatus = 'Sukses' | 'Pending' | 'Gagal';

export interface DfTransaction {
  ref_id: string;
  customer_no?: string;
  buyer_sku_code?: string;
  message?: string;
  status: DfStatus;
  rc?: string;
  sn?: string;
  buyer_last_saldo?: number;
  price?: number;
}

export interface DfProduct {
  product_name: string;
  category: string;
  brand: string;
  type?: string;
  price: number | string;
  buyer_sku_code: string;
  buyer_product_status: boolean;
  seller_product_status: boolean;
  start_cut_off?: string;
  end_cut_off?: string;
  desc?: string;
}

/** Panggilan mentah: path + body → `data` (atau lempar DigiflazzError). */
export type DigiflazzTransport = (path: string, body: Record<string, unknown>) => Promise<unknown>;

export class DigiflazzError extends Error {
  constructor(
    message: string,
    /** true = belum pasti apakah transaksi diproses (timeout/jaringan/5xx) → perlakukan pending. */
    readonly uncertain: boolean,
    readonly rc?: string,
  ) {
    super(message);
    this.name = 'DigiflazzError';
  }
}

export function digiflazzConfigured(): boolean {
  return Boolean(env.DIGIFLAZZ_USERNAME && env.DIGIFLAZZ_API_KEY);
}

const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');

export function sign(suffix: string): string {
  return md5(`${env.DIGIFLAZZ_USERNAME ?? ''}${env.DIGIFLAZZ_API_KEY ?? ''}${suffix}`);
}

async function httpTransport(path: string, body: Record<string, unknown>): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${DIGIFLAZZ_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(path === '/transaction' ? 45_000 : 20_000),
    });
  } catch (e) {
    throw new DigiflazzError(`Gagal menghubungi Digiflazz: ${(e as Error).message}`, true);
  }
  const text = await res.text();
  let json: { data?: unknown } | null = null;
  try {
    json = JSON.parse(text) as { data?: unknown };
  } catch {
    throw new DigiflazzError(`Respons Digiflazz bukan JSON (HTTP ${res.status})`, res.status >= 500);
  }
  if (!json || json.data === undefined) {
    throw new DigiflazzError(`Respons Digiflazz tanpa data (HTTP ${res.status})`, res.status >= 500);
  }
  return json.data;
}

let transport: DigiflazzTransport = httpTransport;

export function setDigiflazzTransport(t: DigiflazzTransport): () => void {
  const prev = transport;
  transport = t;
  return () => {
    transport = prev;
  };
}

function requireConfig() {
  if (!digiflazzConfigured()) throw new DigiflazzError('Digiflazz belum dikonfigurasi (DIGIFLAZZ_USERNAME/API_KEY).', false);
}

/** Saldo deposit Sirko di Digiflazz. */
export async function cekSaldo(): Promise<number> {
  requireConfig();
  const data = (await transport('/cek-saldo', {
    cmd: 'deposit',
    username: env.DIGIFLAZZ_USERNAME,
    sign: sign('depo'),
  })) as { deposit?: number | string; rc?: string; message?: string };
  if (data.deposit === undefined) throw new DigiflazzError(data.message ?? 'Gagal cek saldo', false, data.rc);
  return Number(data.deposit);
}

/** Daftar harga prabayar (maks 1× per 5 menit — dijaga pemanggil). */
export async function priceList(): Promise<DfProduct[]> {
  requireConfig();
  const data = await transport('/price-list', {
    cmd: 'prepaid',
    username: env.DIGIFLAZZ_USERNAME,
    sign: sign('pricelist'),
  });
  if (!Array.isArray(data)) {
    const d = data as { rc?: string; message?: string };
    throw new DigiflazzError(d?.message ?? 'Daftar harga tidak valid', false, d?.rc);
  }
  return data as DfProduct[];
}

/**
 * Beli / cek status (ref_id sama = cek status; JANGAN untuk order > 90 hari).
 * Error jaringan/timeout → DigiflazzError(uncertain=true) → pemanggil memperlakukan pending.
 */
export async function transaction(input: {
  sku: string;
  customerNo: string;
  refId: string;
  maxPrice?: number;
}): Promise<DfTransaction> {
  requireConfig();
  const body: Record<string, unknown> = {
    username: env.DIGIFLAZZ_USERNAME,
    buyer_sku_code: input.sku,
    customer_no: input.customerNo,
    ref_id: input.refId,
    sign: sign(input.refId),
  };
  if (env.DIGIFLAZZ_TESTING) body.testing = true;
  if (input.maxPrice !== undefined) body.max_price = input.maxPrice;
  const data = (await transport('/transaction', body)) as Partial<DfTransaction>;
  if (!data || typeof data.status !== 'string') {
    throw new DigiflazzError('Respons transaksi Digiflazz tidak dikenal', true);
  }
  return { ...data, ref_id: data.ref_id ?? input.refId, status: data.status as DfStatus };
}

/** Cek nama pelanggan PLN prabayar dari nomor meter (dipakai tahap token manual). */
export async function inquiryPln(customerNo: string): Promise<{ ok: boolean; name?: string; segmentPower?: string; message?: string; rc?: string }> {
  requireConfig();
  const data = (await transport('/inquiry-pln', {
    username: env.DIGIFLAZZ_USERNAME,
    customer_no: customerNo,
    sign: sign(customerNo),
  })) as { status?: string; name?: string; segment_power?: string; message?: string; rc?: string };
  return { ok: data.status === 'Sukses', name: data.name, segmentPower: data.segment_power, message: data.message, rc: data.rc };
}

// ── Pemetaan status (rancangan §12) ──────────────────────────────────────────

export type MappedStatus = 'success' | 'failed' | 'pending';

/** RC yang berarti salah konfigurasi / deposit habis → alarm admin. */
export const ALARM_RC = new Set(['41', '42', '44', '45', '61', '82']);

export function mapStatus(t: Pick<DfTransaction, 'status' | 'rc'>): MappedStatus {
  // RC 03 & 99 = pending walau status apa pun; selebihnya ikut field status.
  if (t.rc === '03' || t.rc === '99') return 'pending';
  if (t.status === 'Sukses') return 'success';
  if (t.status === 'Gagal') return 'failed';
  return 'pending';
}

// ── Webhook ──────────────────────────────────────────────────────────────────

/** Verifikasi `X-Hub-Signature: sha1=<hex>` = HMAC-SHA1(body mentah, secret). Constant-time. */
export function verifyWebhookSignature(rawBody: string, header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header || !header.startsWith('sha1=')) return false;
  const expected = createHmac('sha1', secret).update(rawBody, 'utf8').digest('hex');
  const got = header.slice('sha1='.length).trim();
  if (got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got, 'utf8'), Buffer.from(expected, 'utf8'));
}

// ── Deteksi operator dari nomor HP ───────────────────────────────────────────

/** Normalisasi nomor HP ke format 08xxxxxxxxx; null bila tak valid. */
export function normalizePhone(raw: string): string | null {
  let s = raw.replace(/[\s\-().]/g, '');
  if (s.startsWith('+62')) s = '0' + s.slice(3);
  else if (s.startsWith('62')) s = '0' + s.slice(2);
  return /^08\d{8,11}$/.test(s) ? s : null;
}

const PREFIXES: Array<[string, string[]]> = [
  ['TELKOMSEL', ['0811', '0812', '0813', '0821', '0822', '0823', '0852', '0853']],
  ['BY.U', ['0851']],
  ['INDOSAT', ['0814', '0815', '0816', '0855', '0856', '0857', '0858']],
  ['XL', ['0817', '0818', '0819', '0859', '0877', '0878']],
  ['AXIS', ['0831', '0832', '0833', '0838']],
  ['TRI', ['0895', '0896', '0897', '0898', '0899']],
  ['SMARTFREN', ['0881', '0882', '0883', '0884', '0885', '0886', '0887', '0888', '0889']],
];

/** Operator (nama brand gaya Digiflazz, huruf besar) dari prefix nomor, atau null. */
export function detectOperator(phone: string): string | null {
  const p = normalizePhone(phone);
  if (!p) return null;
  const pre = p.slice(0, 4);
  for (const [brand, list] of PREFIXES) if (list.includes(pre)) return brand;
  return null;
}

/** Brand Digiflazz → kunci operator kita (mis. "by.U" → "BY.U", "Tri" → "TRI"). */
export function brandKey(brand: string): string {
  const b = brand.trim().toUpperCase();
  if (b === 'THREE' || b === '3') return 'TRI';
  if (b === 'BYU' || b === 'BY U') return 'BY.U';
  return b;
}
