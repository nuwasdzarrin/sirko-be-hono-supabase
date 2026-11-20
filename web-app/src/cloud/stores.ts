import { authed } from '../session/auth';

/**
 * Paket Juragan — klien API sama dengan aplikasi HP (lib/features/stores/data/store_remote.dart,
 * domain/cross_store.dart, subscription/data/subscription_remote.dart).
 */

const n = (v: unknown) => Number(v ?? 0) || 0;

export interface StoreSummary { businessId: string; name: string; txCount: number; omzet: number; grossProfit: number; receivables: number; cashBalance: number }
export const REPORT_PRESETS: Array<[string, string]> = [['today', 'Hari ini'], ['7d', '7 hari'], ['30d', '30 hari'], ['month', 'Bulan ini'], ['lastmonth', 'Bulan lalu'], ['year', 'Tahun ini']];

const summaryFromJson = (j: Record<string, unknown>): StoreSummary => ({ businessId: String(j.businessId ?? ''), name: String(j.name ?? 'Total'), txCount: n(j.txCount), omzet: n(j.omzet), grossProfit: n(j.grossProfit), receivables: n(j.receivables), cashBalance: n(j.cashBalance) });

export async function combinedReport(preset: string): Promise<{ from: string; to: string; stores: StoreSummary[]; total: StoreSummary }> {
  const d = (await authed<Record<string, unknown>>('GET', `/v1/juragan/reports/summary?preset=${encodeURIComponent(preset)}`)).data;
  const range = (d.range ?? {}) as Record<string, unknown>;
  return { from: String(range.from ?? ''), to: String(range.to ?? ''), stores: ((d.stores as Array<Record<string, unknown>>) ?? []).map(summaryFromJson), total: summaryFromJson((d.total as Record<string, unknown>) ?? {}) };
}

// ── Transfer stok antar-toko (CrossStorePlanner) ────────────────────────────

export interface ProductLink { fromProductId: string; toProductId: string; variants: Record<string, string> }
const linkFromJson = (j: Record<string, unknown>, productKey = 'toProductId'): ProductLink => ({
  fromProductId: String(j.fromProductId),
  toProductId: String(j[productKey] ?? j.toProductId),
  variants: Object.fromEntries(((j.variants as Array<Record<string, unknown>>) ?? []).map((v) => [String(v.fromVariantId), String(v.toVariantId)])),
});

export async function productLinks(fromBusinessId: string, toBusinessId: string): Promise<ProductLink[]> {
  const q = new URLSearchParams({ fromBusinessId, toBusinessId });
  return (((await authed<Record<string, unknown>>('GET', `/v1/juragan/product-links?${q}`)).data.links as Array<Record<string, unknown>>) ?? []).map((l) => linkFromJson(l));
}

export async function copyProducts(fromBusinessId: string, toBusinessId: string, productIds: string[]): Promise<{ links: ProductLink[]; notFound: string[] }> {
  const d = (await authed<Record<string, unknown>>('POST', '/v1/juragan/copy-products', { fromBusinessId, toBusinessId, productIds })).data;
  const links = ((d.copied as Array<Record<string, unknown>>) ?? []).map((c) => linkFromJson(c));
  const notFound: string[] = [];
  for (const s of (d.skipped as Array<Record<string, unknown>>) ?? []) {
    if (s.existingProductId == null) notFound.push(String(s.fromProductId));
    else links.push(linkFromJson(s, 'existingProductId'));
  }
  return { links, notFound };
}

export interface TransferPick { productId: string; variantId?: string | null; name: string; qty: number }
export interface TransferLine { productId: string; toProductId: string; variantId?: string; toVariantId?: string; qty: number }

/** Produk yang belum punya pasangan di toko tujuan → perlu disalin dulu. */
export const needCopy = (picks: TransferPick[], links: ProductLink[]) => [...new Set(picks.map((p) => p.productId))].filter((id) => !links.some((l) => l.fromProductId === id));

