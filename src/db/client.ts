import postgres from 'postgres';
import { env } from '../config/env.ts';

/**
 * Koneksi Postgres — SATU instance di MODULE SCOPE agar di-reuse antar-invocation
 * saat serverless "warm" (spec 08 §4.2).
 *
 * WAJIB pakai POOLER Supabase (Supavisor) mode transaction @ 6543:
 *   - `prepare: false`  → transaction pooler tak mendukung named prepared statement.
 *   - `max: 1`          → tiap instance serverless hanya butuh 1 koneksi; pooling
 *                          sebenarnya terjadi di Supavisor, bukan di sini.
 *
 * Portabel: `postgres.js` bicara Postgres murni. Pindah ke VPS = ganti DATABASE_URL.
 */
export const sql = postgres(env.DATABASE_URL, {
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
  // Redam NOTICE jinak (mis. "already exists, skipping" dari CREATE ... IF NOT EXISTS).
  onnotice: () => {},
});

export type Sql = typeof sql;

/**
 * Klien DB yang menerima koneksi biasa MAUPUN handle transaksi (`sql.begin(tx)`).
 * Repository memakai tipe ini agar bisa dijalankan di dalam transaksi.
 */
export type DbClient = Sql | postgres.TransactionSql<Record<string, never>>;
