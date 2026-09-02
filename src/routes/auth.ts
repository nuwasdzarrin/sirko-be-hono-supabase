import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import {
  handleRegisterBusiness,
  handleLogin,
  handleRefresh,
} from '../handlers/auth.handlers.ts';

/** Rute auth self-owned (tanpa Bearer). Base di-mount pada `/v1/auth`. */
export const authRoutes = new Hono<AppEnv>()
  .post('/register-business', handleRegisterBusiness)
  .post('/login', handleLogin)
  .post('/refresh', handleRefresh);
