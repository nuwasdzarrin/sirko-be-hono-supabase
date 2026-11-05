-- 0010_ppob_pln.sql — Token listrik (PLN prabayar) manual: cache cek nomor meter.
--
-- Produk token PLN memakai ppob_products (provider 'manual', category 'pln') &
-- order memakai ppob_orders (status 'waiting_admin' → admin menempel token).
-- Tabel ini hanya cache hasil Digiflazz inquiry-pln (ada batas rate, RC 86).
-- Rancangan: docs/superpowers/specs/2026-11-02-ppob-poin-design.md §8, §12.

CREATE TABLE IF NOT EXISTS ppob_pln_cache (
  meter_no      text PRIMARY KEY,
  ok            boolean NOT NULL,
  name          text,
  segment_power text,
  message       text,
  checked_at    bigint NOT NULL
);
