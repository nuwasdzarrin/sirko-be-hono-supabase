-- 0007_juragan.sql — Paket Juragan (langganan premium, multi-toko). Lihat JURAGAN.md §3.1.
--
-- Nomor 0007 dicadangkan untuk Juragan; Poin = 0008, PPOB = 0009. Runner
-- menerapkan file yang belum tercatat apa pun urutannya → file ini TIDAK
-- bergantung pada tabel Poin/PPOB. Idempotent & maju-saja. Postgres ≥ 15
-- (NULLS NOT DISTINCT).

-- K3: satu akun boleh punya baris users di BANYAK toko, maksimal satu per toko.
-- NULLS NOT DISTINCT: baris sirko_admin (business_id NULL) tetap satu per akun.
DROP INDEX IF EXISTS uq_users_account;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_account_business
  ON users (account_id, business_id) NULLS NOT DISTINCT
  WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_account ON users (account_id)
  WHERE account_id IS NOT NULL;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS last_business_id uuid;   -- toko terakhir dibuka

-- K6: langganan per akun. Satu baris per periode yang dibayar (riwayat utuh).
-- Paket efektif DIHITUNG dari baris ini (starts_at <= now < ends_at), tak disimpan.
CREATE TABLE IF NOT EXISTS subscriptions (
  id          uuid PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  plan        text NOT NULL CHECK (plan IN ('juragan')),
  period      text NOT NULL CHECK (period IN ('monthly', 'yearly')),
  starts_at   bigint NOT NULL,
  ends_at     bigint NOT NULL CHECK (ends_at > starts_at),
  payment_id  uuid UNIQUE,                     -- → subscription_payments (null = manual admin)
  created_by  text,                            -- 'payment' | 'admin:<nama>'
  note        text,
  created_at  bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_account
  ON subscriptions (account_id, ends_at DESC);

-- Pembayaran QRIS statis + konfirmasi admin (pola sama dengan top-up Poin).
CREATE TABLE IF NOT EXISTS subscription_payments (
  id            uuid PRIMARY KEY,
  account_id    uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  business_id   uuid REFERENCES businesses (id) ON DELETE SET NULL,  -- toko asal (info)
  plan          text NOT NULL CHECK (plan IN ('juragan')),
  period        text NOT NULL CHECK (period IN ('monthly', 'yearly')),
  base_amount   bigint NOT NULL CHECK (base_amount > 0),
  unique_code   integer NOT NULL CHECK (unique_code BETWEEN 1 AND 999),
  amount        bigint NOT NULL,                    -- base_amount + unique_code
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired')),
  proof_path    text,                               -- opsional: URL foto bukti transfer
  reviewed_by   text,
  reviewed_at   bigint,
  note          text,
  expires_at    bigint NOT NULL,                    -- permintaan kedaluwarsa (24 jam)
  created_at    bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sub_payments_status
  ON subscription_payments (status, created_at);
CREATE INDEX IF NOT EXISTS idx_sub_payments_account
  ON subscription_payments (account_id, created_at DESC);
-- Kode unik tak boleh dipakai dua permintaan pending dengan nominal sama.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_payments_pending_amount
  ON subscription_payments (amount) WHERE status = 'pending';

-- Harga & batas = konfigurasi (diubah admin tanpa deploy).
CREATE TABLE IF NOT EXISTS plan_prices (
  plan        text NOT NULL,
  period      text NOT NULL CHECK (period IN ('monthly', 'yearly')),
  amount      bigint NOT NULL CHECK (amount > 0),
  max_stores  integer NOT NULL CHECK (max_stores >= 1),
  updated_at  bigint NOT NULL,
  PRIMARY KEY (plan, period)
);
-- Harga awal (J2, J3, J9). DO NOTHING → harga yang sudah diubah admin tak ditimpa.
INSERT INTO plan_prices (plan, period, amount, max_stores, updated_at) VALUES
  ('juragan', 'monthly', 49000, 3, 0),
  ('juragan', 'yearly', 499000, 3, 0)
ON CONFLICT (plan, period) DO NOTHING;

-- KV konfigurasi bersama (definisi IDENTIK dengan 0008 PPOB — brief §5.1).
-- Juragan memakai kunci 'subscription' (QRIS & instruksi bayar).
CREATE TABLE IF NOT EXISTS app_config (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by text,
  updated_at bigint NOT NULL
);
