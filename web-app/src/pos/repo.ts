import type { HeldSale, Row, StoreDb } from '../db/db';
import { uuid } from '../lib/crypto';
import { NO_CONFIG, resolvePayment, type CartLine, type PaymentEntry, type PaymentMethod, type PosConfig, type RoundingMode, type Totals, type WholesaleTier } from './calc';

/**
 * Penulisan data kasir — salinan perilaku aplikasi Flutter agar baris yang di-sync identik:
 *   commitSale       TransactionRepository.commit         (lib/features/pos/data/transaction_repository.dart)
 *   voidTransaction  CreditRepository.voidTransaction     (lib/features/customers/data/credit_repository.dart)
 *   kas penjualan    WalletRepository.recordCashSale / reverseForTransaction / ensureDefaultCashWallet
 *   shift            BillRepository (open/close, expectedCash net laci §10)
 * Setiap operasi tulis = SATU transaksi Dexie (atomik). Baris yang diubah ditandai `_dirty = 1`.
 */

export class PosError extends Error {}

const COMMIT_TABLES = [
  'products', 'product_variants', 'transactions', 'transaction_items', 'payments', 'stock_logs',
  'wallets', 'wallet_transactions', 'customers', 'app_settings', 'bills', 'credit_payments', '_meta',
];

const live = (r: Row | undefined): r is Row => !!r && r.deletedAt == null;

/** Baris baru dalam bentuk wire (camelCase) + penanda belum di-push. */
const fresh = (now: number, cols: Record<string, unknown>): Row => ({ id: uuid(), createdAt: now, updatedAt: now, deletedAt: null, ...cols, _dirty: 1 });

const touch = (now: number, patch: Record<string, unknown>) => ({ ...patch, updatedAt: now, _dirty: 1 });

// ── Pengaturan toko (app_settings) ───────────────────────────────────────────

export const KEY_DEFAULT_CASH_WALLET = 'default_cash_wallet_id';
export const KEY_ALLOW_NEGATIVE_STOCK = 'allow_negative_stock';
export const KEY_REQUIRE_OPEN_BILL = 'require_open_bill';

export async function getSetting(db: StoreDb, key: string): Promise<string | null> {
  const rows = (await db.t('app_settings').where('key').equals(key).toArray()).filter(live);
  rows.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
  const v = rows[0]?.value;
  return v == null ? null : String(v);
}

export async function getBool(db: StoreDb, key: string, orElse = false): Promise<boolean> {
  const v = await getSetting(db, key);
  return v == null ? orElse : v === 'true' || v === '1';
}

export async function setSetting(db: StoreDb, key: string, value: string, now = Date.now()): Promise<void> {
  const row = (await db.t('app_settings').where('key').equals(key).toArray()).find(live);
  if (row) await db.t('app_settings').update(row.id, touch(now, { value }));
  else await db.t('app_settings').put(fresh(now, { key, value }));
}

/** Opsi bayar khusus perangkat (di HP juga lokal, tak ikut sync): metode tampil & boleh split. */
export interface PaymentOptions {
  methods: PaymentMethod[];
  allowSplit: boolean;
}

export async function paymentOptions(db: StoreDb): Promise<PaymentOptions> {
  return (await db.meta<PaymentOptions>('paymentOptions')) ?? { methods: ['cash', 'qris', 'transfer', 'debit', 'ewallet', 'other'], allowSplit: true };
}

// ── Konfigurasi toko ─────────────────────────────────────────────────────────

export interface StoreInfo {
  name: string;
  address: string | null;
  phone: string | null;
  config: PosConfig;
}

export async function storeInfo(db: StoreDb, fallbackName: string): Promise<StoreInfo> {
  const b = (await db.t('business').toArray())[0];
  if (!b) return { name: fallbackName, address: null, phone: null, config: NO_CONFIG };
  return {
    name: String(b.name ?? fallbackName),
    address: (b.address as string) || null,
    phone: (b.phone as string) || null,
    config: {
      taxEnabled: b.taxEnabled === true,
      taxPercent: Number(b.taxPercent ?? 0),
      taxInclusive: b.taxInclusive === true,
      roundingMode: ((b.roundingMode as RoundingMode) ?? 'none') as RoundingMode,
    },
  };
}

