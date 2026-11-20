import { ApiError, NetworkError } from '../lib/api';
import { authed } from '../session/auth';

/**
 * PPOB & Poin Sirko — klien API yang sama dengan aplikasi HP (lib/features/ppob/data/ppob_remote.dart,
 * ppob_models.dart, pos/application/ppob_checkout.dart). PPOB selalu butuh internet.
 */

export type PpobCategory = 'pulsa' | 'data' | 'pln';
export const CATEGORY_LABEL: Record<PpobCategory, string> = { pulsa: 'Pulsa', data: 'Paket Data', pln: 'Token Listrik' };
const n = (v: unknown) => Number(v ?? 0) || 0;
const READ_MS = 8_000;
export const ORDER_TIMEOUT_MS = 15_000;

export interface PpobStatus {
  enabled: boolean;
  categories: Array<{ key: PpobCategory; available: boolean; reason: string | null }>;
  points: { available: boolean; balance: number; reason: string | null; canTopup: boolean; minTopup: number; maxTopup: number };
}

export async function ppobStatus(): Promise<PpobStatus> {
  const d = (await authed<Record<string, unknown>>('GET', '/v1/ppob/status', undefined, { timeoutMs: READ_MS })).data;
  const p = (d.points ?? {}) as Record<string, unknown>;
  return {
    enabled: d.enabled === true,
    categories: ((d.categories as Array<Record<string, unknown>>) ?? []).filter((c) => ['pulsa', 'data', 'pln'].includes(String(c.key))).map((c) => ({ key: c.key as PpobCategory, available: c.available === true, reason: (c.reason as string) ?? null })),
    points: { available: p.available === true, balance: n(p.balance), reason: (p.reason as string) ?? null, canTopup: p.canTopup === true, minTopup: n(p.minTopup), maxTopup: n(p.maxTopup) },
  };
}

export interface PpobProduct {
  id: string;
  category: PpobCategory;
  brand: string;
  name: string;
  description: string | null;
  price: number;
  sellPrice: number;
  margin: number;
  customPrice: boolean;
  available: boolean;
  unavailableReason: string | null;
}

export const productFromJson = (j: Record<string, unknown>): PpobProduct => {
  const price = n(j.price);
  const sell = j.sellPrice == null ? price : n(j.sellPrice);
  return {
    id: String(j.id),
    category: (['pulsa', 'data', 'pln'].includes(String(j.category)) ? j.category : 'pulsa') as PpobCategory,
    brand: String(j.brand ?? ''),
    name: String(j.name ?? ''),
    description: (j.description as string) ?? null,
    price,
    sellPrice: sell,
    margin: j.margin == null ? sell - price : n(j.margin),
    customPrice: j.customPrice === true,
    available: j.available !== false,
    unavailableReason: (j.unavailableReason as string) ?? null,
  };
};

export async function ppobProducts(category: PpobCategory, customerNo?: string): Promise<PpobProduct[]> {
  const q = new URLSearchParams({ category, ...(customerNo ? { customerNo } : {}) });
  return ((await authed<Array<Record<string, unknown>>>('GET', `/v1/ppob/products?${q}`, undefined, { timeoutMs: READ_MS })).data ?? []).map(productFromJson);
}

export async function plnInquiry(meterNo: string): Promise<{ ok: boolean; name: string | null; segmentPower: string | null; message: string | null }> {
  const d = (await authed<Record<string, unknown>>('POST', '/v1/ppob/pln/inquiry', { meterNo })).data;
  return { ok: d.ok === true, name: (d.name as string) ?? null, segmentPower: (d.segmentPower as string) ?? null, message: (d.message as string) ?? null };
}

export interface PpobOrder {
  id: string;
  clientRef: string;
  category: PpobCategory;
  productName: string;
  customerNo: string;
  price: number;
  status: string;
  refunded: boolean;
  sn: string | null;
  plnName: string | null;
  message: string | null;
  createdAt: number;
}

export const orderFromJson = (j: Record<string, unknown>): PpobOrder => ({
  id: String(j.id),
  clientRef: String(j.clientRef ?? ''),
  category: (['pulsa', 'data', 'pln'].includes(String(j.category)) ? j.category : 'pulsa') as PpobCategory,
  productName: String(j.productName ?? ''),
  customerNo: String(j.customerNo ?? ''),
  price: n(j.price),
  status: String(j.status ?? 'pending'),
  refunded: j.refunded === true,
  sn: (j.sn as string) || null,
  plnName: (j.plnName as string) || null,
  message: (j.message as string) ?? null,
  createdAt: n(j.createdAt),
});

export async function createOrder(clientRef: string, productId: string, customerNo: string): Promise<PpobOrder> {
  return orderFromJson((await authed<Record<string, unknown>>('POST', '/v1/ppob/orders', { clientRef, productId, customerNo }, { timeoutMs: ORDER_TIMEOUT_MS })).data);
}

