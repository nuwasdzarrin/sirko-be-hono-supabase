-- 0002_tenant_backup_tables.sql — Fitur 1 (Backup): cermin tabel milik-toko.
--
-- Filosofi: server = mirror generik. Kolom domain SENGAJA nullable → server
-- "hanya menyimpan, tak menghakimi" (spec 08 §1) sehingga insert tak pernah gagal
-- karena nilai bisnis. Hanya id/business_id/updated_at/server_updated_at yang wajib.
-- Enum = text + CHECK (null-toleran; validasi nilai dilakukan zod di layanan).
-- Uang & waktu = bigint (aman < 2^53). qty = integer (boleh negatif). TANPA FK
-- antar-entitas tenant (device pemegang integritas). business_id → FK businesses.
-- Index: (business_id, server_updated_at, id) pull; (business_id, id) upsert.
-- Idempotent (IF NOT EXISTS) & maju-saja.

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name text,
  color text,
  sort_order integer,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_categories_pull ON categories (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_categories_bid ON categories (business_id, id);

CREATE TABLE IF NOT EXISTS units (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name text,
  is_base_unit boolean,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_units_pull ON units (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_units_bid ON units (business_id, id);

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name text,
  phone text,
  address text,
  birthdate bigint,
  debt_balance bigint,
  note text,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customers_pull ON customers (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_customers_bid ON customers (business_id, id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (business_id, phone);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name text,
  barcode text,
  category_id uuid,
  unit_id uuid,
  cost_price bigint,
  selling_price bigint,
  stock integer,
  min_stock integer,
  expiry_date bigint,
  image_path text,
  has_variants boolean,
  is_active boolean,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_pull ON products (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_products_bid ON products (business_id, id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (business_id, barcode);

CREATE TABLE IF NOT EXISTS product_variants (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id uuid,
  name text,
  barcode text,
  selling_price bigint,
  cost_price bigint,
  stock integer,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_variants_pull ON product_variants (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_product_variants_bid ON product_variants (business_id, id);

CREATE TABLE IF NOT EXISTS wholesale_prices (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id uuid,
  min_qty integer,
  price bigint,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wholesale_prices_pull ON wholesale_prices (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_wholesale_prices_bid ON wholesale_prices (business_id, id);

CREATE TABLE IF NOT EXISTS stock_logs (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id uuid,
  variant_id uuid,
  type text CHECK (type IS NULL OR type IN ('in', 'out', 'adjustment', 'sale', 'void', 'initial')),
  qty_change integer,
  stock_after integer,
  ref_type text,
  ref_id uuid,
  note text,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_logs_pull ON stock_logs (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_stock_logs_bid ON stock_logs (business_id, id);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  invoice_no text,
  datetime bigint,
  cashier_id uuid,
  customer_id uuid,
  bill_id uuid,
  subtotal bigint,
  discount_total bigint,
  tax_total bigint,
  grand_total bigint,
  paid_total bigint,
  change_total bigint,
  status text CHECK (status IS NULL OR status IN ('paid', 'credit', 'partial', 'void')),
  is_credit boolean,
  note text,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transactions_pull ON transactions (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_transactions_bid ON transactions (business_id, id);
CREATE INDEX IF NOT EXISTS idx_transactions_invoice ON transactions (business_id, invoice_no);

CREATE TABLE IF NOT EXISTS transaction_items (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  transaction_id uuid,
  product_id uuid,
  variant_id uuid,
  name_snapshot text,
  qty integer,
  unit_price bigint,
  cost_price_snapshot bigint,
  discount bigint,
  line_total bigint,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transaction_items_pull ON transaction_items (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_transaction_items_bid ON transaction_items (business_id, id);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  transaction_id uuid,
  method text CHECK (method IS NULL OR method IN ('cash', 'qris', 'transfer', 'debit', 'ewallet', 'other')),
  amount bigint,
  ref_note text,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_pull ON payments (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_payments_bid ON payments (business_id, id);

CREATE TABLE IF NOT EXISTS installments (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  transaction_id uuid,
  due_date bigint,
  amount_due bigint,
  amount_paid bigint,
  status text CHECK (status IS NULL OR status IN ('pending', 'paid', 'overdue')),
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_installments_pull ON installments (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_installments_bid ON installments (business_id, id);

CREATE TABLE IF NOT EXISTS credit_payments (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  customer_id uuid,
  transaction_id uuid,
  installment_id uuid,
  amount bigint,
  datetime bigint,
  method text CHECK (method IS NULL OR method IN ('cash', 'qris', 'transfer', 'debit', 'ewallet', 'other')),
  note text,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_payments_pull ON credit_payments (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_credit_payments_bid ON credit_payments (business_id, id);

CREATE TABLE IF NOT EXISTS wallets (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name text,
  balance bigint,
  type text CHECK (type IS NULL OR type IN ('cash', 'bank', 'ewallet')),
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wallets_pull ON wallets (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_wallets_bid ON wallets (business_id, id);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  wallet_id uuid,
  type text CHECK (type IS NULL OR type IN ('in', 'out', 'transfer')),
  amount bigint,
  target_wallet_id uuid,
  category text,
  ref_type text,
  ref_id uuid,
  note text,
  datetime bigint,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_pull ON wallet_transactions (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_bid ON wallet_transactions (business_id, id);

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name text,
  phone text,
  address text,
  debt_balance bigint,
  note text,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_pull ON suppliers (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_suppliers_bid ON suppliers (business_id, id);

CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  ref_no text,
  supplier_id uuid,
  datetime bigint,
  subtotal bigint,
  discount_total bigint,
  grand_total bigint,
  paid_total bigint,
  status text CHECK (status IS NULL OR status IN ('paid', 'credit', 'partial')),
  note text,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchases_pull ON purchases (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_purchases_bid ON purchases (business_id, id);

CREATE TABLE IF NOT EXISTS purchase_items (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  purchase_id uuid,
  product_id uuid,
  variant_id uuid,
  name_snapshot text,
  qty integer,
  cost_price bigint,
  line_total bigint,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_pull ON purchase_items (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_bid ON purchase_items (business_id, id);

CREATE TABLE IF NOT EXISTS stock_opnames (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  ref_no text,
  datetime bigint,
  user_id uuid,
  status text CHECK (status IS NULL OR status IN ('draft', 'finalized')),
  note text,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_opnames_pull ON stock_opnames (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_stock_opnames_bid ON stock_opnames (business_id, id);

CREATE TABLE IF NOT EXISTS stock_opname_items (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  opname_id uuid,
  product_id uuid,
  variant_id uuid,
  system_qty integer,
  physical_qty integer,
  diff integer,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_opname_items_pull ON stock_opname_items (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_stock_opname_items_bid ON stock_opname_items (business_id, id);

CREATE TABLE IF NOT EXISTS receipt_presets (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name text,
  paper_size text CHECK (paper_size IS NULL OR paper_size IN ('mm58', 'mm80')),
  show_logo boolean,
  header_text text,
  footer_text text,
  show_address boolean,
  show_cashier boolean,
  is_default boolean,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_receipt_presets_pull ON receipt_presets (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_receipt_presets_bid ON receipt_presets (business_id, id);

CREATE TABLE IF NOT EXISTS discounts (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name text,
  type text CHECK (type IS NULL OR type IN ('percent', 'nominal')),
  value bigint,
  scope text CHECK (scope IS NULL OR scope IN ('item', 'transaction')),
  is_active boolean,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_discounts_pull ON discounts (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_discounts_bid ON discounts (business_id, id);

CREATE TABLE IF NOT EXISTS app_settings (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  key text,
  value text,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_settings_pull ON app_settings (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_app_settings_bid ON app_settings (business_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_settings_key
  ON app_settings (business_id, key) WHERE deleted_at IS NULL AND key IS NOT NULL;

-- Idempotency-Key opsional (spec 10 §2.1/§7) — respons identik untuk retry batch.
CREATE TABLE IF NOT EXISTS backup_idempotency (
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  key text NOT NULL,
  response jsonb NOT NULL,
  created_at bigint NOT NULL,
  PRIMARY KEY (business_id, key)
);

-- RLS jaring pengaman (session-var, portabel; sama pola 0001).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories','units','customers','products','product_variants','wholesale_prices',
    'stock_logs','transactions','transaction_items','payments','installments','credit_payments',
    'wallets','wallet_transactions','suppliers','purchases','purchase_items','stock_opnames',
    'stock_opname_items','receipt_presets','discounts','app_settings'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (business_id::text = current_setting(''app.business_id'', true))',
      t
    );
  END LOOP;
END $$;