export async function tiersFor(db: StoreDb, productId: string): Promise<WholesaleTier[]> {
  return (await db.t('wholesale_prices').where('productId').equals(productId).toArray())
    .filter(live)
    .map((r) => ({ minQty: Number(r.minQty ?? 0), price: Number(r.price ?? 0) }));
}

// ── Wallet kas default ───────────────────────────────────────────────────────

/** Sama dengan `ensureDefaultCashWallet`: setting valid → pakai; else wallet cash pertama; else buat "Kas Utama". */
export async function ensureDefaultCashWallet(db: StoreDb, now = Date.now()): Promise<string> {
  const existing = await getSetting(db, KEY_DEFAULT_CASH_WALLET);
  if (existing && live(await db.t('wallets').get(existing))) return existing;
  const cash = (await db.t('wallets').toArray()).filter((w) => live(w) && w.type === 'cash').sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
  let id = cash[0]?.id;
  if (!id) {
    const w = fresh(now, { name: 'Kas Utama', balance: 0, type: 'cash' });
    await db.t('wallets').put(w);
    id = w.id;
  }
  await setSetting(db, KEY_DEFAULT_CASH_WALLET, id, now);
  return id;
}

async function walletIncome(db: StoreDb, now: number, amount: number, cols: { category: string; refType: string; refId: string; note: string }) {
  if (amount <= 0) return;
  const walletId = await getSetting(db, KEY_DEFAULT_CASH_WALLET);
  if (!walletId) return;
  const w = await db.t('wallets').get(walletId);
  if (!live(w)) return;
  await db.t('wallets').update(walletId, touch(now, { balance: Number(w.balance ?? 0) + amount }));
  await db.t('wallet_transactions').put(fresh(now, { walletId, type: 'in', amount, targetWalletId: null, ...cols, datetime: now }));
}

// ── Nomor invoice ────────────────────────────────────────────────────────────

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
export const localYmd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

/** `INV-YYYYMMDD-NNNN`: counter harian perangkat, dilanjutkan dari nota hari ini yang sudah ada (§8). */
async function nextInvoiceNo(db: StoreDb, nowDate: Date): Promise<string> {
  const ymd = localYmd(nowDate);
  const key = `invoice_seq_${ymd}`;
  const prefix = `INV-${ymd}-`;
  const counter = Number((await db.meta<number>(key)) ?? 0);
  let existing = 0;
  await db.t('transactions').where('invoiceNo').startsWith(prefix).each((r) => {
    const n = parseInt(String(r.invoiceNo).slice(prefix.length), 10);
    if (Number.isFinite(n) && n > existing) existing = n;
  });
  const seq = Math.max(counter, existing) + 1;
  await db.setMeta(key, seq);
  return `${prefix}${pad(seq, 4)}`;
}

// ── Commit penjualan ─────────────────────────────────────────────────────────

export interface CommitRequest {
  totals: Totals;
  payments: PaymentEntry[];
  customerId?: string | null;
  cashierId?: string | null;
  billId?: string | null;
  note?: string | null;
  /** Izinkan kurang bayar (kasbon/partial) — sisa jadi hutang pelanggan. */
  allowCredit?: boolean;
  now?: number;
}

export interface CommitResult {
  transactionId: string;
  invoiceNo: string;
  grandTotal: number;
  change: number;
}

