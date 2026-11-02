import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenant.js';
import { ok } from '../lib/envelope.js';
import * as feedback from '../services/feedback.service.js';

/**
 * Saran pengguna app (Bearer + konteks toko). Base di-mount pada `/v1/feedback`.
 *  - POST /   { category?, message, contact?, appVersion?, platform? } → 201
 *  - GET  /   riwayat saran toko ini (+ status & balasan admin)
 */
export const feedbackRoutes = new Hono<AppEnv>()
  .use('*', requireAuth, requireTenant)
  .post('/', async (c) => {
    const input = feedback.feedbackCreateSchema.parse(await c.req.json());
    const auth = c.get('auth');
    const row = await feedback.create({ businessId: auth.businessId!, userId: auth.userId }, input);
    return c.json(ok(row), 201);
  })
  .get('/', async (c) => {
    const rows = await feedback.listMine(c.get('auth').businessId!);
    return c.json(ok(rows), 200);
  });
