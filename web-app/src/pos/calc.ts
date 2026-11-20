/**
 * Kalkulasi kasir MURNI (tanpa I/O) — salinan persis aplikasi Flutter:
 *   TransactionCalculator  lib/features/pos/domain/transaction_calculator.dart
 *   PaymentCalculator      lib/features/pos/domain/payment_calculator.dart
 *   WholesalePricing       lib/features/products/domain/wholesale_pricing.dart
 * Spec 03-business-rules §1 (urutan), §2 (grosir), §3 (bayar), §4 (pembulatan).
 * Semua uang = integer rupiah. Urutan tidak boleh dibolak-balik:
 * per item → subtotal → diskon transaksi → dasar pajak → pajak → grandTotal → pembulatan.
 */

export type DiscountType = 'percent' | 'nominal';
export type RoundingMode = 'none' | 'nearest100' | 'nearest500';
export type PaymentMethod = 'cash' | 'qris' | 'transfer' | 'debit' | 'ewallet' | 'other';
export type TxStatus = 'paid' | 'credit' | 'partial' | 'void';

export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'qris', 'transfer', 'debit', 'ewallet', 'other'];
export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  debit: 'Debit',
  ewallet: 'E-Wallet',
  other: 'Lainnya',
};

export interface WholesaleTier {
  minQty: number;
  price: number;
}

/** Satu baris keranjang (snapshot harga & modal saat ditambahkan, §1). */
export interface CartLine {
  productId: string;
  variantId?: string | null;
  nameSnapshot: string;
  /** Harga jual normal (grosir menggantikannya bila qty memenuhi tier). */
  unitPrice: number;
  wholesaleTiers: WholesaleTier[];
  costPriceSnapshot: number;
  qty: number;
  discountType: DiscountType;
  discountValue: number;
  availableStock: number;
  unitName?: string | null;
}

export const lineKey = (l: Pick<CartLine, 'productId' | 'variantId'>) => (l.variantId ? `${l.productId}::${l.variantId}` : l.productId);

const idiv = (a: number, b: number) => Math.floor(a / b);

/** `round(base * p / 100)` setengah ke atas, tetap integer. */
export function percentOf(base: number, percent: number): number {
  if (base <= 0 || percent <= 0) return 0;
  return idiv(base * percent + 50, 100);
}

/** Bagian pajak yang SUDAH termasuk harga: `round(base * p / (100 + p))`. */
export function percentInclusive(base: number, percent: number): number {
  if (base <= 0 || percent <= 0) return 0;
  const denom = 100 + percent;
  return idiv(base * percent + idiv(denom, 2), denom);
}

export function applyRounding(value: number, mode: RoundingMode): number {
  const step = mode === 'nearest100' ? 100 : mode === 'nearest500' ? 500 : 0;
  if (!step) return value;
  return idiv(value + idiv(step, 2), step) * step;
}

/** Tier dengan minQty tertinggi yang ≤ qty (minQty ≤ 0 diabaikan), atau null. */
export function tierForQty(tiers: WholesaleTier[], qty: number): WholesaleTier | null {
  let best: WholesaleTier | null = null;
  for (const t of tiers) {
    if (t.minQty <= 0) continue;
    if (qty >= t.minQty && (!best || t.minQty > best.minQty)) best = t;
  }
  return best;
}

export interface LineResult {
  line: CartLine;
  effectiveUnitPrice: number;
  appliedWholesale: WholesaleTier | null;
  lineSubtotal: number;
  discount: number;
  lineTotal: number;
}

export function calculateLine(line: CartLine): LineResult {
  const tier = tierForQty(line.wholesaleTiers, line.qty);
  const effectiveUnitPrice = tier?.price ?? line.unitPrice;
  const lineSubtotal = effectiveUnitPrice * line.qty;
  const raw = line.discountType === 'percent' ? percentOf(lineSubtotal, line.discountValue) : line.discountValue;
  const discount = raw < 0 ? 0 : Math.min(raw, lineSubtotal);
  return { line, effectiveUnitPrice, appliedWholesale: tier, lineSubtotal, discount, lineTotal: lineSubtotal - discount };
}

export interface PosConfig {
  taxEnabled: boolean;
  taxPercent: number;
  taxInclusive: boolean;
  roundingMode: RoundingMode;
}

