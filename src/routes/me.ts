import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { requireAuth } from '../middleware/auth.ts';
import { handleMe } from '../handlers/me.handlers.ts';

/** GET /v1/me (Bearer). Base di-mount pada `/v1`. */
export const meRoutes = new Hono<AppEnv>().get('/me', requireAuth, handleMe);
