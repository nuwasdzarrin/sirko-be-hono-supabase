/**
 * Registry tabel backup — SATU sumber kebenaran untuk pemetaan wire↔DB,
 * tipe kolom, kelas idempotency, dan urutan proses. Dipakai oleh schema (zod),
 * repository (SQL generik), dan serializer (pull).
 *
 * Kelas:
 *  - 'lww'       : mutable → UPSERT, update hanya bila updated_at lebih baru (LWW).
 *  - 'append'    : immutable → INSERT ... ON CONFLICT DO NOTHING (idempotent murni).
 *  - 'singleton' : `business` — 1 baris per toko; push = UPDATE row tenant (id=JWT),
 *                  id dari body DIABAIKAN; tak pernah membuat tenant baru.
 *
 * Kolom standar (id, created_at, updated_at, deleted_at, business_id, server_updated_at)
 * ditangani generik — TIDAK didaftarkan di `cols`.
 */

export type ColType = 'text' | 'int' | 'money' | 'bool' | 'uuid' | 'enum' | 'json';
export type TableKind = 'lww' | 'append' | 'singleton';

export interface Col {
  wire: string; // camelCase (payload)
  db: string; // snake_case (kolom Postgres)
  type: ColType;
  enum?: readonly string[];
}

export interface BackupTable {
  wire: string; // key di payload.tables
  db: string; // nama tabel Postgres
  kind: TableKind;
  cols: Col[];
}

// Pabrik kolom ringkas.
const T = (wire: string, db: string): Col => ({ wire, db, type: 'text' });
const I = (wire: string, db: string): Col => ({ wire, db, type: 'int' });
const M = (wire: string, db: string): Col => ({ wire, db, type: 'money' });
const B = (wire: string, db: string): Col => ({ wire, db, type: 'bool' });
const U = (wire: string, db: string): Col => ({ wire, db, type: 'uuid' });
const J = (wire: string, db: string): Col => ({ wire, db, type: 'json' });
const E = (wire: string, db: string, values: readonly string[]): Col => ({
  wire,
  db,
  type: 'enum',
  enum: values,
});

const METHOD = ['cash', 'qris', 'transfer', 'debit', 'ewallet', 'other'] as const;

/**
 * Urutan array = urutan proses push (master → header → detail). Tanpa FK antar
 * tenant, urutan hanya untuk kerapian & laporan.
 */
