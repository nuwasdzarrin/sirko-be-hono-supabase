-- 0009_ppob.sql — PPOB: katalog produk & order (pulsa/data via Digiflazz; PLN manual menyusul).
--
-- Server = sumber kebenaran (bukan cermin backup). Pembayaran memakai Poin Sirko
-- (point_ledger, ref_type 'ppob_order', ref_id = ppob_orders.id).
-- Uang = bigint rupiah; waktu = bigint epoch ms.
-- Rancangan: docs/superpowers/specs/2026-11-02-ppob-poin-design.md §5, §7, §12.

CREATE TABLE IF NOT EXISTS ppob_products (
  id              uuid PRIMARY KEY,
  provider        text NOT NULL CHECK (provider IN ('digiflazz', 'manual')),
  sku             text NOT NULL,                 -- buyer_sku_code / kode manual
  category        text NOT NULL CHECK (category IN ('pulsa', 'data', 'pln')),
  brand           text NOT NULL,                 -- TELKOMSEL, XL, … / PLN
  name            text NOT NULL,
  description     text,
  cost_price      bigint NOT NULL CHECK (cost_price >= 0),   -- modal dari penyedia
  sell_price      bigint NOT NULL CHECK (sell_price >= 0),   -- harga Poin untuk toko
  price_locked    boolean NOT NULL DEFAULT false,            -- override admin (tak ditimpa sinkron)
  provider_active boolean NOT NULL DEFAULT true,             -- status di penyedia
  active          boolean NOT NULL DEFAULT true,             -- saklar admin
  cutoff_start    text,                                      -- "hh:mm" (Digiflazz)
  cutoff_end      text,
  sort            integer NOT NULL DEFAULT 0,
  synced_at       bigint,
  created_at      bigint NOT NULL,
  updated_at      bigint NOT NULL,
  CONSTRAINT uq_ppob_products UNIQUE (provider, sku)
);
CREATE INDEX IF NOT EXISTS idx_ppob_products_list ON ppob_products (category, brand, sell_price);

CREATE TABLE IF NOT EXISTS ppob_orders (
  id               uuid PRIMARY KEY,               -- = ref_id ke Digiflazz
  business_id      uuid NOT NULL REFERENCES businesses (id) ON DELETE RESTRICT,
  account_id       uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,  -- dompet Poin
  user_ref         text,                           -- user/kasir app yang menjual (info)
  client_ref       text NOT NULL,                  -- idempotensi dari app
  product_id       uuid REFERENCES ppob_products (id) ON DELETE SET NULL,
  provider         text NOT NULL,
  sku              text NOT NULL,
  product_name     text NOT NULL,
  category         text NOT NULL,
  brand            text,
  customer_no      text NOT NULL,
  price            bigint NOT NULL CHECK (price > 0),        -- Poin dipotong
  cost             bigint NOT NULL CHECK (cost >= 0),        -- modal saat order
  status           text NOT NULL CHECK (status IN ('processing', 'pending', 'waiting_admin', 'success', 'failed')),
  refunded         boolean NOT NULL DEFAULT false,
  sn               text,                           -- serial pulsa / token listrik
  pln_name         text,
  pln_info         text,
  provider_rc      text,
  provider_message text,
  provider_price   bigint,                         -- harga riil dari penyedia
  notify_email     text,
  last_checked_at  bigint,
  fulfilled_by     text,
  completed_at     bigint,
  created_at       bigint NOT NULL,
  updated_at       bigint NOT NULL,
  CONSTRAINT uq_ppob_orders_client UNIQUE (business_id, client_ref)
);
CREATE INDEX IF NOT EXISTS idx_ppob_orders_business ON ppob_orders (business_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_ppob_orders_status ON ppob_orders (status, created_at);
CREATE INDEX IF NOT EXISTS idx_ppob_orders_account ON ppob_orders (account_id, created_at DESC);

-- Jejak audit per order (dibuat, kirim ke penyedia, balasan, webhook, cek status, refund…).
CREATE TABLE IF NOT EXISTS ppob_order_events (
  id         uuid PRIMARY KEY,
  order_id   uuid NOT NULL REFERENCES ppob_orders (id) ON DELETE CASCADE,
  event      text NOT NULL,
  detail     jsonb,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ppob_order_events ON ppob_order_events (order_id, created_at);
