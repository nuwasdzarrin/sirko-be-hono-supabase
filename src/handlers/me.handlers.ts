import type { Context } from 'hono';
import type { AppEnv } from '../types.ts';
import { ok } from '../lib/envelope.ts';
import * as authService from '../services/auth.service.ts';

/** GET /v1/me — pakai identitas dari context (di-inject requireAuth). */
export async function handleMe(c: Context<AppEnv>) {
  const auth = c.get('auth');
  const payload = await authService.me({
    userId: auth.userId,
    businessId: auth.businessId,
    role: auth.role,
  });
  return c.json(ok(payload), 200);
}
