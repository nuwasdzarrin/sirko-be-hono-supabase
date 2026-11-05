import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { ok } from '../lib/envelope.js';
import { createBusinessSchema } from '../schemas/auth.schema.js';
import * as authService from '../services/auth.service.js';
import * as subscriptions from '../services/subscription.service.js';

/**
 * Rute Paket Juragan (Bearer). Base di-mount pada `/v1` (JURAGAN.md §3.3, kontrak app §2.7, §3):
 *  - POST /businesses                  tambah toko (owner, multi_store, kuota) → bentuk login
 *  - GET  /plans                       harga + instruksi bayar + paket saat ini
 *  - POST /plan/checkout               buat permintaan bayar (owner)
 *  - GET  /plan/checkout/:id           status pembayaran (+ plan baru bila confirmed)
 *  - POST /plan/checkout/:id/proof     lampirkan bukti transfer (owner)
 */

const checkoutSchema = z.object({ period: z.enum(subscriptions.PERIODS) });
const proofSchema = z.object({ mediaPath: z.string().trim().min(1).max(1000) });

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
  });
