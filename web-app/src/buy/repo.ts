import type { Row, StoreDb } from '../db/db';
import { uuid } from '../lib/crypto';
import { getSetting, PosError } from '../pos/repo';

/**
 * Pembelian (kulakan), supplier & stok opname — salinan aplikasi Flutter:
 *   PurchaseRepository.receive / paySupplierDebt, PurchaseCalculator, CostingPolicy (§15)
 *   SupplierRepository, OpnameRepository + OpnameCalculator (§16)
 */

const live = (r: Row | undefined): r is Row => !!r && r.deletedAt == null;
const fresh = (now: number, cols: Record<string, unknown>): Row => ({ id: uuid(), createdAt: now, updatedAt: now, deletedAt: null, ...cols, _dirty: 1 });
const touch = (now: number, patch: Record<string, unknown>) => ({ ...patch, updatedAt: now, _dirty: 1 });
const blank = (s?: string | null) => (s?.trim() ? s.trim() : null);

// ── Harga modal (CostingPolicy) ─────────────────────────────────────────────

export type CostingMethod = 'last_cost' | 'moving_average';
export const COSTING_LABEL: Record<CostingMethod, string> = { last_cost: 'Harga beli terakhir', moving_average: 'Rata-rata bergerak' };

export function nextCost(method: CostingMethod, oldStock: number, oldCost: number, qty: number, cost: number): number {
  if (method === 'last_cost') return cost;
  const denom = oldStock + qty;
  if (denom <= 0) return cost;
  return Math.floor((oldStock * oldCost + qty * cost + Math.floor(denom / 2)) / denom);
}

export async function costingMethod(db: StoreDb): Promise<CostingMethod> {
  return (await getSetting(db, 'costing_method')) === 'moving_average' ? 'moving_average' : 'last_cost';
}

// ── Supplier ─────────────────────────────────────────────────────────────────

export interface SupplierInput {
  name: string;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
}

export async function saveSupplier(db: StoreDb, id: string | null, i: SupplierInput): Promise<string> {
  if (!i.name.trim()) throw new PosError('Nama supplier wajib diisi.');
  const now = Date.now();
  const cols = { name: i.name.trim(), phone: blank(i.phone), address: blank(i.address), note: blank(i.note) };
  if (id) {
    await db.t('suppliers').update(id, touch(now, cols));
    return id;
  }
  const r = fresh(now, { ...cols, debtBalance: 0 });
  await db.t('suppliers').put(r);
  return r.id;
}

export async function deleteSupplier(db: StoreDb, id: string): Promise<void> {
  const s = await db.t('suppliers').get(id);
  if (!s) return;
  if (Number(s.debtBalance ?? 0) !== 0) throw new PosError('Supplier masih punya hutang. Lunasi dulu sebelum menghapus.');
  const now = Date.now();
  await db.t('suppliers').update(id, touch(now, { deletedAt: now }));
}

// ── Pembelian ────────────────────────────────────────────────────────────────

export interface PurchaseLine {
  productId: string;
  variantId?: string | null;
  nameSnapshot: string;
  qty: number;
  costPrice: number;
}

export function purchaseTotals(lines: PurchaseLine[], discount: number) {
  const subtotal = lines.reduce((s, l) => s + l.costPrice * l.qty, 0);
  const discountTotal = Math.min(Math.max(discount, 0), subtotal);
  return { subtotal, discountTotal, grandTotal: subtotal - discountTotal };
}

export const purchaseStatus = (grand: number, paid: number) => (paid >= grand ? 'paid' : paid <= 0 ? 'credit' : 'partial');

export interface ReceiveRequest {
  lines: PurchaseLine[];
  supplierId?: string | null;
  refNo?: string | null;
  discountTotal?: number;
  paidTotal?: number;
  /** Dompet sumber pembayaran (opsional). */
  walletId?: string | null;
  note?: string | null;
}

/**
 * Terima barang (§15) — atomik: nota pembelian + item, stok naik (log `in`, ref purchase), harga
 * modal baru per metode, sisa jadi hutang supplier, bayar dari dompet (gagal bila saldo kurang).
 */
