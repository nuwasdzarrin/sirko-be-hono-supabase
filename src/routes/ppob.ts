import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenant.js';
import { ok } from '../lib/envelope.js';
import * as ppob from '../services/ppob.service.js';

/**
 * PPOB untuk app (Bearer + konteks toko). Base `/v1/ppob`. Online-only.
 *  - GET  /products?category=pulsa|data&customerNo=   produk aktif (difilter operator)
 *  - POST /orders {clientRef, productId, customerNo}  beli (idempoten via clientRef)
 *  - GET  /orders/:id                                 status (cek ulang bila pending)
 *  - GET  /orders?cursor=&limit=                      riwayat
 */
export const ppobRoutes = new Hono<AppEnv>()
  .use('*', requireAuth, requireTenant)
  .get('/products', async (c) => {
    const r = await ppob.listProducts({
      category: c.req.query('category') ?? '',
      customerNo: c.req.query('customerNo') || undefined,
    });
    return c.json(ok(r.items, { operator: r.operator, enabled: ppob.ppobEnabled() }));
  })
  .post('/orders', async (c) => {
    const input = ppob.orderCreateSchema.parse(await c.req.json());
    const a = c.get('auth');
    const order = await ppob.createOrder({ businessId: a.businessId!, userId: a.userId }, input);
    return c.json(ok(order), 201);
  })
  .get('/orders/:id', async (c) => c.json(ok(await ppob.getOrderForBusiness(c.get('auth').businessId!, c.req.param('id')))))
  .get('/orders', async (c) => {
    const r = await ppob.listOrdersForBusiness(c.get('auth').businessId!, {
      cursor: c.req.query('cursor'),
      limit: Number(c.req.query('limit') ?? 30) || 30,
    });
    return c.json(ok(r.items, { nextCursor: r.nextCursor, hasMore: r.nextCursor !== null }));
  });

/** Webhook Digiflazz (tanpa Bearer; diverifikasi X-Hub-Signature). Base `/v1/webhooks`. */
export const webhookRoutes = new Hono<AppEnv>().post('/digiflazz', async (c) => {
  const raw = await c.req.text();
  const r = await ppob.handleWebhook(raw, {
    signature: c.req.header('x-hub-signature'),
    event: c.req.header('x-digiflazz-event'),
  });
  return c.text(r.body, r.status as 200);
});
