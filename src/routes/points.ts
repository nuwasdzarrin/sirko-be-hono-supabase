import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenant.js';
import { ok } from '../lib/envelope.js';
import * as points from '../services/points.service.js';

/**
 * Poin Sirko untuk app (Bearer + konteks toko). Base di-mount pada `/v1/points`.
 * Saldo milik AKUN PEMILIK toko (dipakai bersama semua toko akun itu).
 *  - GET  /                      saldo + 20 mutasi terakhir + top-up menunggu + batas
 *  - GET  /ledger?cursor=&limit= riwayat mutasi (keyset)
 *  - GET  /topups                riwayat top-up
 *  - POST /topups {amount}       ajukan top-up → kode unik & instruksi transfer (owner/admin)
 *  - POST /topups/:id/cancel     batalkan top-up yang masih menunggu
 * Tak ada endpoint transfer/penarikan (desain §3).
 */
export const pointsRoutes = new Hono<AppEnv>()
  .use('*', requireAuth, requireTenant)
  .get('/', async (c) => c.json(ok(await points.summaryForBusiness(c.get('auth').businessId!))))
  .get('/ledger', async (c) => {
    const accountId = await points.accountIdForBusiness(c.get('auth').businessId!);
    const r = await points.listLedger(accountId, {
      cursor: c.req.query('cursor'),
      limit: Number(c.req.query('limit') ?? 30) || 30,
    });
    return c.json(ok(r.items, { nextCursor: r.nextCursor, hasMore: r.nextCursor !== null }));
  })
  .get('/topups', async (c) => {
    const accountId = await points.accountIdForBusiness(c.get('auth').businessId!);
    return c.json(ok(await points.listTopupsForAccount(accountId)));
  })
  .post('/topups', async (c) => {
    const { amount } = points.topupCreateSchema.parse(await c.req.json());
    const a = c.get('auth');
    const r = await points.createTopup({ businessId: a.businessId!, userId: a.userId, role: a.role }, amount);
    return c.json(ok(r), 201);
  })
  .post('/topups/:id/cancel', async (c) => {
    const t = await points.cancelTopup(c.get('auth').businessId!, c.req.param('id'));
    return c.json(ok(t));
  });