const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export async function commitSale(db: StoreDb, req: CommitRequest): Promise<CommitResult> {
  const t = req.totals;
  if (!t.lineResults.length) throw new PosError('Keranjang kosong.');
  const pay = resolvePayment(t.grandTotal, req.payments);
  if (pay.nonCashTotal > t.grandTotal) throw new PosError('Pembayaran non-tunai melebihi total. Kembalian hanya bisa dari tunai.');
  const isCredit = pay.status !== 'paid';
  if (isCredit && !req.allowCredit) throw new PosError('Pembayaran kurang dari total.');
  if (isCredit && !req.customerId) throw new PosError('Transaksi kredit/partial wajib memilih pelanggan.');

  return db.transaction('rw', COMMIT_TABLES.map((n) => db.table(n)), async () => {
    const now = req.now ?? Date.now();
    const allowNegative = await getBool(db, KEY_ALLOW_NEGATIVE_STOCK);

    // 1. Validasi stok (segar dari DB dalam transaksi ini). Baris bervarian → stok varian.
    const products = new Map<string, Row>();
    const variants = new Map<string, Row>();
    const need = new Map<string, number>(); // qty total per sumber stok (baris ganda produk sama)
    for (const r of t.lineResults) {
      const l = r.line;
      const k = l.variantId ? `v:${l.variantId}` : `p:${l.productId}`;
      need.set(k, (need.get(k) ?? 0) + l.qty);
      let available: number;
      if (l.variantId) {
        const v = await db.t('product_variants').get(l.variantId);
        if (!v) throw new PosError(`Varian "${l.nameSnapshot}" tak ditemukan.`);
        variants.set(l.variantId, v);
        available = Number(v.stock ?? 0);
      } else {
        const p = await db.t('products').get(l.productId);
        if (!p) throw new PosError(`Produk "${l.nameSnapshot}" tak ditemukan.`);
        products.set(l.productId, p);
        available = Number(p.stock ?? 0);
      }
      if (!allowNegative && available < need.get(k)!) {
        throw new PosError(`Stok "${l.nameSnapshot}" tidak cukup (tersedia ${available}, diminta ${need.get(k)}).`);
      }
    }

    // 2. Nomor invoice.
    const invoiceNo = await nextInvoiceNo(db, new Date(now));

    // 3. Nota.
    const tx = fresh(now, {
      invoiceNo,
      datetime: now,
      cashierId: isUuid(req.cashierId) ? req.cashierId : null,
      customerId: req.customerId ?? null,
      billId: req.billId ?? null,
      subtotal: t.subtotal,
      discountTotal: t.discountTotal,
      taxTotal: t.taxTotal,
      grandTotal: t.grandTotal,
      paidTotal: pay.paidTotal,
      changeTotal: pay.change,
      roundingAdjustment: t.roundingAdjustment,
      status: pay.status,
      isCredit,
      note: req.note?.trim() ? req.note.trim() : null,
    });
    await db.t('transactions').put(tx);

    // 4. Item (snapshot). 5. Pembayaran (split).
    await db.t('transaction_items').bulkPut(
      // createdAt +i ms: urutan item di struk/detail tetap seperti di keranjang.
      t.lineResults.map((r, i) =>
        fresh(now + i, {
          transactionId: tx.id,
          productId: r.line.productId,
          variantId: r.line.variantId ?? null,
          nameSnapshot: r.line.nameSnapshot,
          qty: r.line.qty,
          unitPrice: r.effectiveUnitPrice,
          costPriceSnapshot: r.line.costPriceSnapshot,
          discount: r.discount,
          lineTotal: r.lineTotal,
        }),
      ),
    );
    await db.t('payments').bulkPut(req.payments.map((p) => fresh(now, { transactionId: tx.id, method: p.method, amount: p.amount, refNote: p.refNote ?? null })));

    // 6. Kurangi stok + stock_logs (sale).
    for (const r of t.lineResults) {
      const l = r.line;
      let stockAfter: number;
      if (l.variantId) {
        const v = variants.get(l.variantId)!;
        stockAfter = Number(v.stock ?? 0) - l.qty;
        v.stock = stockAfter;
        await db.t('product_variants').update(l.variantId, touch(now, { stock: stockAfter }));
      } else {
        const p = products.get(l.productId)!;
        stockAfter = Number(p.stock ?? 0) - l.qty;
        p.stock = stockAfter;
        await db.t('products').update(l.productId, touch(now, { stock: stockAfter }));
      }
      await db.t('stock_logs').put(
        fresh(now, { productId: l.productId, variantId: l.variantId ?? null, type: 'sale', qtyChange: -l.qty, stockAfter, refType: 'transaction', refId: tx.id, note: `Penjualan ${invoiceNo}` }),
      );
    }

    // 7. Tunai bersih laci (Σ tunai − kembalian) → pemasukan wallet kas default.
    const netCash = pay.cashTotal - pay.change;
    if (netCash > 0) {
      if (!(await getSetting(db, KEY_DEFAULT_CASH_WALLET))) await ensureDefaultCashWallet(db, now);
      await walletIncome(db, now, netCash, { category: 'penjualan', refType: 'transaction', refId: tx.id, note: `Penjualan tunai ${invoiceNo}` });
    }

    // 8. Kredit/partial: sisa menambah hutang pelanggan.
    if (isCredit && pay.remaining > 0) {
      const c = await db.t('customers').get(req.customerId!);
      if (!c) throw new PosError('Pelanggan tak ditemukan.');
      await db.t('customers').update(c.id, touch(now, { debtBalance: Number(c.debtBalance ?? 0) + pay.remaining }));
    }

    return { transactionId: tx.id, invoiceNo, grandTotal: t.grandTotal, change: pay.change };
  });
}

