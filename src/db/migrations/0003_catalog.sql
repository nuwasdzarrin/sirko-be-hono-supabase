-- 0003_catalog.sql — Fitur 2: Katalog Produk Umum (public_products).
--
-- Tabel GLOBAL: TANPA business_id, TANPA harga/stok (spec 09 §C, spec 08 §9 tabel
-- global). Dibaca semua toko terautentikasi; ditulis HANYA sirko_admin.
-- Waktu = bigint epoch ms. Soft delete via deleted_at.
-- Idempotent (IF NOT EXISTS) & maju-saja.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public_products (
  id                uuid PRIMARY KEY,
  barcode           text,
  barcode_type      text CHECK (barcode_type IS NULL OR barcode_type IN ('EAN13', 'UPC', 'EAN8', 'QR', 'other')),
  name              text,
  short_description text,
  photo_url         text,
  brand             text,
  category          text,
  manufacturer      text,
  default_unit      text,
  net_size          numeric,
  net_unit          text,
  packaging         text,
  variant           text,
  country_of_origin text,
  keywords          text[] NOT NULL DEFAULT '{}',
  verified          boolean NOT NULL DEFAULT false,
  source            text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'crowdsource')),
  created_at        bigint,
  updated_at        bigint NOT NULL,
  deleted_at        bigint
);

-- Barcode unik untuk produk hidup (lookup auto-fill saat scan).
CREATE UNIQUE INDEX IF NOT EXISTS uq_public_products_barcode
  ON public_products (barcode)
  WHERE barcode IS NOT NULL AND deleted_at IS NULL;

-- Pencarian relevansi: trigram pada name & brand, GIN pada keywords (array).
CREATE INDEX IF NOT EXISTS idx_public_products_name_trgm
  ON public_products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_public_products_brand_trgm
  ON public_products USING gin (brand gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_public_products_keywords
  ON public_products USING gin (keywords);
