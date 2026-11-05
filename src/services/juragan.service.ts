import { sql, type DbClient } from '../db/client.js';
import { UserRepository } from '../db/repositories/user.repository.js';
import { uuid } from '../lib/uuid.js';
import { nowMs } from '../lib/time.js';
import { AppError, forbidden, validation } from '../lib/errors.js';
import * as plans from './plan.service.js';
import type { EffectivePlan } from './plan.service.js';
import { getStoreReport, type ReportRange } from './store-report.service.js';

/**
 * Fitur lintas-toko Paket Juragan (JURAGAN.md §3.5, K5). Setiap endpoint WAJIB:
 *  (1) paket akun pelaku punya `multi_store`, dan
 *  (2) akun adalah OWNER di SETIAP toko yang disentuh — tak percaya auth.businessId.
 * Invarian sync (§5): id baru = UUID baru; stok & kas = Σ ledger; server hanya
 * MENAMBAH baris ledger, tak pernah mengubah products.stock / updated_at.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

interface Guard {
  accountId: string;
  plan: EffectivePlan;
}

/** Akun pelaku + paket; tolak bila tak punya multi_store. */
async function requireMultiStore(userId: string): Promise<Guard> {
  const accountId = await plans.accountIdOfUser(userId);
  if (!accountId) throw forbidden('Fitur ini hanya untuk pemilik toko.');
  const plan = await plans.effective(accountId);
  if (!plans.hasFeature(plan, 'multi_store')) {
    throw new AppError('PLAN_REQUIRED', 'Fitur lintas-toko butuh Paket Juragan.');
  }
  return { accountId, plan };
}

/** Pastikan akun = owner di setiap toko (tak bocorkan keberadaan toko lain). */
async function requireOwnerOf(accountId: string, businessIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const id of new Set(businessIds)) {
    const m = UUID_RE.test(id) ? await UserRepository.findMembershipForAuth(accountId, id) : undefined;
    if (!m || m.role !== 'owner') throw forbidden('Anda bukan pemilik salah satu toko yang dipilih.');
    const [b] = await sql<{ name: string }[]>`SELECT name FROM businesses WHERE id = ${id}`;
    names.set(id, b?.name ?? '');
  }
  return names;
}

/** Toko yang dimiliki akun (owner), urut nama. */
async function ownedBusinesses(accountId: string): Promise<Array<{ id: string; name: string }>> {
  const rows = await UserRepository.listMembershipsForAuth(accountId);
  return rows.filter((r) => r.role === 'owner').map((r) => ({ id: r.business_id as string, name: r.business_name }));
}

// ── 1. Laporan gabungan ──────────────────────────────────────────────────────

export interface StoreSummary {
  businessId: string;
  name: string;
  txCount: number;
  omzet: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  /** Kasbon/piutang pelanggan saat ini (semua periode): Σ max(total − dibayar − pelunasan, 0). */
  receivables: number;
  /** Saldo kas semua dompet saat ini, dari ledger wallet_transactions (SYNC.md §8.6). */
  cashBalance: number;
}

async function receivablesOf(businessId: string): Promise<number> {
  const [r] = await sql<{ v: string }[]>`
    SELECT coalesce(sum(greatest(t.grand_total - coalesce(t.paid_total, 0) - coalesce((
      SELECT sum(cp.amount) FROM credit_payments cp
      WHERE cp.business_id = ${businessId} AND cp.transaction_id = t.id AND cp.deleted_at IS NULL), 0), 0)), 0) AS v
    FROM transactions t
    WHERE t.business_id = ${businessId} AND t.deleted_at IS NULL AND t.status <> 'void'`;
  return n(r?.v);
}

async function cashBalanceOf(businessId: string): Promise<number> {
  // Σ saldo semua dompet = Σ in − Σ out (transfer antar-dompet satu toko saling meniadakan).
  const [r] = await sql<{ v: string }[]>`
    SELECT coalesce(sum(CASE type WHEN 'in' THEN amount WHEN 'out' THEN -amount ELSE 0 END), 0) AS v
    FROM wallet_transactions WHERE business_id = ${businessId} AND deleted_at IS NULL`;
  return n(r?.v);
}

