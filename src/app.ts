import { Hono } from 'hono';

/**
 * Entry aplikasi (dipakai Vercel zero-config, dev-server, & test).
 *
 * Pola boot-safe: modul ini SENDIRI ringan (hanya import `hono`). Aplikasi inti
 * (`app-core.ts`) yang melakukan validasi env & koneksi DB di-*dynamic import*
 * saat request pertama. Bila boot inti gagal (mis. env kurang), error-nya
 * ditampilkan sebagai HTTP 500 teks — bukan `FUNCTION_INVOCATION_FAILED` buta
 * (log runtime tak bisa diakses di Vercel Hobby).
 */
const app = new Hono();

let core: { fetch: (req: Request) => Response | Promise<Response> } | null = null;
let bootError: string | null = null;

app.all('*', async (c) => {
  if (!core && !bootError) {
    try {
      core = (await import('./app-core.js')).app as unknown as typeof core;
    } catch (e) {
      bootError = e instanceof Error ? (e.stack ?? e.message) : String(e);
      console.error('BOOT ERROR:', bootError);
    }
  }
  if (bootError) {
    return c.text(`SIRKO BOOT ERROR:\n\n${bootError}`, 500);
  }
  return core!.fetch(c.req.raw);
});

// Named `app` (dev-server & test) + default (entry Vercel) → keduanya wrapper ini.
export { app };
export default app;
