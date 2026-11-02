-- 0005_schema_v10.sql — Selaraskan cermin backup dengan skema app v10.
--
-- Celah yang ditutup (app → server):
--   - `bills` (shift kasir, app v6) belum dicerminkan, padahal `transactions.bill_id`
--     merujuknya → restore kehilangan data shift.
--   - `products.needs_price` (app v10), `transactions.rounding_adjustment`,
--     `stock_opname_items.name_snapshot` belum ada → nilai di-strip diam-diam saat push.
-- Sengaja TIDAK dicerminkan: `held_sales`/`held_sale_items` (local-only, state
-- operasional sementara) & `public_products`/thumbs (cache katalog global).
--
-- Konvensi sama 0002: kolom domain nullable, tanpa FK antar-entitas tenant.
-- Idempotent (IF NOT EXISTS) & maju-saja.

ALTER TABLE products ADD COLUMN IF NOT EXISTS needs_price boolean;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS rounding_adjustment bigint;
ALTER TABLE stock_opname_items ADD COLUMN IF NOT EXISTS name_snapshot text;

CREATE TABLE IF NOT EXISTS bills (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  employee_id uuid,
  opened_at bigint,
  closed_at bigint,
  opening_cash bigint,
  closing_cash bigint,
  expected_cash bigint,
  cash_sales_total bigint,
  variance bigint,
  status text CHECK (status IS NULL OR status IN ('open', 'closed')),
  note text,
  created_at bigint,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bills_pull ON bills (business_id, server_updated_at, id);
CREATE INDEX IF NOT EXISTS idx_bills_bid ON bills (business_id, id);

ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bills;
CREATE POLICY tenant_isolation ON bills
  USING (business_id::text = current_setting('app.business_id', true));