export async function summaryReport(auth: { userId: string }, range: ReportRange) {
  const { accountId, plan } = await requireMultiStore(auth.userId);
  const stores = await ownedBusinesses(accountId);
  const items: StoreSummary[] = await Promise.all(
    stores.map(async (s) => {
      const [rep, receivables, cashBalance] = await Promise.all([
        getStoreReport(s.id, range),
        receivablesOf(s.id),
        cashBalanceOf(s.id),
      ]);
      return {
        businessId: s.id,
        name: s.name,
        txCount: rep.sales.txCount,
        omzet: rep.sales.omzet,
        revenue: rep.profit.revenue,
        cogs: rep.profit.cogs,
        grossProfit: rep.profit.grossProfit,
        receivables,
        cashBalance,
      };
    }),
  );
  const sum = (k: keyof Omit<StoreSummary, 'businessId' | 'name'>) => items.reduce((a, x) => a + x[k], 0);
  return {
    range: { from: range.from, to: range.to, fromMs: range.fromMs, toMs: range.toMs },
    stores: items,
    total: {
      txCount: sum('txCount'),
      omzet: sum('omzet'),
      revenue: sum('revenue'),
      cogs: sum('cogs'),
      grossProfit: sum('grossProfit'),
      receivables: sum('receivables'),
      cashBalance: sum('cashBalance'),
    },
    plan,
  };
}

// ── 2. Salin produk antar-toko ───────────────────────────────────────────────

type Row = Record<string, unknown>;

export interface CopyResult {
  copied: Array<{ fromProductId: string; toProductId: string; variants: Array<{ fromVariantId: string; toVariantId: string }> }>;
  skipped: Array<{ fromProductId: string; reason: 'NOT_FOUND' | 'BARCODE_EXISTS'; existingProductId?: string }>;
  createdCategories: number;
  createdUnits: number;
}

/**
 * Salin produk (+ varian, harga grosir, kategori & satuan bila belum ada — cocok
 * per nama) ke toko lain. Semua baris = UUID BARU (menyalin id → ID_CONFLICT),
 * stok salinan = 0 (pakai mutasi stok). Produk yang barcode-nya sudah ada di toko
 * tujuan dilewati & dikembalikan id produk yang ada (untuk mutasi stok).
 */
