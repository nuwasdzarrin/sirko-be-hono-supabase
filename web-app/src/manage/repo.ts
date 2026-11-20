import type { Row, StoreDb } from '../db/db';
import { hashPin, uuid } from '../lib/crypto';
import { encodePermissions, resolvePermissions, type AppRole, type Permission } from '../lib/permissions';
import type { PaymentMethod } from '../pos/calc';
import { KEY_DEFAULT_CASH_WALLET, getSetting, PosError, setSetting, type PaymentOptions } from '../pos/repo';

/**
 * Kelola toko (Fase 3) — salinan perilaku repositori aplikasi Flutter agar baris tersinkron identik:
 *   ProductRepository / VariantRepository / WholesaleRepository / StockLedger / InventoryRepository /
 *   StockInRepository / CategoryRepository / UnitRepository   (lib/features/products/data)
 *   CustomerRepository / CreditRepository.payDebt / createInstallmentPlan / InstallmentPlan.split
 *   UserRepository (username unik, administrator terakhir dijaga, PIN PBKDF2)
 * Aturan inti: stok = Σ stock_logs (SYNC §8.6) → setiap perubahan stok selalu disertai log.
 */

const live = (r: Row | undefined): r is Row => !!r && r.deletedAt == null;
const fresh = (now: number, cols: Record<string, unknown>): Row => ({ id: uuid(), createdAt: now, updatedAt: now, deletedAt: null, ...cols, _dirty: 1 });
const touch = (now: number, patch: Record<string, unknown>) => ({ ...patch, updatedAt: now, _dirty: 1 });
const txn = <T>(db: StoreDb, tables: string[], fn: () => Promise<T>) => db.transaction('rw', tables.map((t) => db.table(t)), fn);
const blank = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);

async function softDelete(db: StoreDb, table: string, id: string) {
  const now = Date.now();
  await db.t(table).update(id, touch(now, { deletedAt: now }));
}
async function restore(db: StoreDb, table: string, id: string) {
  await db.t(table).update(id, touch(Date.now(), { deletedAt: null }));
}

// ── Ledger stok ──────────────────────────────────────────────────────────────

function logRow(now: number, c: { productId: string; variantId?: string | null; type: string; qtyChange: number; stockAfter: number; refType: string; refId?: string | null; note?: string | null }) {
  return fresh(now, { productId: c.productId, variantId: c.variantId ?? null, type: c.type, qtyChange: c.qtyChange, stockAfter: c.stockAfter, refType: c.refType, refId: c.refId ?? null, note: c.note ?? null });
}

// ── Produk ───────────────────────────────────────────────────────────────────

export interface ProductInput {
  name: string;
  barcode?: string | null;
  categoryId?: string | null;
  unitId?: string | null;
  costPrice: number;
  sellingPrice: number;
  /** Buat: stok awal. Ubah: null = stok tidak diubah form (jangan timpa penjualan yang terjadi). */
  stock: number | null;
  minStock?: number | null;
  expiryDate?: number | null;
  hasVariants: boolean;
}

export async function barcodeOwner(db: StoreDb, code: string, exceptProductId?: string, exceptVariantId?: string): Promise<string | null> {
  const c = code.trim();
  if (!c) return null;
  const p = (await db.t('products').where('barcode').equals(c).toArray()).find((x) => live(x) && x.id !== exceptProductId);
  if (p) return String(p.name);
  const v = (await db.t('product_variants').where('barcode').equals(c).toArray()).find((x) => live(x) && x.id !== exceptVariantId);
  if (v) return `${(await db.t('products').get(String(v.productId)))?.name ?? 'Produk'} — ${v.name}`;
  return null;
}

