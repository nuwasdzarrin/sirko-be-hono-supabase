-- 0001_init.sql — Fondasi backend Sirko (auth self-owned + tenant root).
--
-- Portabel ke Postgres mana pun: TANPA ekstensi/fitur khusus Supabase.
-- Idempotent & maju-saja: aman dijalankan berulang (IF NOT EXISTS di mana-mana).
-- Konvensi: id = uuid (dari client), waktu = bigint epoch ms UTC, uang = integer.
-- Setiap tabel milik-toko punya business_id + server_updated_at (cursor sync).

-- Ekstensi netral (tersedia di Postgres standar & Supabase).
CREATE EXTENSION IF NOT EXISTS citext;

-- ─── businesses (tenant root) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS businesses (
  id                uuid PRIMARY KEY,
  name              text NOT NULL,
  business_type     text,
  address           text,
  phone             text,
  logo_path         text,
  tax_enabled       boolean NOT NULL DEFAULT false,
  tax_percent       integer NOT NULL DEFAULT 0,
  tax_inclusive     boolean NOT NULL DEFAULT false,
  rounding_mode     text NOT NULL DEFAULT 'none'
                      CHECK (rounding_mode IN ('none', 'nearest100', 'nearest500')),
  currency_symbol   text NOT NULL DEFAULT 'Rp',
  created_at        bigint NOT NULL,
  updated_at        bigint NOT NULL,
  deleted_at        bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_businesses_server_updated
  ON businesses (server_updated_at);

-- ─── accounts (identitas login cloud — self-owned) ───────────────────────────
-- Kredensial email/phone + password bcrypt. Terpisah dari `users` (PIN device).
CREATE TABLE IF NOT EXISTS accounts (
  id            uuid PRIMARY KEY,
  email         citext,
  phone         text,
  password_hash text NOT NULL,
  created_at    bigint NOT NULL,
  updated_at    bigint NOT NULL,
  CONSTRAINT accounts_email_or_phone CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_email ON accounts (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_phone ON accounts (phone) WHERE phone IS NOT NULL;

-- ─── users (pemilik & staff di bawah satu business) ──────────────────────────
-- business_id NULL hanya untuk sirko_admin (staf internal, akses katalog global).
-- account_id NULL untuk staff device yang belum punya login cloud.
CREATE TABLE IF NOT EXISTS users (
  id                uuid PRIMARY KEY,
  business_id       uuid REFERENCES businesses (id) ON DELETE CASCADE,
  account_id        uuid REFERENCES accounts (id) ON DELETE SET NULL,
  name              text NOT NULL,
  username          text,
  pin_hash          text,
  role              text NOT NULL DEFAULT 'staff'
                      CHECK (role IN ('owner', 'admin', 'cashier', 'staff', 'custom', 'sirko_admin')),
  permissions       jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        bigint NOT NULL,
  updated_at        bigint NOT NULL,
  deleted_at        bigint,
  server_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_business_required CHECK (role = 'sirko_admin' OR business_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_account ON users (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_business_id ON users (business_id, id);
CREATE INDEX IF NOT EXISTS idx_users_business_server_updated ON users (business_id, server_updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_business_username
  ON users (business_id, username) WHERE username IS NOT NULL;

-- ─── refresh_tokens (rotasi & revoke) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  jti        uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at bigint NOT NULL,
  revoked    boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);

-- ─── RLS (jaring pengaman, portabel — berbasis session var, BUKAN Supabase) ──
-- Tenancy utama ditegakkan di Hono. RLS = pertahanan berlapis bila kelak ada
-- akses non-Hono. Policy pakai current_setting('app.business_id') standar Postgres.
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_businesses ON businesses;
CREATE POLICY tenant_isolation_businesses ON businesses
  USING (id::text = current_setting('app.business_id', true));

DROP POLICY IF EXISTS tenant_isolation_users ON users;
CREATE POLICY tenant_isolation_users ON users
  USING (
    business_id::text = current_setting('app.business_id', true)
    OR current_setting('app.business_id', true) IS NULL
  );