export async function getOrder(id: string): Promise<PpobOrder> {
  return orderFromJson((await authed<Record<string, unknown>>('GET', `/v1/ppob/orders/${encodeURIComponent(id)}`)).data);
}

export async function listOrders(cursor?: string): Promise<{ items: PpobOrder[]; nextCursor: string | null }> {
  const r = await authed<Array<Record<string, unknown>>>('GET', `/v1/ppob/orders${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  return { items: (r.data ?? []).map(orderFromJson), nextCursor: (r.meta?.nextCursor as string) ?? null };
}

// ── Baris keranjang PPOB (PpobLine) ─────────────────────────────────────────

export interface PpobLine {
  clientRef: string;
  productId: string;
  category: PpobCategory;
  productName: string;
  customerNo: string;
  cost: number;
  orderId?: string | null;
  sn?: string | null;
  plnName?: string | null;
  status?: string | null;
}

export const isProcessing = (p: PpobLine) => !!p.orderId && p.status !== 'success';

export const withOrder = (p: PpobLine, o: PpobOrder): PpobLine => ({
  ...p,
  productName: o.productName || p.productName,
  cost: o.price,
  orderId: o.id,
  sn: o.sn,
  plnName: o.plnName,
  status: o.status,
});

/** Nama item di nota: "produk · nomor · a.n. X · Token/SN … · #ref8" (sama persis dengan HP). */
export function receiptName(p: PpobLine): string {
  const parts = [p.productName, p.customerNo];
  if (p.plnName) parts.push(`a.n. ${p.plnName}`);
  if (p.sn) parts.push(p.category === 'pln' ? `Token ${p.sn}` : `SN ${p.sn}`);
  else if (isProcessing(p)) parts.push(p.category === 'pln' ? 'DIPROSES, token menyusul' : 'DIPROSES');
  if (p.orderId) parts.push(`#${p.orderId.length > 8 ? p.orderId.slice(0, 8) : p.orderId}`);
  return parts.join(' · ');
}

export const ppobNoteTag = (orderId: string) => `PPOB ${orderId}`;

export type OutcomeKind = 'success' | 'accepted' | 'failed' | 'pending';
export interface PpobOutcome {
  kind: OutcomeKind;
  line: PpobLine;
  message: string;
  orderId?: string | null;
}

const NO_ANSWER = 'Belum ada jawaban, cek Riwayat PPOB.';
const processingMessage = (c: PpobCategory) => (c === 'pln' ? 'Sedang diproses, token menyusul.' : 'Sedang diproses penyedia.');

/** Kirim satu item PPOB (PpobCheckout.process): sukses/diterima → tetap di nota; gagal/tak jelas → keluar. */
export async function processLine(p: PpobLine, send = createOrder): Promise<PpobOutcome> {
  if (p.orderId) return { kind: isProcessing(p) ? 'accepted' : 'success', line: p, message: isProcessing(p) ? processingMessage(p.category) : 'Berhasil', orderId: p.orderId };
  try {
    const o = await send(p.clientRef, p.productId, p.customerNo);
    if (o.status === 'success') return { kind: 'success', line: withOrder(p, o), message: o.message ?? '', orderId: o.id };
    if (o.status === 'failed') return { kind: 'failed', line: p, message: o.message ?? 'Transaksi gagal. Poin sudah dikembalikan.', orderId: o.id };
    return { kind: 'accepted', line: withOrder(p, o), message: processingMessage(o.category), orderId: o.id };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.code === 'PENDING_SAME_TARGET') return { kind: 'pending', line: p, message: 'Nomor ini masih diproses, cek Riwayat PPOB.', orderId: ((e.details as Record<string, unknown>)?.orderId as string) ?? null };
      if (e.status >= 500 && e.code !== 'PPOB_UNAVAILABLE') return { kind: 'pending', line: p, message: NO_ANSWER };
      return { kind: 'failed', line: p, message: e.message };
    }
    if (e instanceof NetworkError) return { kind: 'pending', line: p, message: NO_ANSWER };
    throw e;
  }
}

// ── Harga jual PPOB ─────────────────────────────────────────────────────────

export interface PpobPricing {
  markups: Record<PpobCategory, number>;
  rounding: number;
  overrides: Record<string, number>;
  isDefault: boolean;
}

export async function getPricing(): Promise<PpobPricing> {
  return pricingFromJson((await authed<Record<string, unknown>>('GET', '/v1/ppob/pricing')).data);
}

const pricingFromJson = (d: Record<string, unknown>): PpobPricing => {
  const m = (d.markups ?? {}) as Record<string, unknown>;
  return {
    markups: { pulsa: m.pulsa == null ? 2000 : n(m.pulsa), data: m.data == null ? 2000 : n(m.data), pln: m.pln == null ? 2000 : n(m.pln) },
    rounding: d.rounding == null ? 500 : n(d.rounding),
    overrides: Object.fromEntries(((d.overrides as Array<Record<string, unknown>>) ?? []).map((o) => [String(o.productId), n(o.sellPrice)])),
    isDefault: d.isDefault === true,
  };
};