export async function receivePurchase(db: StoreDb, req: ReceiveRequest): Promise<{ purchaseId: string; status: string; grandTotal: number; debtAdded: number }> {
  if (!req.lines.length) throw new PosError('Tak ada barang untuk diterima.');
  for (const l of req.lines) {
    if (l.qty <= 0) throw new PosError(`Qty "${l.nameSnapshot}" harus lebih dari 0.`);
    if (l.costPrice < 0) throw new PosError(`Harga beli "${l.nameSnapshot}" tak boleh negatif.`);
  }
  const t = purchaseTotals(req.lines, req.discountTotal ?? 0);
  const paid = Math.min(Math.max(req.paidTotal ?? 0, 0), t.grandTotal);
  const status = purchaseStatus(t.grandTotal, paid);
  const debtAdded = Math.max(t.grandTotal - paid, 0);
  if (debtAdded > 0 && !req.supplierId) throw new PosError('Pembelian kredit/partial wajib memilih supplier.');

  return db.transaction('rw', ['purchases', 'purchase_items', 'products', 'product_variants', 'stock_logs', 'suppliers', 'wallets', 'wallet_transactions', 'app_settings'].map((n) => db.table(n)), async () => {
    const now = Date.now();
    const method = await costingMethod(db);
    const refNo = blank(req.refNo);
    const p = fresh(now, { refNo, supplierId: req.supplierId ?? null, datetime: now, subtotal: t.subtotal, discountTotal: t.discountTotal, grandTotal: t.grandTotal, paidTotal: paid, status, note: blank(req.note) });
    await db.t('purchases').put(p);
    await db.t('purchase_items').bulkPut(req.lines.map((l, i) => fresh(now + i, { purchaseId: p.id, productId: l.productId, variantId: l.variantId ?? null, nameSnapshot: l.nameSnapshot, qty: l.qty, costPrice: l.costPrice, lineTotal: l.costPrice * l.qty })));
    for (const l of req.lines) {
      const table = l.variantId ? 'product_variants' : 'products';
      const row = await db.t(table).get(l.variantId ?? l.productId);
      if (!row) throw new PosError(`${l.variantId ? 'Varian' : 'Produk'} "${l.nameSnapshot}" tak ditemukan.`);
      const stockAfter = Number(row.stock ?? 0) + l.qty;
      const cost = nextCost(method, Number(row.stock ?? 0), Number(row.costPrice ?? 0), l.qty, l.costPrice);
      await db.t(table).update(row.id, touch(now, { stock: stockAfter, costPrice: cost }));
      await db.t('stock_logs').put(fresh(now, { productId: l.productId, variantId: l.variantId ?? null, type: 'in', qtyChange: l.qty, stockAfter, refType: 'purchase', refId: p.id, note: blank(`Pembelian ${refNo ?? ''}`) }));
    }
    if (debtAdded > 0) {
      const s = await db.t('suppliers').get(req.supplierId!);
      if (!s) throw new PosError('Supplier tak ditemukan.');
      await db.t('suppliers').update(s.id, touch(now, { debtBalance: Number(s.debtBalance ?? 0) + debtAdded }));
    }
    if (req.walletId && paid > 0) await spendWithin(db, req.walletId, paid, now, { category: 'pembelian', refType: 'purchase', refId: p.id, note: `Kulakan ${refNo ?? p.id}` });
    return { purchaseId: p.id, status, grandTotal: t.grandTotal, debtAdded };
  });
}

async function spendWithin(db: StoreDb, walletId: string, amount: number, now: number, c: { category: string; refType: string; refId: string; note: string }) {
  const w = await db.t('wallets').get(walletId);
  if (!live(w)) throw new PosError('Dompet tak ditemukan.');
  const bal = Number(w.balance ?? 0);
  if (bal < amount) throw new PosError(`Saldo "${w.name}" tak cukup (tersedia ${bal}, diminta ${amount}).`);
  await db.t('wallets').update(walletId, touch(now, { balance: bal - amount }));
  await db.t('wallet_transactions').put(fresh(now, { walletId, type: 'out', amount, targetWalletId: null, ...c, datetime: now }));
}

/** Bayar hutang supplier (tak melebihi hutang); opsional dari dompet. Kembalikan saldo hutang baru. */
export async function paySupplierDebt(db: StoreDb, supplierId: string, amount: number, walletId?: string | null, note?: string): Promise<number> {
  if (amount <= 0) throw new PosError('Nominal pembayaran harus lebih dari 0.');
  return db.transaction('rw', ['suppliers', 'wallets', 'wallet_transactions'].map((n) => db.table(n)), async () => {
    const now = Date.now();
    const s = await db.t('suppliers').get(supplierId);
    if (!s) throw new PosError('Supplier tak ditemukan.');
    const debt = Number(s.debtBalance ?? 0);
    const applied = Math.min(amount, debt);
    await db.t('suppliers').update(supplierId, touch(now, { debtBalance: debt - applied }));
    if (walletId && applied > 0) await spendWithin(db, walletId, applied, now, { category: 'hutang_supplier', refType: 'supplier_payment', refId: supplierId, note: blank(note) ?? `Bayar hutang ${s.name}` });
    return debt - applied;
  });
}

// ── Stok opname (§16) ────────────────────────────────────────────────────────

/** Item opname disimpan lokal (`_dirty = 3`) selama draft; dikirim saat final (append-only di server). */
const DRAFT_LOCAL = 3;

