-- 0018_signup_source.sql — asal pendaftaran akun (first-party, tanpa pelacak pihak ketiga).
-- Diisi dari penanda `?dari=<halaman>` pada tautan ajakan situs → web app → POST /v1/auth/register.
-- Contoh: 'beranda-hero', 'artikel-pembukuan-warung-sembako', 'halaman-aplikasi-kasir-online'.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS signup_source text;
CREATE INDEX IF NOT EXISTS idx_accounts_signup_source ON accounts (signup_source, created_at);
