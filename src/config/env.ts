import { z } from 'zod';

/**
 * Environment validation — fail fast at boot.
 *
 * Portabilitas: hanya bergantung pada `DATABASE_URL` (Postgres apa pun) + `S3_*`
 * (protokol S3 netral). TIDAK ada variabel/SDK khusus Supabase. Pindah ke VPS =
 * ganti nilai env, kode tak berubah.
 */

const rawSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL wajib diisi'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET minimal 32 karakter'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET minimal 32 karakter'),

  // S3 dipakai mulai Fitur 2 (Media). Wajib di production, boleh kosong di dev.
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // URL publik dasar untuk objek (Supabase: .../object/public/<bucket>). Bila kosong
  // → `${S3_ENDPOINT}/${S3_BUCKET}` (pola MinIO/VPS). Portabel: cukup ganti env.
  S3_PUBLIC_BASE_URL: z.string().optional(),

  APP_ENV: z.enum(['development', 'production']).default('development'),

  // Dashboard admin (opsional). Bila keduanya diisi → halaman /dashboard digerbang
  // Basic Auth. Bila kosong (dev) → terbuka. Di production SEBAIKNYA diisi.
  DASHBOARD_USER: z.string().optional(),
  DASHBOARD_PASSWORD: z.string().optional(),

  // Notifikasi admin via Telegram (opsional). Kosong → notifikasi dilewati (log saja).
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),
  // URL publik dashboard untuk tautan di notifikasi (mis. https://sirko.produkdesa.com).
  PUBLIC_BASE_URL: z.string().optional(),
  // Website publik (landing + blog). URL kanonik untuk canonical/sitemap/OG.
  SITE_URL: z.string().url().default('https://sirkopos.com'),
  // Tautan Google Play (isi saat aplikasi rilis) → tombol unduh & schema downloadUrl.
  PLAY_STORE_URL: z.string().url().optional(),
  // Email kontak resmi (halaman privasi, ketentuan, kontak, schema Organization). Kosong → formulir web.
  SITE_CONTACT_EMAIL: z.string().email().optional(),
  // Nama pengelola/pengendali data yang tampil di halaman legal & schema.
  // Isi setelah dikonfirmasi pemilik (penulisan resmi badan hukum). Kosong → "tim pengelola Sirko".
  SITE_OPERATOR: z.string().optional(),
  // Kode verifikasi Google Search Console (meta google-site-verification).
  GOOGLE_SITE_VERIFICATION: z.string().optional(),
  // true = halaman publik dari host lain (mis. sirko.produkdesa.com) dialihkan 301 ke SITE_URL.
  // Nyalakan SETELAH domain SITE_URL benar-benar live.
  SITE_FORCE_HOST: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),

  // PPOB (Digiflazz). Dipanggil langsung dari VPS (IP di-whitelist di Digiflazz).
  PPOB_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  DIGIFLAZZ_USERNAME: z.string().optional(),
  DIGIFLAZZ_API_KEY: z.string().optional(), // lama: satu key untuk semua (cadangan bila dua key di bawah kosong)
  // Dua key berdampingan: transaksi/price-list/cek saldo memakai key sesuai DIGIFLAZZ_TESTING
  // (true → DEV, false → PROD); cek meter PLN (inquiry-pln, gratis) selalu memakai PROD bila ada,
  // karena Digiflazz menolak development key untuk inquiry-pln (RC 41).
  DIGIFLAZZ_DEV_KEY: z.string().optional(),
  DIGIFLAZZ_PROD_KEY: z.string().optional(),
  DIGIFLAZZ_WEBHOOK_SECRET: z.string().optional(),
  // true = kirim `testing: true` ke Digiflazz (mode uji, tak memotong deposit).
  DIGIFLAZZ_TESTING: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  // 0 = matikan tugas berkala PPOB (cek order pending) di proses ini.
  PPOB_JOBS: z.string().optional(),
  // Email transaksional (token listrik) via Resend. Kosong → email dilewati (dicatat).
  RESEND_API_KEY: z.string().optional(),
  // Pengirim terverifikasi di Resend, mis. "Sirko <noreply@sirko.id>".
  MAIL_FROM: z.string().optional(),

  // ── Akun ──
  // true (HANYA non-production) = sertakan `devCode` OTP di respons agar app bisa diuji
  // tanpa Resend. Diabaikan bila APP_ENV=production.
  AUTH_DEV_OTP_ECHO: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

const parsed = rawSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new Error(`Konfigurasi environment tidak valid:\n${details}`);
}

const env = parsed.data;

// S3 wajib lengkap saat production (foundation belum memakainya, tapi gagal cepat lebih baik).
if (env.APP_ENV === 'production') {
  const missingS3 = (
    ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const
  ).filter((k) => !env[k]);
  if (missingS3.length > 0) {
    throw new Error(
      `Konfigurasi environment tidak valid (production):\n  - S3 wajib lengkap: ${missingS3.join(', ')}`,
    );
  }
}

export type Env = typeof env;
export { env };

/** Umur access token (detik). Sinkron dengan `expiresIn` di kontrak API. */
export const ACCESS_TOKEN_TTL_SECONDS = 3600;
/** Umur refresh token (detik) — 30 hari. */
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
