import type { Context } from 'hono';
import type { AppEnv } from '../types.js';
import { ok } from '../lib/envelope.js';
import { registerBusinessSchema, loginSchema, refreshSchema } from '../schemas/auth.schema.js';
import * as authService from '../services/auth.service.js';

/** Handler tipis: parse+validasi (zod) → service → envelope sukses. */

export async function handleRegisterBusiness(c: Context<AppEnv>) {
  const input = registerBusinessSchema.parse(await c.req.json());
  const payload = await authService.registerBusiness(input);
  return c.json(ok(payload), 201);
}

export async function handleLogin(c: Context<AppEnv>) {
  const input = loginSchema.parse(await c.req.json());
  const payload = await authService.login(input);
  return c.json(ok(payload), 200);
}

export async function handleRefresh(c: Context<AppEnv>) {
  const { refreshToken } = refreshSchema.parse(await c.req.json());
  const tokens = await authService.refresh(refreshToken);
  return c.json(ok(tokens), 200);
}