export async function createProduct(db: StoreDb, i: ProductInput): Promise<string> {
  const now = Date.now();
  const stock = i.hasVariants ? 0 : i.stock ?? 0;
  const p = fresh(now, {
    name: i.name.trim(), barcode: blank(i.barcode), categoryId: i.categoryId || null, unitId: i.unitId || null,
    costPrice: i.costPrice, sellingPrice: i.sellingPrice, stock, minStock: i.minStock ?? null, expiryDate: i.expiryDate ?? null,
    imagePath: null, hasVariants: i.hasVariants, isActive: true, needsPrice: false,
  });
  await txn(db, ['products', 'stock_logs'], async () => {
    await db.t('products').put(p);
    if (stock !== 0) await db.t('stock_logs').put(logRow(now, { productId: p.id, type: 'initial', qtyChange: stock, stockAfter: stock, refType: 'initial' }));
  });
  return p.id;
}

export async function updateProduct(db: StoreDb, id: string, i: ProductInput): Promise<void> {
  await txn(db, ['products', 'stock_logs'], async () => {
    const now = Date.now();
    const cur = await db.t('products').get(id);
    if (!cur) throw new PosError('Produk tak ditemukan.');
    const patch: Record<string, unknown> = {
      name: i.name.trim(), barcode: blank(i.barcode), categoryId: i.categoryId || null, unitId: i.unitId || null,
      costPrice: i.costPrice, sellingPrice: i.sellingPrice, minStock: i.minStock ?? null, expiryDate: i.expiryDate ?? null, hasVariants: i.hasVariants,
    };
    if (i.sellingPrice > 0) patch.needsPrice = false; // harga diisi → lepas penanda "perlu harga"
    if (i.stock != null && Number(cur.stock ?? 0) !== i.stock) {
      await db.t('stock_logs').put(logRow(now, { productId: id, type: 'adjustment', qtyChange: i.stock - Number(cur.stock ?? 0), stockAfter: i.stock, refType: 'manual', note: 'Ubah stok lewat form produk' }));
      patch.stock = i.stock;
    }
    await db.t('products').update(id, touch(now, patch));
  });
}

export const deleteProduct = (db: StoreDb, id: string) => softDelete(db, 'products', id);
export const restoreProduct = (db: StoreDb, id: string) => restore(db, 'products', id);

// ── Varian ───────────────────────────────────────────────────────────────────

export interface VariantInput {
  name: string;
  barcode?: string | null;
  sellingPrice: number;
  costPrice: number;
  stock: number | null;
}

export async function createVariant(db: StoreDb, productId: string, i: VariantInput): Promise<string> {
  const now = Date.now();
  const stock = i.stock ?? 0;
  const v = fresh(now, { productId, name: i.name.trim(), barcode: blank(i.barcode), sellingPrice: i.sellingPrice, costPrice: i.costPrice, stock });
  await txn(db, ['product_variants', 'stock_logs'], async () => {
    await db.t('product_variants').put(v);
    if (stock !== 0) await db.t('stock_logs').put(logRow(now, { productId, variantId: v.id, type: 'initial', qtyChange: stock, stockAfter: stock, refType: 'initial' }));
  });
  return v.id;
}

export async function updateVariant(db: StoreDb, id: string, i: VariantInput): Promise<void> {
  await txn(db, ['product_variants', 'stock_logs'], async () => {
    const now = Date.now();
    const cur = await db.t('product_variants').get(id);
    if (!cur) throw new PosError('Varian tak ditemukan.');
    const patch: Record<string, unknown> = { name: i.name.trim(), barcode: blank(i.barcode), sellingPrice: i.sellingPrice, costPrice: i.costPrice };
    if (i.stock != null && Number(cur.stock ?? 0) !== i.stock) {
      await db.t('stock_logs').put(logRow(now, { productId: String(cur.productId), variantId: id, type: 'adjustment', qtyChange: i.stock - Number(cur.stock ?? 0), stockAfter: i.stock, refType: 'manual', note: 'Ubah stok lewat form varian' }));
      patch.stock = i.stock;
    }
    await db.t('product_variants').update(id, touch(now, patch));
  });
}

