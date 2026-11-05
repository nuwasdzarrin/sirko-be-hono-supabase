import { serve } from '@hono/node-server';
import { app } from './app.js';
import { startPpobJobs } from './services/ppob.service.js';

/**
 * Server produksi untuk VPS (PM2). Vercel tetap memakai `export default app`.
 * Default bind 127.0.0.1 — akses publik lewat Cloudflare Tunnel, bukan port terbuka.
 * Jalankan: `npm start` → node --env-file=.env --import tsx src/server.ts
 */
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? '127.0.0.1';

// Tugas berkala PPOB (cek order pending ke Digiflazz). Matikan dengan PPOB_JOBS=0.
startPpobJobs();

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`Sirko backend → http://${hostname}:${info.port}/v1/health`);
});
