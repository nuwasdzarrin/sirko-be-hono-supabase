import { handle } from 'hono/vercel';
import { app } from '../src/app.ts';

/**
 * Entrypoint Vercel — adapter `hono/vercel` (Node runtime, bukan Edge: butuh
 * TCP Postgres). `vercel.json` mengarahkan SEMUA path ke fungsi ini (catch-all).
 * App Hono di-init di module scope agar di-reuse saat warm (spec 08 §4.2).
 */
export const config = { runtime: 'nodejs' };

export default handle(app);