export const BACKUP_TABLES: BackupTable[] = [
  {
    wire: 'business',
    db: 'businesses',
    kind: 'singleton',
    cols: [
      T('name', 'name'),
      T('businessType', 'business_type'),
      T('address', 'address'),
      T('phone', 'phone'),
      T('logoPath', 'logo_path'),
      B('taxEnabled', 'tax_enabled'),
      I('taxPercent', 'tax_percent'),
      B('taxInclusive', 'tax_inclusive'),
      E('roundingMode', 'rounding_mode', ['none', 'nearest100', 'nearest500']),
      T('currencySymbol', 'currency_symbol'),
    ],
  },
  {
    wire: 'users',
    db: 'users',
    kind: 'lww',
    cols: [
      T('name', 'name'),
      T('username', 'username'),
      T('pinHash', 'pin_hash'),
      E('role', 'role', ['owner', 'admin', 'cashier', 'staff', 'custom', 'sirko_admin']),
      J('permissions', 'permissions'),
      B('isActive', 'is_active'),
    ],
  },
  {
    wire: 'categories',
    db: 'categories',
    kind: 'lww',
    cols: [T('name', 'name'), T('color', 'color'), I('sortOrder', 'sort_order')],
  },
  {
    wire: 'units',
    db: 'units',
    kind: 'lww',
    cols: [T('name', 'name'), B('isBaseUnit', 'is_base_unit')],
  },
  {
    wire: 'customers',
    db: 'customers',
    kind: 'lww',
    cols: [
      T('name', 'name'),
      T('phone', 'phone'),
      T('address', 'address'),
      I('birthdate', 'birthdate'),
      M('debtBalance', 'debt_balance'),
      T('note', 'note'),
    ],
  },
  {
    wire: 'products',
    db: 'products',
    kind: 'lww',
    cols: [
      T('name', 'name'),
      T('barcode', 'barcode'),
      U('categoryId', 'category_id'),
      U('unitId', 'unit_id'),
      M('costPrice', 'cost_price'),
      M('sellingPrice', 'selling_price'),
      I('stock', 'stock'),
      I('minStock', 'min_stock'),
      I('expiryDate', 'expiry_date'),
      T('imagePath', 'image_path'),
      B('hasVariants', 'has_variants'),
      B('isActive', 'is_active'),
    ],
  },
  {
    wire: 'product_variants',
    db: 'product_variants',
    kind: 'lww',
    cols: [
      U('productId', 'product_id'),
      T('name', 'name'),
      T('barcode', 'barcode'),
      M('sellingPrice', 'selling_price'),
      M('costPrice', 'cost_price'),
      I('stock', 'stock'),
    ],
  },
  {
    wire: 'wholesale_prices',
    db: 'wholesale_prices',
    kind: 'lww',
    cols: [U('productId', 'product_id'), I('minQty', 'min_qty'), M('price', 'price')],
  },
  {
    wire: 'suppliers',
    db: 'suppliers',
    kind: 'lww',
    cols: [
      T('name', 'name'),
      T('phone', 'phone'),
      T('address', 'address'),
      M('debtBalance', 'debt_balance'),
      T('note', 'note'),
    ],
  },
  {
    wire: 'wallets',
    db: 'wallets',
    kind: 'lww',
    cols: [T('name', 'name'), M('balance', 'balance'), E('type', 'type', ['cash', 'bank', 'ewallet'])],
  },
  {
    wire: 'receipt_presets',
    db: 'receipt_presets',
    kind: 'lww',
    cols: [
      T('name', 'name'),
      E('paperSize', 'paper_size', ['mm58', 'mm80']),
      B('showLogo', 'show_logo'),
      T('headerText', 'header_text'),
      T('footerText', 'footer_text'),
      B('showAddress', 'show_address'),
      B('showCashier', 'show_cashier'),
      B('isDefault', 'is_default'),
    ],
  },
  {
    wire: 'discounts',
    db: 'discounts',
    kind: 'lww',
    cols: [
      T('name', 'name'),
      E('type', 'type', ['percent', 'nominal']),
      M('value', 'value'),
      E('scope', 'scope', ['item', 'transaction']),
      B('isActive', 'is_active'),
    ],
  },
  {
    wire: 'app_settings',
    db: 'app_settings',
    kind: 'lww',
    cols: [T('key', 'key'), T('value', 'value')],
  },
  {
    wire: 'transactions',
    db: 'transactions',
    kind: 'lww',
    cols: [
      T('invoiceNo', 'invoice_no'),
      I('datetime', 'datetime'),
      U('cashierId', 'cashier_id'),
      U('customerId', 'customer_id'),
      U('billId', 'bill_id'),
      M('subtotal', 'subtotal'),
      M('discountTotal', 'discount_total'),
      M('taxTotal', 'tax_total'),
      M('grandTotal', 'grand_total'),
      M('paidTotal', 'paid_total'),
      M('changeTotal', 'change_total'),
      E('status', 'status', ['paid', 'credit', 'partial', 'void']),
      B('isCredit', 'is_credit'),
      T('note', 'note'),
    ],
  },
  {
    wire: 'installments',
    db: 'installments',
    kind: 'lww',
    cols: [
      U('transactionId', 'transaction_id'),
      I('dueDate', 'due_date'),
      M('amountDue', 'amount_due'),
      M('amountPaid', 'amount_paid'),
      E('status', 'status', ['pending', 'paid', 'overdue']),
    ],
  },
  {
    wire: 'purchases',
    db: 'purchases',
    kind: 'lww',
    cols: [
      T('refNo', 'ref_no'),
      U('supplierId', 'supplier_id'),
      I('datetime', 'datetime'),
      M('subtotal', 'subtotal'),
      M('discountTotal', 'discount_total'),
      M('grandTotal', 'grand_total'),
      M('paidTotal', 'paid_total'),
      E('status', 'status', ['paid', 'credit', 'partial']),
      T('note', 'note'),
    ],
  },
  {
    wire: 'stock_opnames',
    db: 'stock_opnames',
    kind: 'lww',
    cols: [
      T('refNo', 'ref_no'),
      I('datetime', 'datetime'),
      U('userId', 'user_id'),
      E('status', 'status', ['draft', 'finalized']),
      T('note', 'note'),
    ],
  },
  // ── Append-only (immutable) ──────────────────────────────────────────────────
  {
    wire: 'transaction_items',
    db: 'transaction_items',
    kind: 'append',
    cols: [
      U('transactionId', 'transaction_id'),
      U('productId', 'product_id'),
      U('variantId', 'variant_id'),
      T('nameSnapshot', 'name_snapshot'),
      I('qty', 'qty'),
      M('unitPrice', 'unit_price'),
      M('costPriceSnapshot', 'cost_price_snapshot'),
      M('discount', 'discount'),
      M('lineTotal', 'line_total'),
    ],
  },
  {
    wire: 'payments',
    db: 'payments',
    kind: 'append',
    cols: [
      U('transactionId', 'transaction_id'),
      E('method', 'method', METHOD),
      M('amount', 'amount'),
      T('refNote', 'ref_note'),
    ],
  },
  {
    wire: 'stock_logs',
    db: 'stock_logs',
    kind: 'append',
    cols: [
      U('productId', 'product_id'),
      U('variantId', 'variant_id'),
      E('type', 'type', ['in', 'out', 'adjustment', 'sale', 'void', 'initial']),
      I('qtyChange', 'qty_change'),
      I('stockAfter', 'stock_after'),
      T('refType', 'ref_type'),
      U('refId', 'ref_id'),
      T('note', 'note'),
    ],
  },
  {
    wire: 'wallet_transactions',
    db: 'wallet_transactions',
    kind: 'append',
    cols: [
      U('walletId', 'wallet_id'),
      E('type', 'type', ['in', 'out', 'transfer']),
      M('amount', 'amount'),
      U('targetWalletId', 'target_wallet_id'),
      T('category', 'category'),
      T('refType', 'ref_type'),
      U('refId', 'ref_id'),
      T('note', 'note'),
      I('datetime', 'datetime'),
    ],
  },
  {
    wire: 'credit_payments',
    db: 'credit_payments',
    kind: 'append',
    cols: [
      U('customerId', 'customer_id'),
      U('transactionId', 'transaction_id'),
      U('installmentId', 'installment_id'),
      M('amount', 'amount'),
      I('datetime', 'datetime'),
      E('method', 'method', METHOD),
      T('note', 'note'),
    ],
  },
  {
    wire: 'purchase_items',
    db: 'purchase_items',
    kind: 'append',
    cols: [
      U('purchaseId', 'purchase_id'),
      U('productId', 'product_id'),
      U('variantId', 'variant_id'),
      T('nameSnapshot', 'name_snapshot'),
      I('qty', 'qty'),
      M('costPrice', 'cost_price'),
      M('lineTotal', 'line_total'),
    ],
  },
  {
    wire: 'stock_opname_items',
    db: 'stock_opname_items',
    kind: 'append',
    cols: [
      U('opnameId', 'opname_id'),
      U('productId', 'product_id'),
      U('variantId', 'variant_id'),
      I('systemQty', 'system_qty'),
      I('physicalQty', 'physical_qty'),
      I('diff', 'diff'),
    ],
  },
];

/** Versi skema tertinggi yang didukung server (spec 10 §7). */
export const SUPPORTED_SCHEMA_VERSION = 8;

export const BACKUP_TABLE_BY_WIRE: Map<string, BackupTable> = new Map(
  BACKUP_TABLES.map((t) => [t.wire, t]),
);

export const BACKUP_WIRE_NAMES: string[] = BACKUP_TABLES.map((t) => t.wire);
