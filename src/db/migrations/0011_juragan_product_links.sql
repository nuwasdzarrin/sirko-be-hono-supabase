-- 0011_juragan_product_links.sql — Tautan salinan produk antar-toko (Juragan).
--
-- Server-only (BUKAN tabel backup/sync). Mengingat "produk P di toko A = produk Q
-- di toko B" agar salin ulang tak membuat duplikat (produk tanpa barcode) dan app
-- bisa memakai pasangan untuk mutasi stok. Berlaku DUA ARAH saat dicari.
-- Tak bergantung pada tabel PPOB. Idempotent & maju-saja.

CREATE TABLE IF NOT EXISTS product_links (
  source_business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  source_product_id  uuid NOT NULL,
  source_variant_id  uuid,                       -- null = tingkat produk
  target_business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  target_product_id  uuid NOT NULL,
  target_variant_id  uuid,
  created_at         bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_links
  ON product_links (source_business_id, source_product_id, target_business_id)
  WHERE source_variant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_links_variant
  ON product_links (source_business_id, source_variant_id, target_business_id)
  WHERE source_variant_id IS NOT NULL;
-- Pencarian arah balik (B→A).
CREATE INDEX IF NOT EXISTS idx_product_links_target
  ON product_links (target_business_id, target_product_id, source_business_id);