// ── Void (§6) ────────────────────────────────────────────────────────────────

export async function voidTransaction(db: StoreDb, transactionId: string, now = Date.now()): Promise<{ debtReversed: number }> {
  return db.transaction('rw', COMMIT_TABLES.map((n) => db.table(n)), async () => {
    const tx = await db.t('transactions').get(transactionId);
    if (!tx) throw new PosError('Transaksi tak ditemukan.');
    if (tx.status === 'void') throw new PosError('Transaksi sudah dibatalkan.');

    // 1. Kembalikan stok per item (+qty, stock_logs void).
    const items = await db.t('transaction_items').where('transactionId').equals(transactionId).toArray();
    for (const it of items) {
      const table = it.variantId ? 'product_variants' : it.productId ? 'products' : null;
      const id = (it.variantId ?? it.productId) as string | null;
      if (!table || !id) continue;
      const row = await db.t(table).get(id);
      if (!row) continue; // terhapus → lewati aman
      const stockAfter = Number(row.stock ?? 0) + Number(it.qty);
      await db.t(table).update(id, touch(now, { stock: stockAfter }));
      await db.t('stock_logs').put(
        fresh(now, { productId: it.productId ?? null, variantId: it.variantId ?? null, type: 'void', qtyChange: Number(it.qty), stockAfter, refType: 'transaction', refId: transactionId, note: `Void ${tx.invoiceNo}` }),
      );
    }

    // 2. Kredit/partial: kurangi hutang sebesar sisa nota (− pelunasan yang tertaut nota ini).
    let debtReversed = 0;
    if ((tx.status === 'credit' || tx.status === 'partial') && tx.customerId) {
      const paidToTx = (await db.t('credit_payments').where('transactionId').equals(transactionId).toArray()).reduce((s, c) => s + Number(c.amount ?? 0), 0);
      debtReversed = Math.max(0, Number(tx.grandTotal) - Number(tx.paidTotal) - paidToTx);
      if (debtReversed > 0) {
        const c = await db.t('customers').get(String(tx.customerId));
        if (c) await db.t('customers').update(c.id, touch(now, { debtBalance: Math.max(0, Number(c.debtBalance ?? 0) - debtReversed) }));
      }
    }

    // 2b. Balik pemasukan wallet dari penjualan tunai nota ini.
    const muts = (await db.t('wallet_transactions').where('refId').equals(transactionId).toArray()).filter(
      (m) => live(m) && m.refType === 'transaction' && m.type === 'in',
    );
    for (const m of muts) {
      const w = await db.t('wallets').get(String(m.walletId));
      if (!w) continue;
      await db.t('wallets').update(w.id, touch(now, { balance: Number(w.balance ?? 0) - Number(m.amount) }));
      await db.t('wallet_transactions').put(
        fresh(now, { walletId: w.id, type: 'out', amount: Number(m.amount), targetWalletId: null, category: 'penjualan', refType: 'void', refId: transactionId, note: `Void ${tx.invoiceNo}`, datetime: now }),
      );
    }

    // 3. Tandai void + soft delete (jejak audit).
    await db.t('transactions').update(transactionId, touch(now, { status: 'void', deletedAt: now }));
    return { debtReversed };
  });
}