export async function savePricing(p: PpobPricing): Promise<{ pricing: PpobPricing; warnings: Array<{ productId: string; message: string }> }> {
  const d = (await authed<Record<string, unknown>>('PUT', '/v1/ppob/pricing', { markups: p.markups, rounding: p.rounding, overrides: Object.entries(p.overrides).map(([productId, sellPrice]) => ({ productId, sellPrice })) })).data;
  return { pricing: pricingFromJson(d), warnings: ((d.warnings as Array<Record<string, unknown>>) ?? []).map((w) => ({ productId: String(w.productId), message: String(w.message ?? '') })) };
}

/** Harga jual otomatis = pembulatan ke atas (modal + markup) — PpobPricing.sellPriceFor. */
export const sellPriceFor = (pr: PpobPricing, p: PpobProduct) => pr.overrides[p.id] ?? Math.ceil((p.price + (pr.markups[p.category] ?? 0)) / pr.rounding) * pr.rounding;

// ── Poin Sirko ──────────────────────────────────────────────────────────────

export interface LedgerItem { id: string; type: string; amount: number; balanceAfter: number; note: string | null; businessName: string | null; createdAt: number }
export interface Topup {
  id: string;
  amount: number;
  uniqueCode: number;
  transferAmount: number;
  status: string;
  adminNote: string | null;
  expiresAt: number;
  instructions: { transferAmount: number; bankName: string | null; accountNo: string | null; accountName: string | null; qrisImageUrl: string | null; note: string | null; expiresAt: number } | null;
}

const ledgerFromJson = (j: Record<string, unknown>): LedgerItem => ({ id: String(j.id), type: String(j.type ?? ''), amount: n(j.amount), balanceAfter: n(j.balanceAfter), note: (j.note as string) ?? null, businessName: (j.businessName as string) ?? null, createdAt: n(j.createdAt) });
export const ledgerLabel = (l: LedgerItem) =>
  ({ topup: 'Top-up Poin', purchase: l.note ?? 'Pembelian PPOB', refund: `Pengembalian: ${l.note ?? ''}`, adjustment: `Koreksi admin: ${l.note ?? ''}` })[l.type] ?? l.note ?? l.type;

const topupFromJson = (d: Record<string, unknown>): Topup => {
  const t = ((d.topup as Record<string, unknown>) ?? d) as Record<string, unknown>;
  const ins = d.instructions as Record<string, unknown> | undefined;
  return {
    id: String(t.id),
    amount: n(t.amount),
    uniqueCode: n(t.uniqueCode),
    transferAmount: n(t.transferAmount),
    status: String(t.status ?? 'pending'),
    adminNote: (t.adminNote as string) ?? null,
    expiresAt: n(t.expiresAt),
    instructions: ins
      ? { transferAmount: n(ins.transferAmount), bankName: (ins.bankName as string) ?? null, accountNo: (ins.accountNo as string) ?? null, accountName: (ins.accountName as string) ?? null, qrisImageUrl: (ins.qrisImageUrl as string) ?? null, note: (ins.note as string) ?? null, expiresAt: n(ins.expiresAt) }
      : null,
  };
};

export async function points(): Promise<{ balance: number; ledger: LedgerItem[]; pendingTopups: Topup[]; minTopup: number; maxTopup: number }> {
  const d = (await authed<Record<string, unknown>>('GET', '/v1/points', undefined, { timeoutMs: READ_MS })).data;
  const lim = (d.limits ?? {}) as Record<string, unknown>;
  return {
    balance: n(d.balance),
    ledger: ((d.ledger as Array<Record<string, unknown>>) ?? []).map(ledgerFromJson),
    pendingTopups: ((d.pendingTopups as Array<Record<string, unknown>>) ?? []).map(topupFromJson),
    minTopup: n(lim.minTopup),
    maxTopup: n(lim.maxTopup),
  };
}

export async function pointsLedger(cursor?: string): Promise<{ items: LedgerItem[]; nextCursor: string | null }> {
  const r = await authed<Array<Record<string, unknown>>>('GET', `/v1/points/ledger${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  return { items: (r.data ?? []).map(ledgerFromJson), nextCursor: (r.meta?.nextCursor as string) ?? null };
}

export const createTopup = async (amount: number) => topupFromJson((await authed<Record<string, unknown>>('POST', '/v1/points/topups', { amount })).data);
export const getTopup = async (id: string) => topupFromJson((await authed<Record<string, unknown>>('GET', `/v1/points/topups/${encodeURIComponent(id)}`)).data);
export const cancelTopup = async (id: string) => topupFromJson((await authed<Record<string, unknown>>('POST', `/v1/points/topups/${encodeURIComponent(id)}/cancel`, {})).data);