export const NO_CONFIG: PosConfig = { taxEnabled: false, taxPercent: 0, taxInclusive: false, roundingMode: 'none' };

export interface Totals {
  lineResults: LineResult[];
  subtotal: number;
  /** Diskon level transaksi (diskon item sudah tercermin di subtotal). */
  discountTotal: number;
  taxTotal: number;
  grandTotalBeforeRounding: number;
  roundingAdjustment: number;
  grandTotal: number;
  itemCount: number;
  itemDiscountTotal: number;
}

export function calculate(lines: CartLine[], txDiscountType: DiscountType, txDiscountValue: number, cfg: PosConfig): Totals {
  const lineResults = lines.map(calculateLine);
  const subtotal = lineResults.reduce((s, r) => s + r.lineTotal, 0);
  const rawTx = txDiscountType === 'percent' ? percentOf(subtotal, txDiscountValue) : txDiscountValue;
  const discountTotal = rawTx < 0 ? 0 : Math.min(rawTx, subtotal);
  const taxBase = subtotal - discountTotal;
  const p = cfg.taxEnabled ? cfg.taxPercent : 0;
  const taxTotal = cfg.taxInclusive ? percentInclusive(taxBase, p) : percentOf(taxBase, p);
  const grandTotalBeforeRounding = cfg.taxInclusive ? taxBase : taxBase + taxTotal;
  const grandTotal = applyRounding(grandTotalBeforeRounding, cfg.roundingMode);
  return {
    lineResults,
    subtotal,
    discountTotal,
    taxTotal,
    grandTotalBeforeRounding,
    roundingAdjustment: grandTotal - grandTotalBeforeRounding,
    grandTotal,
    itemCount: lineResults.reduce((s, r) => s + r.line.qty, 0),
    itemDiscountTotal: lineResults.reduce((s, r) => s + r.discount, 0),
  };
}

// ── Pembayaran (§3) ─────────────────────────────────────────────────────────

export interface PaymentEntry {
  method: PaymentMethod;
  amount: number;
  refNote?: string | null;
}

export interface PaymentResult {
  grandTotal: number;
  cashTotal: number;
  nonCashTotal: number;
  paidTotal: number;
  /** Kembalian — HANYA dari kelebihan tunai. */
  change: number;
  status: Exclude<TxStatus, 'void'>;
  /** Sisa belum terbayar (jadi hutang bila kredit/partial). */
  remaining: number;
}

export function resolvePayment(grandTotal: number, payments: PaymentEntry[]): PaymentResult {
  const cashTotal = payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
  const nonCashTotal = payments.filter((p) => p.method !== 'cash').reduce((s, p) => s + p.amount, 0);
  const paidTotal = cashTotal + nonCashTotal;
  const overpay = paidTotal - grandTotal;
  const change = overpay <= 0 ? 0 : Math.min(overpay, cashTotal);
  const status = paidTotal >= grandTotal ? 'paid' : paidTotal <= 0 ? 'credit' : 'partial';
  return { grandTotal, cashTotal, nonCashTotal, paidTotal, change, status, remaining: paidTotal >= grandTotal ? 0 : grandTotal - paidTotal };
}

/** Saran nominal tunai: dibulatkan ke atas ke 5rb/10rb/20rb/50rb/100rb (> total), maks 4. */
export function cashSuggestions(total: number): number[] {
  const out: number[] = [];
  for (const s of [5000, 10000, 20000, 50000, 100000]) {
    const r = Math.ceil(total / s) * s;
    if (r > total && !out.includes(r)) out.push(r);
    if (out.length >= 4) break;
  }
  return out;
}

// ── Format ──────────────────────────────────────────────────────────────────

const NF = new Intl.NumberFormat('id-ID');
export const rp = (n: number) => `${n < 0 ? '-' : ''}Rp${NF.format(Math.abs(Math.round(n)))}`;
export const num = (n: number) => NF.format(n);
/** "Rp 12.500" / "12.500" / "12500" → 12500 (hanya digit). */
export const parseRp = (s: string) => {
  const d = String(s ?? '').replace(/\D/g, '');
  return d ? Math.min(Number(d), 999_999_999_999) : 0;
};