export async function copyProducts(
  auth: { userId: string },
  input: { fromBusinessId: string; toBusinessId: string; productIds: string[] },
): Promise<CopyResult> {
  if (input.fromBusinessId === input.toBusinessId) throw validation('Toko asal dan tujuan harus berbeda.');
  const { accountId } = await requireMultiStore(auth.userId);
  await requireOwnerOf(accountId, [input.fromBusinessId, input.toBusinessId]);
  const from = input.fromBusinessId;
  const to = input.toBusinessId;
  const ids = [...new Set(input.productIds)];
  const ts = nowMs();

  return sql.begin(async (tx) => {
    const products = await tx<Row[]>`
      SELECT * FROM products WHERE business_id = ${from} AND id = ANY(${ids}::uuid[]) AND deleted_at IS NULL`;
    const found = new Map(products.map((p) => [p.id as string, p]));
    const result: CopyResult = { copied: [], skipped: [], createdCategories: 0, createdUnits: 0 };
    for (const id of ids) if (!found.has(id)) result.skipped.push({ fromProductId: id, reason: 'NOT_FOUND' });

    // Kategori & satuan: cocokkan per nama (tanpa beda huruf besar/kecil) di toko tujuan, else buat.
    const refMap = async (table: 'categories' | 'units', srcId: unknown): Promise<string | null> => {
      if (!srcId) return null;
      const [src] = await tx<Row[]>`SELECT * FROM ${tx(table)} WHERE business_id = ${from} AND id = ${srcId as string}`;
      if (!src) return null;
      const [hit] = await tx<{ id: string }[]>`
        SELECT id FROM ${tx(table)} WHERE business_id = ${to} AND deleted_at IS NULL
          AND lower(name) = lower(${(src.name as string) ?? ''}) LIMIT 1`;
      if (hit) return hit.id;
      const newId = uuid();
      if (table === 'categories') {
        await tx`INSERT INTO categories (id, business_id, name, color, sort_order, created_at, updated_at)
                 VALUES (${newId}, ${to}, ${src.name as string}, ${(src.color as string) ?? null}, ${(src.sort_order as number) ?? null}, ${ts}, ${ts})`;
        result.createdCategories++;
      } else {
        await tx`INSERT INTO units (id, business_id, name, is_base_unit, created_at, updated_at)
                 VALUES (${newId}, ${to}, ${src.name as string}, ${(src.is_base_unit as boolean) ?? null}, ${ts}, ${ts})`;
        result.createdUnits++;
      }
      return newId;
    };

    for (const p of products) {
      if (p.barcode) {
        const [dup] = await tx<{ id: string }[]>`
          SELECT id FROM products WHERE business_id = ${to} AND barcode = ${p.barcode as string} AND deleted_at IS NULL LIMIT 1`;
        if (dup) {
          result.skipped.push({ fromProductId: p.id as string, reason: 'BARCODE_EXISTS', existingProductId: dup.id });
          continue;
        }
      }
      const newId = uuid();
      const image = typeof p.image_path === 'string' && /^https?:\/\//.test(p.image_path) ? p.image_path : null;
      await tx`INSERT INTO products (id, business_id, name, barcode, category_id, unit_id, cost_price, selling_price,
                 stock, min_stock, expiry_date, image_path, has_variants, is_active, needs_price, created_at, updated_at)
               VALUES (${newId}, ${to}, ${p.name as string}, ${(p.barcode as string) ?? null},
                 ${await refMap('categories', p.category_id)}, ${await refMap('units', p.unit_id)},
                 ${(p.cost_price as string) ?? null}, ${(p.selling_price as string) ?? null}, 0,
                 ${(p.min_stock as number) ?? null}, ${(p.expiry_date as string) ?? null}, ${image},
                 ${(p.has_variants as boolean) ?? null}, ${(p.is_active as boolean) ?? null},
                 ${(p.needs_price as boolean) ?? null}, ${ts}, ${ts})`;
      const variants = await tx<Row[]>`
        SELECT * FROM product_variants WHERE business_id = ${from} AND product_id = ${p.id as string} AND deleted_at IS NULL`;
      const vmap: Array<{ fromVariantId: string; toVariantId: string }> = [];
      for (const v of variants) {
        const vid = uuid();
        await tx`INSERT INTO product_variants (id, business_id, product_id, name, barcode, selling_price, cost_price, stock, created_at, updated_at)
                 VALUES (${vid}, ${to}, ${newId}, ${(v.name as string) ?? null}, ${(v.barcode as string) ?? null},
                   ${(v.selling_price as string) ?? null}, ${(v.cost_price as string) ?? null}, 0, ${ts}, ${ts})`;
        vmap.push({ fromVariantId: v.id as string, toVariantId: vid });
      }
      const tiers = await tx<Row[]>`
        SELECT * FROM wholesale_prices WHERE business_id = ${from} AND product_id = ${p.id as string} AND deleted_at IS NULL`;
      for (const w of tiers) {
        await tx`INSERT INTO wholesale_prices (id, business_id, product_id, min_qty, price, created_at, updated_at)
                 VALUES (${uuid()}, ${to}, ${newId}, ${(w.min_qty as number) ?? null}, ${(w.price as string) ?? null}, ${ts}, ${ts})`;
      }
      result.copied.push({ fromProductId: p.id as string, toProductId: newId, variants: vmap });
    }
    return result;
  });
}

// ── 3. Mutasi stok antar-toko ────────────────────────────────────────────────

export interface TransferLine {
  productId: string;
  toProductId: string;
  variantId?: string | null;
  toVariantId?: string | null;
  qty: number;
}

/** Stok ledger (Σ stock_logs) satu produk/varian di sebuah toko (SYNC.md §8.6). */
async function ledgerStock(tx: DbClient, businessId: string, productId: string, variantId: string | null) {
  const [r]: { v: string }[] = await tx`
    SELECT coalesce(sum(qty_change), 0) AS v FROM stock_logs
    WHERE business_id = ${businessId} AND deleted_at IS NULL AND product_id = ${productId}
      AND ${variantId ? sql`variant_id = ${variantId}` : sql`variant_id IS NULL`}`;
  return n(r?.v);
}