// ── Shift / bill (§10) ───────────────────────────────────────────────────────

export async function openBillFor(db: StoreDb, employeeId: string): Promise<Row | null> {
  return (await db.t('bills').where('employeeId').equals(employeeId).toArray()).find((b) => live(b) && b.status === 'open') ?? null;
}

export async function openBill(db: StoreDb, employeeId: string, openingCash: number, note?: string): Promise<string> {
  if (!isUuid(employeeId)) throw new PosError('Akun ini belum tersinkron. Sinkronkan dulu lalu coba lagi.');
  return db.transaction('rw', db.t('bills'), async () => {
    if (await openBillFor(db, employeeId)) throw new PosError('Masih ada shift terbuka. Tutup dulu.');
    const now = Date.now();
    const b = fresh(now, { employeeId, openedAt: now, closedAt: null, openingCash, closingCash: null, expectedCash: null, cashSalesTotal: null, variance: null, status: 'open', note: note?.trim() || null });
    await db.t('bills').put(b);
    return b.id;
  });
}

export interface BillSummary {
  openingCash: number;
  cashIn: number;
  changeGiven: number;
  netCashSales: number;
  expectedCash: number;
  txCount: number;
}

export async function billSummary(db: StoreDb, billId: string): Promise<BillSummary> {
  const bill = await db.t('bills').get(billId);
  if (!bill) throw new PosError('Shift tak ditemukan.');
  const txs = (await db.t('transactions').where('billId').equals(billId).toArray()).filter((t) => live(t) && t.status !== 'void');
  let cashIn = 0;
  let changeGiven = 0;
  for (const t of txs) {
    changeGiven += Number(t.changeTotal ?? 0);
    for (const p of await db.t('payments').where('transactionId').equals(t.id).toArray()) if (p.method === 'cash') cashIn += Number(p.amount ?? 0);
  }
  const openingCash = Number(bill.openingCash ?? 0);
  return { openingCash, cashIn, changeGiven, netCashSales: cashIn - changeGiven, expectedCash: openingCash + cashIn - changeGiven, txCount: txs.length };
}

export async function closeBill(db: StoreDb, billId: string, closingCash: number, note?: string): Promise<Row> {
  return db.transaction('rw', ['bills', 'transactions', 'payments'].map((n) => db.table(n)), async () => {
    const bill = await db.t('bills').get(billId);
    if (!bill) throw new PosError('Shift tak ditemukan.');
    if (bill.status !== 'open') throw new PosError('Shift sudah ditutup.');
    const s = await billSummary(db, billId);
    const now = Date.now();
    await db.t('bills').update(
      billId,
      touch(now, {
        closedAt: now,
        closingCash,
        expectedCash: s.expectedCash,
        cashSalesTotal: s.netCashSales,
        variance: closingCash - s.expectedCash,
        status: 'closed',
        ...(note?.trim() ? { note: note.trim() } : {}),
      }),
    );
    return (await db.t('bills').get(billId))!;
  });
}

// ── Tunda (lokal perangkat) ──────────────────────────────────────────────────

export interface CartSnapshot {
  lines: CartLine[];
  txDiscountType: 'percent' | 'nominal';
  txDiscountValue: number;
  customerId: string | null;
  note: string;
}

export async function holdSale(db: StoreDb, cart: CartSnapshot, total: number, cashierId: string | null, label?: string): Promise<string> {
  const now = Date.now();
  const n = (await db.held_sales.count()) + 1;
  const d = new Date(now);
  const h: HeldSale = {
    id: uuid(),
    label: label?.trim() || `Tunda #${n} • ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    cashierId,
    cart,
    itemCount: cart.lines.reduce((s, l) => s + l.qty, 0),
    total,
    createdAt: now,
  };
  await db.held_sales.put(h);
  return h.id;
}

/** Ambil & hapus (dilanjutkan ke keranjang). */
export async function resumeHeld(db: StoreDb, id: string): Promise<CartSnapshot | null> {
  return db.transaction('rw', db.held_sales, async () => {
    const h = await db.held_sales.get(id);
    if (!h) return null;
    await db.held_sales.delete(id);
    return h.cart as CartSnapshot;
  });
}
