import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { handleMe, handleMyBusinesses } from '../handlers/me.handlers.js';

/** GET /v1/me, GET /v1/me/businesses (Bearer). Base di-mount pada `/v1`. */
export const meRoutes = new Hono<AppEnv>()
  .get('/me', requireAuth, handleMe)
  .get('/me/businesses', requireAuth, handleMyBusinesses);
