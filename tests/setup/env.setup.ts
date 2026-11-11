import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Muat `.env` proyek ke process.env (bila ada) SEBELUM modul aplikasi di-import,
 * lalu isi fallback deterministik untuk secret agar unit test tak butuh DB nyata.
 * Nilai yang sudah ada di environment TIDAK ditimpa (real menang atas fallback).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const envPath = join(root, '.env');

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    // DATABASE_URL di .env = DB dev/produksi → JANGAN dipakai test (lihat di bawah).
    if (key === 'DATABASE_URL') continue;
    if (process.env[key] !== undefined) continue;
    let val = m[2]!.trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

// Fallback: cukup untuk memuat config/env.ts di unit test (tak menyentuh DB).
process.env.JWT_SECRET ??= 'test-jwt-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters-long';
process.env.APP_ENV ??= 'development';
// DB test SELALU dari TEST_DATABASE_URL (default: Postgres lokal `sirko_test`),
// tak pernah dari DATABASE_URL — contract test menulis data & tak membersihkannya.
// Contract test men-skip dirinya bila DB tak benar-benar tersambung.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/sirko_test';
if (/supabase\.(co|com)/i.test(process.env.DATABASE_URL)) {
  throw new Error('TEST_DATABASE_URL mengarah ke Supabase — test hanya boleh ke DB uji lokal.');
}

// Kredensial dashboard agar login sesi teruji (contract dashboard).
process.env.DASHBOARD_USER ??= 'admin-test';
process.env.DASHBOARD_PASSWORD ??= 'password-test-123';

// Notifikasi Telegram asli tak boleh terkirim dari test (transport di-mock bila perlu).
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_ADMIN_CHAT_ID;

// PPOB: SELALU kredensial palsu di test (transport Digiflazz di-mock) — kredensial
// asli dari .env tak boleh terpakai. Tugas berkala dimatikan.
process.env.PPOB_ENABLED = 'true';
process.env.DIGIFLAZZ_USERNAME = 'test-df-user';
process.env.DIGIFLAZZ_API_KEY = 'test-df-key';
process.env.DIGIFLAZZ_WEBHOOK_SECRET = 'test-df-webhook-secret';
process.env.DIGIFLAZZ_TESTING = 'true';
process.env.PPOB_JOBS = '0';
delete process.env.RESEND_API_KEY; // email asli tak boleh terkirim dari test
// Akun: kode OTP ikut di respons (devCode) agar helper test bisa verifikasi tanpa email.
process.env.AUTH_DEV_OTP_ECHO = 'true';

// S3 dummy agar presigner (Fitur 2 Media) bisa diuji struktur signed URL-nya.
process.env.S3_ENDPOINT ??= 'https://s3.test.local/storage/v1/s3';
process.env.S3_REGION ??= 'ap-southeast-1';
process.env.S3_BUCKET ??= 'sirko-media';
process.env.S3_ACCESS_KEY_ID ??= 'test-access-key';
process.env.S3_SECRET_ACCESS_KEY ??= 'test-secret-key';
process.env.SITE_WHATSAPP ??= '628999104916';
