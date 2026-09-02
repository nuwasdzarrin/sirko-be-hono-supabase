import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { ok } from '../lib/envelope.ts';
import { nowMs } from '../lib/time.ts';
import { sql } from '../db/client.ts';

/**
 * GET /v1/health (tanpa Bearer). Dipakai Vercel Cron harian untuk mencegah
 * Supabase idle-pause (spec 08 §13). Menyentuh DB (`SELECT 1`) agar Postgres
 * ikut "hidup" — inti tujuan anti-sleep. Kegagalan DB TIDAK menggagalkan
 * endpoint (tetap 200) supaya cron tak dianggap error; status DB dilaporkan.
 */
export const healthRoutes = new Hono<AppEnv>().get('/health', async (c) => {
  let db: 'ok' | 'down' = 'ok';
  try {
    await sql`SELECT 1`;
  } catch (err) {
    db = 'down';
    console.error('[health] DB ping gagal:', err);
  }
  return c.json(ok({ status: 'ok', db, serverTime: nowMs() }));
});
