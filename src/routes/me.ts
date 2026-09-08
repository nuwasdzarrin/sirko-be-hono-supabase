import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { handleMe } from '../handlers/me.handlers.js';

/** GET /v1/me (Bearer). Base di-mount pada `/v1`. */
export const meRoutes = new Hono<AppEnv>().get('/me', requireAuth, handleMe);