export const deleteVariant = (db: StoreDb, id: string) => softDelete(db, 'product_variants', id);

// ── Harga grosir ─────────────────────────────────────────────────────────────

export async function saveWholesale(db: StoreDb, productId: string, tier: { id?: string; minQty: number; price: number }): Promise<void> {
  if (tier.minQty < 2) throw new PosError('Jumlah minimal grosir harus 2 atau lebih.');
  if (tier.price <= 0) throw new PosError('Harga grosir harus lebih dari 0.');
  const now = Date.now();
  const clash = (await db.t('wholesale_prices').where('productId').equals(productId).toArray()).find((w) => live(w) && w.id !== tier.id && Number(w.minQty) === tier.minQty);
  if (clash) throw new PosError(`Sudah ada harga grosir untuk minimal ${tier.minQty}.`);
  if (tier.id) await db.t('wholesale_prices').update(tier.id, touch(now, { minQty: tier.minQty, price: tier.price }));
  else await db.t('wholesale_prices').put(fresh(now, { productId, minQty: tier.minQty, price: tier.price }));
}

export const deleteWholesale = (db: StoreDb, id: string) => softDelete(db, 'wholesale_prices', id);

// ── Penyesuaian & stok masuk ─────────────────────────────────────────────────

/** Set stok ke angka fisik (InventoryRepository.adjust): log `adjustment` sebesar selisih. */
export async function adjustStock(db: StoreDb, productId: string, variantId: string | null, newQty: number, note?: string): Promise<number> {
  return txn(db, ['products', 'product_variants', 'stock_logs'], async () => {
    const now = Date.now();
    const table = variantId ? 'product_variants' : 'products';
    const row = await db.t(table).get(variantId ?? productId);
    if (!row) throw new PosError(variantId ? 'Varian tak ditemukan.' : 'Produk tak ditemukan.');
    const change = newQty - Number(row.stock ?? 0);
    await db.t(table).update(row.id, touch(now, { stock: newQty }));
    await db.t('stock_logs').put(logRow(now, { productId, variantId, type: 'adjustment', qtyChange: change, stockAfter: newQty, refType: 'manual', note: blank(note) }));
    return change;
  });
}

/** Stok masuk produk yang sudah ada (StockInRepository, sumber existingProduct): log `in`. */
export async function stockIn(db: StoreDb, lines: Array<{ productId: string; qty: number }>): Promise<{ updated: number; totalQty: number }> {
  return txn(db, ['products', 'stock_logs'], async () => {
    const now = Date.now();
    let updated = 0;
    let totalQty = 0;
    for (const l of lines) {
      if (l.qty <= 0) continue;
      const p = await db.t('products').get(l.productId);
      if (!p) continue;
      const after = Number(p.stock ?? 0) + l.qty;
      await db.t('products').update(p.id, touch(now, { stock: after }));
      await db.t('stock_logs').put(logRow(now, { productId: p.id, type: 'in', qtyChange: l.qty, stockAfter: after, refType: 'stock_in' }));
      updated++;
      totalQty += l.qty;
    }
    return { updated, totalQty };
  });
}

// ── Kategori & satuan ────────────────────────────────────────────────────────

export async function saveCategory(db: StoreDb, c: { id?: string; name: string; sortOrder?: number }): Promise<string> {
  const now = Date.now();
  if (c.id) {
    await db.t('categories').update(c.id, touch(now, { name: c.name.trim(), ...(c.sortOrder != null ? { sortOrder: c.sortOrder } : {}) }));
    return c.id;
  }
  const r = fresh(now, { name: c.name.trim(), color: null, sortOrder: c.sortOrder ?? 0 });
  await db.t('categories').put(r);
  return r.id;
}
export const deleteCategory = (db: StoreDb, id: string) => softDelete(db, 'categories', id);

