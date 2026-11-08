-- 0014_admin_dashboard — akun admin dashboard di database (pengganti DASHBOARD_USER/PASSWORD
-- di .env sebagai sumber kebenaran; .env hanya untuk bootstrap admin pertama), lupa/ganti
-- password via OTP email, dan tautan Telegram per admin (bot admin interaktif).
-- 0013 dicadangkan untuk agen Juragan.

CREATE TABLE IF NOT EXISTS admin_users (
  id                  uuid PRIMARY KEY,
  -- Login: email (atau username lama dari DASHBOARD_USER). Lupa password butuh email asli.
  email               citext NOT NULL UNIQUE,
  name                text NOT NULL DEFAULT '',
  password_hash       text NOT NULL,
  -- Sesi dashboard yang terbit sebelum waktu ini tidak berlaku (ganti/reset password).
  password_changed_at bigint NOT NULL,
  telegram_chat_id    bigint UNIQUE,
  telegram_username   text,
  telegram_linked_at  bigint,
  created_at          bigint NOT NULL,
  updated_at          bigint NOT NULL
);

-- Kode sekali pakai admin: OTP reset password (6 digit) & token tautan Telegram (deep link).
CREATE TABLE IF NOT EXISTS admin_otps (
  id          uuid PRIMARY KEY,
  admin_id    uuid NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('reset', 'telegram')),
  code_hash   text NOT NULL,
  expires_at  bigint NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  used_at     bigint,
  created_at  bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_otps_admin ON admin_otps (admin_id, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_otps_hash ON admin_otps (code_hash) WHERE used_at IS NULL;
