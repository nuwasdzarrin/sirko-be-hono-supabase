-- 0008_points.sql — Poin Sirko (saldo prabayar untuk PPOB) + top-up manual.
--
-- Server = SATU-SATUNYA sumber kebenaran (bukan cermin backup; tak bisa di-push).
-- Saldo per AKUN PEMILIK (accounts.id) — dipakai bersama semua toko milik akun
-- itu (paket Juragan); tiap mutasi mencatat business_id toko pemakai.
-- Uang = bigint rupiah (1 Poin = Rp1); waktu = bigint epoch ms.
-- Rancangan: docs/superpowers/specs/2026-11-02-ppob-poin-design.md §3–§6.

-- ─── Saldo (cache dari ledger; selalu diubah dalam transaksi yg sama) ────────
CREATE TABLE IF NOT EXISTS point_accounts (
  account_id uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE RESTRICT,
  balance    bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

-- ─── Buku besar — append-only ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS point_ledger (
  id            uuid PRIMARY KEY,
  account_id    uuid NOT NULL REFERENCES point_accounts (account_id) ON DELETE RESTRICT,
  business_id   uuid REFERENCES businesses (id) ON DELETE SET NULL,
  type          text NOT NULL CHECK (type IN ('topup', 'purchase', 'refund', 'adjustment')),
  amount        bigint NOT NULL CHECK (amount <> 0),
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  ref_type      text CHECK (ref_type IN ('topup', 'ppob_order', 'manual')),
  ref_id        uuid,
  note          text,
  created_by    text NOT NULL,          -- 'app:<userId>' | 'admin:<nama>' | 'system'
  created_at    bigint NOT NULL,
  CONSTRAINT point_ledger_sign CHECK (
    (type IN ('topup', 'refund') AND amount > 0) OR
    (type = 'purchase' AND amount < 0) OR
    (type = 'adjustment')
  )
);
-- Satu kredit per top-up, satu potongan & satu refund per order → mustahil ganda.
CREATE UNIQUE INDEX IF NOT EXISTS uq_point_ledger_ref
  ON point_ledger (type, ref_type, ref_id) WHERE ref_id IS NOT NULL AND type <> 'adjustment';
CREATE INDEX IF NOT EXISTS idx_point_ledger_account ON point_ledger (account_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_point_ledger_business ON point_ledger (business_id, created_at DESC);

-- Ledger tak boleh diubah/dihapus (jejak audit). Pembetulan = baris adjustment baru.
CREATE OR REPLACE FUNCTION point_ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'point_ledger bersifat append-only (% ditolak)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_point_ledger_immutable ON point_ledger;
CREATE TRIGGER trg_point_ledger_immutable
  BEFORE UPDATE OR DELETE ON point_ledger
  FOR EACH ROW EXECUTE FUNCTION point_ledger_immutable();

-- ─── Permintaan top-up (transfer manual + konfirmasi admin) ──────────────────
CREATE TABLE IF NOT EXISTS point_topups (
  id              uuid PRIMARY KEY,
  account_id      uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  business_id     uuid REFERENCES businesses (id) ON DELETE SET NULL,
  amount          bigint NOT NULL CHECK (amount > 0),
  unique_code     integer NOT NULL CHECK (unique_code BETWEEN 1 AND 999),
  transfer_amount bigint NOT NULL CHECK (transfer_amount > 0),
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'paid', 'rejected', 'expired', 'cancelled')),
  requested_by    text NOT NULL,
  admin_note      text,
  confirmed_by    text,
  paid_at         bigint,
  expires_at      bigint NOT NULL,
  created_at      bigint NOT NULL,
  updated_at      bigint NOT NULL
);
-- Nominal transfer unik di antara top-up yang masih menunggu → mudah dicocokkan ke mutasi bank.
CREATE UNIQUE INDEX IF NOT EXISTS uq_point_topups_pending_amount
  ON point_topups (transfer_amount) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_point_topups_status ON point_topups (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_point_topups_account ON point_topups (account_id, created_at DESC);

-- ─── Konfigurasi yang bisa diubah admin tanpa deploy ─────────────────────────
CREATE TABLE IF NOT EXISTS app_config (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by text,
  updated_at bigint NOT NULL
);