export async function saveUnit(db: StoreDb, u: { id?: string; name: string }): Promise<string> {
  const now = Date.now();
  if (u.id) {
    await db.t('units').update(u.id, touch(now, { name: u.name.trim() }));
    return u.id;
  }
  const r = fresh(now, { name: u.name.trim(), isBaseUnit: false });
  await db.t('units').put(r);
  return r.id;
}
export const deleteUnit = (db: StoreDb, id: string) => softDelete(db, 'units', id);

// ── Kedaluwarsa (ExpiryEvaluator) ────────────────────────────────────────────

export type ExpiryStatus = 'none' | 'ok' | 'nearExpiry' | 'expired';
export function expiryStatus(expiry: number | null | undefined, now: number, warningDays = 30): ExpiryStatus {
  if (expiry == null) return 'none';
  if (expiry < now) return 'expired';
  return expiry - now <= warningDays * 86_400_000 ? 'nearExpiry' : 'ok';
}

// ── Pelanggan ────────────────────────────────────────────────────────────────

export interface CustomerInput {
  name: string;
  phone?: string | null;
  address?: string | null;
  birthdate?: number | null;
  note?: string | null;
}

export async function saveCustomer(db: StoreDb, id: string | null, i: CustomerInput): Promise<string> {
  const now = Date.now();
  const cols = { name: i.name.trim(), phone: blank(i.phone), address: blank(i.address), birthdate: i.birthdate ?? null, note: blank(i.note) };
  if (id) {
    await db.t('customers').update(id, touch(now, cols));
    return id;
  }
  const r = fresh(now, { ...cols, debtBalance: 0 });
  await db.t('customers').put(r);
  return r.id;
}
export const deleteCustomer = (db: StoreDb, id: string) => softDelete(db, 'customers', id);
export const restoreCustomer = (db: StoreDb, id: string) => restore(db, 'customers', id);

/** Sisa hutang satu nota = total − dibayar saat checkout − pelunasan tertaut (≥ 0). */
export async function outstandingFor(db: StoreDb, txId: string): Promise<number> {
  const tx = await db.t('transactions').get(txId);
  if (!tx) return 0;
  const paid = (await db.t('credit_payments').where('transactionId').equals(txId).toArray()).reduce((s, c) => s + Number(c.amount ?? 0), 0);
  return Math.max(0, Number(tx.grandTotal ?? 0) - Number(tx.paidTotal ?? 0) - paid);
}

/**
 * Bayar hutang (CreditRepository.payDebt §7): catat credit_payments (FIFO ke nota kredit terbuka bila
 * tanpa nota/cicilan), tunai → pemasukan wallet kas default, cicilan diperbarui, saldo hutang dikurangi
 * (≥ 0). Atomik.
 */
