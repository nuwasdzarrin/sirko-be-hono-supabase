import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { ok } from '../lib/envelope.js';
import { createBusinessSchema } from '../schemas/auth.schema.js';
import * as authService from '../services/auth.service.js';
import * as subscriptions from '../services/subscription.service.js';
import * as juragan from '../services/juragan.service.js';
import { resolveRange } from '../services/store-report.service.js';

/**
 * Rute Paket Juragan (Bearer). Base di-mount pada `/v1` (JURAGAN.md §3.3, kontrak app §2.7, §3):
 *  - POST /businesses                  tambah toko (owner, multi_store, kuota) → bentuk login
 *  - GET  /plans                       harga + instruksi bayar + paket saat ini
 *  - POST /plan/checkout               buat permintaan bayar (owner)
 *  - GET  /plan/checkout/:id           status pembayaran (+ plan baru bila confirmed)
 *  - POST /plan/checkout/:id/proof     lampirkan bukti transfer (owner)
 * Lintas-toko (butuh multi_store + owner di setiap toko — JURAGAN.md §3.5):
 *  - GET  /juragan/reports/summary?preset=|from=&to=   laporan gabungan per toko + total
 *  - POST /juragan/copy-products       salin produk (UUID baru, stok 0)
 *  - POST /juragan/stock-transfers     mutasi stok (ledger out/in, ref store_transfer)
 */

const checkoutSchema = z.object({ period: z.enum(subscriptions.PERIODS) });
const proofSchema = z.object({ mediaPath: z.string().trim().min(1).max(1000) });
const copySchema = z.object({
  fromBusinessId: z.string().uuid(),
  toBusinessId: z.string().uuid(),
  productIds: z.array(z.string().uuid()).min(1, 'Pilih minimal satu produk').max(200, 'Maksimal 200 produk sekali salin'),
});
const transferSchema = z.object({
  fromBusinessId: z.string().uuid(),
  toBusinessId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        toProductId: z.string().uuid(),
        variantId: z.string().uuid().nullish(),
        toVariantId: z.string().uuid().nullish(),
        qty: z.number().int('Jumlah harus bilangan bulat').positive('Jumlah harus lebih dari 0').max(1_000_000),
      }),
    )
    .min(1, 'Isi minimal satu barang')
    .max(100, 'Maksimal 100 barang sekali mutasi'),
  note: z.string().trim().max(300).nullish(),
});

export const juraganRoutes = new Hono<AppEnv>()
  .post('/businesses', requireAuth, async (c) => {
    const input = createBusinessSchema.parse(await c.req.json());
    return c.json(ok(await authService.createBusiness(c.get('auth'), input)), 201);
  })
  .get('/plans', requireAuth, async (c) => c.json(ok(await subscriptions.listPlans(c.get('auth'))), 200))
  .post('/plan/checkout', requireAuth, async (c) => {
    const { period } = checkoutSchema.parse(await c.req.json());
    return c.json(ok(await subscriptions.checkout(c.get('auth'), period)), 201);
  })
  .get('/plan/checkout/:id', requireAuth, async (c) =>
    c.json(ok(await subscriptions.getCheckout(c.get('auth'), c.req.param('id'))), 200),
  )
  .post('/plan/checkout/:id/proof', requireAuth, async (c) => {
    const { mediaPath } = proofSchema.parse(await c.req.json());
    return c.json(ok(await subscriptions.attachProof(c.get('auth'), c.req.param('id'), mediaPath)), 200);
  })
  .get('/juragan/reports/summary', requireAuth, async (c) => {
    const range = resolveRange({ preset: c.req.query('preset'), from: c.req.query('from'), to: c.req.query('to') });
    return c.json(ok(await juragan.summaryReport(c.get('auth'), range)), 200);
  })
  .post('/juragan/copy-products', requireAuth, async (c) => {
    const input = copySchema.parse(await c.req.json());
    return c.json(ok(await juragan.copyProducts(c.get('auth'), input)), 201);
  })
  .post('/juragan/stock-transfers', requireAuth, async (c) => {
    const input = transferSchema.parse(await c.req.json());
    return c.json(ok(await juragan.transferStock(c.get('auth'), input)), 201);
  });
