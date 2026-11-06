-- 0012_akun_pemilik.sql — Akun pemilik baru (daftar email/WA + password, OTP email,
-- login email/WA, lupa password, hash login offline) + aturan harga PPOB per toko.
-- Spesifikasi: C:\project\sirko\SPEC-warung-akun-ppob.md, PROMPT-backend-akun-ppob.md.
--
-- Tidak bergantung pada tabel Juragan (0007/0011). Bergantung pada ppob_products (0009).
-- Idempotent & maju-saja.

-- ─── Akun pemilik ────────────────────────────────────────────────────────────
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS name text;                  -- nama pemilik (sebelum ada toko)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email_verified_at bigint;   -- kapan OTP email diverifikasi
-- true HANYA untuk akun dari POST /v1/auth/register yang belum memasukkan OTP. Akun lama,
-- register-business, & buatan sistem = false → tak pernah terkunci oleh aturan verifikasi.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pending_verification boolean NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS password_changed_at bigint;
-- Turunan khusus login OFFLINE di HP (PBKDF2-SHA256, salt terpisah) — BUKAN hash login server.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS offline_salt text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS offline_hash text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS offline_iter integer;

-- Kode OTP (disimpan sebagai hash, sekali pakai, berbatas waktu & percobaan).
CREATE TABLE IF NOT EXISTS auth_otps (
  id          uuid PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  code_hash   text NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  expires_at  bigint NOT NULL,
  consumed_at bigint,
  created_at  bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_otps_account ON auth_otps (account_id, purpose, created_at DESC);

-- Pembatas percobaan login (kunci = 'acct:<id>' | 'ip:<alamat>').
CREATE TABLE IF NOT EXISTS auth_throttle (
  key          text PRIMARY KEY,
  failures     integer NOT NULL DEFAULT 0,
  window_start bigint NOT NULL,
  locked_until bigint
);

-- Refresh token juga untuk sesi AKUN (pemilik yang belum punya toko).
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts (id) ON DELETE CASCADE;
ALTER TABLE refresh_tokens ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE refresh_tokens DROP CONSTRAINT IF EXISTS refresh_tokens_owner;
ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_owner CHECK (user_id IS NOT NULL OR account_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_account ON refresh_tokens (account_id) WHERE account_id IS NOT NULL;

-- ─── Harga PPOB per toko (untung pemilik) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS ppob_store_pricing (
  business_id uuid PRIMARY KEY REFERENCES businesses (id) ON DELETE CASCADE,
  markups     jsonb NOT NULL,                    -- {"pulsa":2000,"data":2000,"pln":2000}
  rounding    integer NOT NULL CHECK (rounding IN (100, 500, 1000)),
  updated_by  text,
  updated_at  bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS ppob_store_price_overrides (
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES ppob_products (id) ON DELETE CASCADE,
  sell_price  bigint NOT NULL CHECK (sell_price > 0),
  updated_at  bigint NOT NULL,
  PRIMARY KEY (business_id, product_id)
);