export async function payDebt(
  db: StoreDb,
  p: { customerId: string; amount: number; method: PaymentMethod; transactionId?: string | null; installmentId?: string | null; note?: string | null },
): Promise<{ creditPaymentId: string; newDebtBalance: number }> {
  if (p.amount <= 0) throw new PosError('Nominal pembayaran harus lebih dari 0.');
  return txn(db, ['customers', 'installments', 'credit_payments', 'transactions', 'wallets', 'wallet_transactions', 'app_settings'], async () => {
    const now = Date.now();
    const c = await db.t('customers').get(p.customerId);
    if (!c) throw new PosError('Pelanggan tak ditemukan.');
    let inst: Row | undefined;
    if (p.installmentId) {
      inst = await db.t('installments').get(p.installmentId);
      if (!inst) throw new PosError('Cicilan tak ditemukan.');
    }
    const txId = p.transactionId ?? (inst?.transactionId as string | undefined) ?? null;

    let allocations: Array<[string | null, number]>;
    if (txId) allocations = [[txId, p.amount]];
    else {
      allocations = [];
      const open = (await db.t('transactions').where('customerId').equals(p.customerId).toArray())
        .filter((t) => live(t) && (t.status === 'credit' || t.status === 'partial'))
        .sort((a, b) => Number(a.datetime) - Number(b.datetime));
      let left = p.amount;
      for (const t of open) {
        if (left <= 0) break;
        const o = await outstandingFor(db, t.id);
        if (o <= 0) continue;
        const part = Math.min(left, o);
        allocations.push([t.id, part]);
        left -= part;
      }
      if (left > 0) allocations.push([null, left]);
    }
    let payId: string | null = null;
    for (const [tid, part] of allocations) {
      const r = fresh(now, { customerId: p.customerId, transactionId: tid, installmentId: p.installmentId ?? null, amount: part, datetime: now, method: p.method, note: blank(p.note) });
      payId ??= r.id;
      await db.t('credit_payments').put(r);
    }

    if (p.method === 'cash') {
      const walletId = await getSetting(db, KEY_DEFAULT_CASH_WALLET);
      const w = walletId ? await db.t('wallets').get(walletId) : undefined;
      if (live(w)) {
        await db.t('wallets').update(w.id, touch(now, { balance: Number(w.balance ?? 0) + p.amount }));
        await db.t('wallet_transactions').put(fresh(now, { walletId: w.id, type: 'in', amount: p.amount, targetWalletId: null, category: 'pelunasan', refType: 'credit_payment', refId: payId, note: `Pelunasan hutang ${c.name}`, datetime: now }));
      }
    }

    if (inst) {
      const paid = Number(inst.amountPaid ?? 0) + p.amount;
      await db.t('installments').update(inst.id, touch(now, { amountPaid: paid, status: paid >= Number(inst.amountDue) ? 'paid' : 'pending' }));
    }

    const newDebtBalance = Math.max(0, Number(c.debtBalance ?? 0) - p.amount);
    await db.t('customers').update(c.id, touch(now, { debtBalance: newDebtBalance }));
    return { creditPaymentId: payId!, newDebtBalance };
  });
}

/** InstallmentPlan.split: bagi rata, sisa pembagian masuk cicilan terakhir. */
export function splitInstallments(total: number, count: number, firstDueDate: number, intervalDays: number): Array<{ amountDue: number; dueDate: number }> {
  if (count <= 0) throw new PosError('Jumlah cicilan harus lebih dari 0.');
  if (total < 0) throw new PosError('Total tak boleh negatif.');
  const base = Math.floor(total / count);
  const last = total - base * (count - 1);
  return Array.from({ length: count }, (_, i) => ({ amountDue: i === count - 1 ? last : base, dueDate: firstDueDate + i * intervalDays * 86_400_000 }));
}

export async function createInstallmentPlan(db: StoreDb, txId: string, total: number, count: number, firstDueDate: number, intervalDays: number): Promise<string[]> {
  const entries = splitInstallments(total, count, firstDueDate, intervalDays);
  return txn(db, ['installments'], async () => {
    const now = Date.now();
    const existing = await db.t('installments').where('transactionId').equals(txId).toArray();
    if (existing.some((e) => Number(e.amountPaid ?? 0) > 0)) throw new PosError('Cicilan sudah berjalan (ada angsuran terbayar) — tak bisa dijadwal ulang.');
    // HP menghapus baris lama (hard delete lokal); di sini soft delete agar penghapusan ikut tersinkron.
    for (const e of existing) if (e.deletedAt == null) await db.t('installments').update(e.id, touch(now, { deletedAt: now }));
    const rows = entries.map((e) => fresh(now, { transactionId: txId, dueDate: e.dueDate, amountDue: e.amountDue, amountPaid: 0, status: 'pending' }));
    await db.t('installments').bulkPut(rows);
    return rows.map((r) => r.id);
  });
}