export async function createOpname(db: StoreDb, userId: string | null, refNo?: string, note?: string): Promise<string> {
  return db.transaction('rw', ['stock_opnames', 'stock_opname_items', 'products', 'product_variants'].map((n) => db.table(n)), async () => {
    const now = Date.now();
    const o = fresh(now, { refNo: blank(refNo), datetime: now, userId: userId && /^[0-9a-f-]{36}$/i.test(userId) ? userId : null, status: 'draft', note: blank(note) });
    await db.t('stock_opnames').put(o);
    const products = (await db.t('products').toArray()).filter((p) => live(p) && p.isActive !== false).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const items: Row[] = [];
    for (const p of products) {
      if (p.hasVariants === true) {
        const vs = (await db.t('product_variants').where('productId').equals(p.id).toArray()).filter(live).sort((a, b) => String(a.name).localeCompare(String(b.name)));
        for (const v of vs) items.push(fresh(now, { opnameId: o.id, productId: p.id, variantId: v.id, nameSnapshot: `${p.name} / ${v.name}`, systemQty: Number(v.stock ?? 0), physicalQty: Number(v.stock ?? 0), diff: 0 }));
      } else items.push(fresh(now, { opnameId: o.id, productId: p.id, variantId: null, nameSnapshot: String(p.name), systemQty: Number(p.stock ?? 0), physicalQty: Number(p.stock ?? 0), diff: 0 }));
    }
    await db.t('stock_opname_items').bulkPut(items.map((i) => ({ ...i, _dirty: DRAFT_LOCAL })));
    return o.id;
  });
}

export async function setPhysical(db: StoreDb, itemId: string, physicalQty: number): Promise<void> {
  await db.transaction('rw', ['stock_opnames', 'stock_opname_items'].map((n) => db.table(n)), async () => {
    const it = await db.t('stock_opname_items').get(itemId);
    if (!it) throw new PosError('Baris opname tak ditemukan.');
    if ((await db.t('stock_opnames').get(String(it.opnameId)))?.status !== 'draft') throw new PosError('Sesi opname sudah difinalisasi.');
    await db.t('stock_opname_items').update(itemId, { physicalQty, diff: physicalQty - Number(it.systemQty), updatedAt: Date.now(), _dirty: DRAFT_LOCAL });
  });
}

/** Final: stok = fisik (log adjustment ref opname, selisih terhadap stok TERKINI), kirim item. */
export async function finalizeOpname(db: StoreDb, opnameId: string): Promise<number> {
  return db.transaction('rw', ['stock_opnames', 'stock_opname_items', 'products', 'product_variants', 'stock_logs'].map((n) => db.table(n)), async () => {
    const o = await db.t('stock_opnames').get(opnameId);
    if (!o) throw new PosError('Sesi opname tak ditemukan.');
    if (o.status === 'finalized') throw new PosError('Sesi opname sudah difinalisasi.');
    const now = Date.now();
    const items = await db.t('stock_opname_items').where('opnameId').equals(opnameId).toArray();
    let adjusted = 0;
    for (const it of items) {
      await db.t('stock_opname_items').update(it.id, { updatedAt: now, _dirty: 1 });
      if (Number(it.diff) === 0) continue;
      adjusted++;
      const table = it.variantId ? 'product_variants' : it.productId ? 'products' : null;
      const row = table ? await db.t(table).get(String(it.variantId ?? it.productId)) : undefined;
      const current = row ? Number(row.stock ?? 0) : Number(it.systemQty);
      const change = Number(it.physicalQty) - current;
      if (change === 0) continue;
      if (table && row) await db.t(table).update(row.id, touch(now, { stock: Number(it.physicalQty) }));
      await db.t('stock_logs').put(fresh(now, { productId: it.productId ?? null, variantId: it.variantId ?? null, type: 'adjustment', qtyChange: change, stockAfter: Number(it.physicalQty), refType: 'opname', refId: opnameId, note: blank(`Opname ${o.refNo ?? ''}`) }));
    }
    await db.t('stock_opnames').update(opnameId, touch(now, { status: 'finalized' }));
    return adjusted;
  });
}

/** OpnameCalculator.summarize: berubah, lebih, kurang, nilai rugi (kurang × modal). */
export async function opnameSummary(db: StoreDb, opnameId: string) {
  const items = await db.t('stock_opname_items').where('opnameId').equals(opnameId).toArray();
  let changed = 0, surplus = 0, shortage = 0, loss = 0;
  for (const it of items) {
    const d = Number(it.physicalQty) - Number(it.systemQty);
    if (!d) continue;
    changed++;
    if (d > 0) surplus += d;
    else {
      const src = it.variantId ? await db.t('product_variants').get(String(it.variantId)) : it.productId ? await db.t('products').get(String(it.productId)) : undefined;
      shortage += -d;
      loss += -d * Number(src?.costPrice ?? 0);
    }
  }
  return { changed, surplus, shortage, loss };
}