/**
 * Pindahkan stok antar toko: satu transaksi, untuk tiap baris `stock_logs` toko
 * asal (`out`, −qty) & tujuan (`in`, +qty), `ref_type 'store_transfer'`, `ref_id`
 * sama. Ditolak bila stok ledger di server kurang (sinkronkan toko asal dulu).
 */
export async function transferStock(
  auth: { userId: string },
  input: { fromBusinessId: string; toBusinessId: string; lines: TransferLine[]; note?: string | null },
) {
  if (input.fromBusinessId === input.toBusinessId) throw validation('Toko asal dan tujuan harus berbeda.');
  const { accountId } = await requireMultiStore(auth.userId);
  const names = await requireOwnerOf(accountId, [input.fromBusinessId, input.toBusinessId]);
  const from = input.fromBusinessId;
  const to = input.toBusinessId;
  const transferId = uuid();
  const ts = nowMs();
  const note = (input.note ?? '').trim() || null;
  const noteOut = `Mutasi ke ${names.get(to)}${note ? ` — ${note}` : ''}`;
  const noteIn = `Mutasi dari ${names.get(from)}${note ? ` — ${note}` : ''}`;

  return sql.begin(async (tx) => {
    const out: Array<TransferLine & { fromStockAfter: number; toStockAfter: number }> = [];
    for (const [i, l] of input.lines.entries()) {
      const fromVar = l.variantId ?? null;
      const toVar = l.toVariantId ?? null;
      // Kunci baris produk (tanpa mengubahnya) → mutasi bersamaan tak saling balap.
      const [src] = await tx<Row[]>`
        SELECT id, name FROM products WHERE business_id = ${from} AND id = ${l.productId} AND deleted_at IS NULL FOR UPDATE`;
      const [dst] = await tx<Row[]>`
        SELECT id FROM products WHERE business_id = ${to} AND id = ${l.toProductId} AND deleted_at IS NULL FOR UPDATE`;
      if (!src || !dst) throw validation(`Baris ${i + 1}: produk tidak ditemukan di toko asal/tujuan.`);
      if (Boolean(fromVar) !== Boolean(toVar)) throw validation(`Baris ${i + 1}: varian asal & tujuan harus sama-sama diisi atau kosong.`);
      if (fromVar) {
        const [v1] = await tx`SELECT id FROM product_variants WHERE business_id = ${from} AND id = ${fromVar} AND product_id = ${l.productId} AND deleted_at IS NULL`;
        const [v2] = await tx`SELECT id FROM product_variants WHERE business_id = ${to} AND id = ${toVar} AND product_id = ${l.toProductId} AND deleted_at IS NULL`;
        if (!v1 || !v2) throw validation(`Baris ${i + 1}: varian tidak ditemukan.`);
      }
      const available = await ledgerStock(tx, from, l.productId, fromVar);
      if (l.qty > available) {
        throw validation(
          `Stok "${src.name as string}" di toko asal tidak cukup (tercatat di server ${available}). Sinkronkan toko asal dulu.`,
        );
      }
      const toBefore = await ledgerStock(tx, to, l.toProductId, toVar);
      const fromAfter = available - l.qty;
      const toAfter = toBefore + l.qty;
      await tx`INSERT INTO stock_logs (id, business_id, product_id, variant_id, type, qty_change, stock_after, ref_type, ref_id, note, created_at, updated_at)
               VALUES (${uuid()}, ${from}, ${l.productId}, ${fromVar}, 'out', ${-l.qty}, ${fromAfter}, 'store_transfer', ${transferId}, ${noteOut}, ${ts}, ${ts})`;
      await tx`INSERT INTO stock_logs (id, business_id, product_id, variant_id, type, qty_change, stock_after, ref_type, ref_id, note, created_at, updated_at)
               VALUES (${uuid()}, ${to}, ${l.toProductId}, ${toVar}, 'in', ${l.qty}, ${toAfter}, 'store_transfer', ${transferId}, ${noteIn}, ${ts}, ${ts})`;
      out.push({ ...l, variantId: fromVar, toVariantId: toVar, fromStockAfter: fromAfter, toStockAfter: toAfter });
    }
    return { transferId, fromBusinessId: from, toBusinessId: to, createdAt: ts, lines: out };
  });
}