/** Status cicilan turunan (installmentStatusFor): lunas / lewat jatuh tempo / menunggu. */
export const installmentStatus = (i: Row, now: number) =>
  Number(i.amountPaid ?? 0) >= Number(i.amountDue ?? 0) ? 'paid' : Number(i.dueDate) < now ? 'overdue' : 'pending';

// ── Karyawan ─────────────────────────────────────────────────────────────────

export const MIN_PIN = 6;

const isAdministrator = (u: Row) => u.role === 'owner' || resolvePermissions(String(u.role), u.permissions).has('administrator');

async function ensureUsernameFree(db: StoreDb, username: string, exceptId: string | null) {
  const clash = (await db.t('users').where('username').equals(username).toArray()).find((u) => live(u) && u.id !== exceptId);
  if (clash) throw new PosError(`Username "${username}" sudah dipakai.`);
}

async function guardLastAdministrator(db: StoreDb, id: string) {
  const target = await db.t('users').get(id);
  if (!target || !isAdministrator(target)) return;
  const others = (await db.t('users').toArray()).filter((u) => live(u) && u.isActive !== false && u.id !== id && isAdministrator(u));
  if (!others.length) throw new PosError('Tak bisa menghapus/menonaktifkan administrator terakhir.');
}

export interface UserInput {
  name: string;
  username: string;
  role: Exclude<AppRole, 'owner'>;
  permissions: Set<Permission>;
  isActive: boolean;
  /** Kosong saat ubah = PIN tetap. */
  pin: string;
}

export async function saveUser(db: StoreDb, id: string | null, i: UserInput): Promise<string> {
  const username = i.username.trim();
  if (!i.name.trim()) throw new PosError('Nama wajib diisi.');
  if (!username) throw new PosError('Username wajib diisi.');
  if ((!id || i.pin) && (i.pin.length < MIN_PIN || !/^\d+$/.test(i.pin))) throw new PosError(`PIN minimal ${MIN_PIN} digit angka.`);
  const pinHash = i.pin ? await hashPin(i.pin) : null; // WebCrypto: di luar transaksi Dexie
  // Wire = array JSON (aplikasi HP men-decode string lokal sebelum push; kolom server jsonb).
  const permissions = i.role === 'custom' ? (JSON.parse(encodePermissions(i.permissions)) as string[]) : null;
  return txn(db, ['users'], async () => {
    const now = Date.now();
    await ensureUsernameFree(db, username, id);
    if (id) {
      const cur = await db.t('users').get(id);
      if (!cur) throw new PosError('Pengguna tak ditemukan.');
      if (cur.role === 'owner') {
        // Pemilik: hanya nama yang boleh diubah (sama dengan HP).
        await db.t('users').update(id, touch(now, { name: i.name.trim() }));
        return id;
      }
      if (!i.isActive) await guardLastAdministrator(db, id);
      await db.t('users').update(id, touch(now, { name: i.name.trim(), username, role: i.role, permissions, isActive: i.isActive, ...(pinHash ? { pinHash } : {}) }));
      return id;
    }
    const r = fresh(now, { name: i.name.trim(), username, pinHash, role: i.role, permissions, isActive: true });
    await db.t('users').put(r);
    return r.id;
  });
}

export async function deleteUser(db: StoreDb, id: string): Promise<void> {
  await txn(db, ['users'], async () => {
    const u = await db.t('users').get(id);
    if (u?.role === 'owner') throw new PosError('Akun pemilik tidak bisa dihapus.');
    await guardLastAdministrator(db, id);
    await softDelete(db, 'users', id);
  });
}

// ── Pengaturan ───────────────────────────────────────────────────────────────

export async function savePaymentOptions(db: StoreDb, o: PaymentOptions): Promise<void> {
  await db.setMeta('paymentOptions', { methods: ['cash', ...o.methods.filter((m) => m !== 'cash')], allowSplit: o.allowSplit });
}

export const setRequireOpenBill = (db: StoreDb, on: boolean) => setSetting(db, 'require_open_bill', on ? 'true' : 'false');