/** Petakan pilihan ke baris transfer (varian dipetakan lewat link); yang tak berpasangan → unmatched. */
export function planTransfer(picks: TransferPick[], links: ProductLink[]): { lines: TransferLine[]; unmatched: string[] } {
  const by = new Map(links.map((l) => [l.fromProductId, l]));
  const lines: TransferLine[] = [];
  const unmatched: string[] = [];
  for (const p of picks) {
    if (p.qty <= 0) continue;
    const link = by.get(p.productId);
    if (!link) {
      unmatched.push(p.name);
      continue;
    }
    if (p.variantId) {
      const to = link.variants[p.variantId];
      if (!to) {
        unmatched.push(p.name);
        continue;
      }
      lines.push({ productId: p.productId, toProductId: link.toProductId, variantId: p.variantId, toVariantId: to, qty: p.qty });
    } else lines.push({ productId: p.productId, toProductId: link.toProductId, qty: p.qty });
  }
  return { lines, unmatched };
}

export async function stockTransfer(fromBusinessId: string, toBusinessId: string, lines: TransferLine[], note?: string): Promise<string> {
  const d = (await authed<Record<string, unknown>>('POST', '/v1/juragan/stock-transfers', { fromBusinessId, toBusinessId, lines, ...(note ? { note } : {}) })).data;
  return String(d.transferId ?? '');
}

// ── Langganan Paket Juragan ─────────────────────────────────────────────────

export interface PlanPrice { period: 'monthly' | 'yearly'; amount: number; maxStores: number }
export interface Payment { qrisUrl: string | null; bankName: string | null; accountNo: string | null; accountName: string | null; note: string | null }
export interface Checkout { id: string; period: 'monthly' | 'yearly'; amount: number; uniqueCode: number; expiresAt: number; qrisUrl: string | null; status: 'pending' | 'confirmed' | 'rejected' | 'expired'; note: string | null; plan: unknown }

const FALLBACK: PlanPrice[] = [{ period: 'monthly', amount: 49000, maxStores: 3 }, { period: 'yearly', amount: 499000, maxStores: 3 }];

export async function planCatalog(): Promise<{ prices: PlanPrice[]; payment: Payment }> {
  const d = (await authed<Record<string, unknown>>('GET', '/v1/plans')).data;
  const list = ((d.prices ?? d.plans) as Array<Record<string, unknown>>) ?? [];
  const prices = list
    .filter((e) => (e.plan == null || e.plan === 'juragan') && (e.period === 'monthly' || e.period === 'yearly'))
    .map((e) => ({ period: e.period as PlanPrice['period'], amount: n(e.amount), maxStores: e.maxStores == null ? 3 : n(e.maxStores) }));
  const p = ((d.payment as Record<string, unknown>) ?? { qrisUrl: d.qrisUrl }) as Record<string, unknown>;
  return {
    prices: prices.length ? prices : FALLBACK,
    payment: { qrisUrl: (p.qrisUrl as string) ?? null, bankName: (p.bankName as string) ?? null, accountNo: (p.accountNo as string) ?? null, accountName: (p.accountName as string) ?? null, note: (p.note as string) ?? null },
  };
}

const checkoutFromJson = (j: Record<string, unknown>, period?: Checkout['period']): Checkout => ({
  id: String(j.id),
  period: j.period === 'yearly' || j.period === 'monthly' ? j.period : period ?? 'monthly',
  amount: n(j.amount),
  uniqueCode: n(j.uniqueCode),
  expiresAt: n(j.expiresAt),
  qrisUrl: (j.qrisUrl as string) ?? null,
  status: (['confirmed', 'rejected', 'expired'].includes(String(j.status)) ? j.status : 'pending') as Checkout['status'],
  note: (j.note as string) ?? null,
  plan: j.plan ?? null,
});

export const startCheckout = async (period: Checkout['period']) => checkoutFromJson((await authed<Record<string, unknown>>('POST', '/v1/plan/checkout', { period })).data, period);
export const checkoutStatus = async (id: string) => checkoutFromJson((await authed<Record<string, unknown>>('GET', `/v1/plan/checkout/${encodeURIComponent(id)}`)).data);
