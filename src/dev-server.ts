import { serve } from '@hono/node-server';
import { app } from './app.ts';

/**
 * Dev server lokal (BUKAN untuk produksi — produksi pakai hono/vercel).
 * Jalankan: `npm run dev` → node --env-file=.env --import tsx --watch src/dev-server.ts
 */
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Sirko backend (dev) → http://localhost:${info.port}/v1/health`);
});
