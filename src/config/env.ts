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
