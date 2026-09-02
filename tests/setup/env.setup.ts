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
// DATABASE_URL dummy hanya agar env.ts lolos validasi; contract test akan
// men-skip dirinya bila DB tak benar-benar tersambung.
process.env.DATABASE_URL ??= 'postgresql://sirko:sirko@localhost:5432/sirko_test';

// S3 dummy agar presigner (Fitur 2 Media) bisa diuji struktur signed URL-nya.
process.env.S3_ENDPOINT ??= 'https://s3.test.local/storage/v1/s3';
process.env.S3_REGION ??= 'ap-southeast-1';
process.env.S3_BUCKET ??= 'sirko-media';
process.env.S3_ACCESS_KEY_ID ??= 'test-access-key';
process.env.S3_SECRET_ACCESS_KEY ??= 'test-secret-key';
