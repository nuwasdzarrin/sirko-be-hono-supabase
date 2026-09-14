-- 0004_catalog_contributions.sql — Kontribusi katalog dari toko (dengan moderasi).
--
-- Antrean usulan produk dari toko biasa. TIDAK langsung masuk public_products;
-- admin me-review di dashboard lalu approve → baru disalin ke public_products
-- (source='crowdsource', verified=true) secara atomik. Menjaga katalog bersih.
--
-- Waktu = bigint epoch ms. Idempotent (IF NOT EXISTS) & maju-saja.

CREATE TABLE IF NOT EXISTS catalog_contributions (
  id                uuid PRIMARY KEY,
  business_id       uuid NOT NULL,               -- toko pengusul (dari JWT)
  contributed_by    uuid,                        -- user pengusul (dari JWT)
  target_id         uuid,                        -- diisi bila mengusulkan EDIT produk lama; null = produk baru

  -- Data yang diusulkan (mirror kolom public_products yang bisa ditulis).
  barcode           text,
  barcode_type      text CHECK (barcode_type IS NULL OR barcode_type IN ('EAN13', 'UPC', 'EAN8', 'QR', 'other')),
  name              text NOT NULL,
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
  note              text,                          -- catatan bebas dari pengusul

  -- Moderasi.
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note       text,
  reviewed_by       text,                          -- identitas admin (user dashboard)
  reviewed_at       bigint,
  result_product_id uuid,                          -- public_products yang dibuat/diupdate saat approve

  created_at        bigint NOT NULL,
  updated_at        bigint NOT NULL
);

-- Antrean moderasi: ambil pending terlama dulu.
CREATE INDEX IF NOT EXISTS idx_catalog_contrib_status
  ON catalog_contributions (status, created_at);

-- "Usulan toko saya".
CREATE INDEX IF NOT EXISTS idx_catalog_contrib_business
  ON catalog_contributions (business_id, created_at DESC);
