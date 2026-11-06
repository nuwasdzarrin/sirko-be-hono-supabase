import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import {
  handleLogin,
  handleRefresh,
  handleSwitchBusiness,
} from '../handlers/auth.handlers.js';
import { requireAuth } from '../middleware/auth.js';
import { ok } from '../lib/envelope.js';
import { forbidden } from '../lib/errors.js';
import * as acct from '../services/account.service.js';
import * as authService from '../services/auth.service.js';

/** Rute auth self-owned (tanpa Bearer kecuali disebut). Base di-mount pada `/v1/auth`. */
export const authRoutes = new Hono<AppEnv>()
  // Daftar akun = POST /register + OTP (endpoint lama register-business dihapus 2026-11-07).
  .post('/login', handleLogin)
  .post('/refresh', handleRefresh)
  .post('/switch-business', requireAuth, handleSwitchBusiness)

  // ── Akun pemilik (SPEC-warung-akun-ppob.md) ──
  .post('/register', async (c) => {
    const input = acct.registerSchema.parse(await c.req.json());
    await acct.hitRateLimit(`reg:${acct.clientIp(c.req.raw.headers)}`, 10, 3_600_000, 'Terlalu banyak pendaftaran dari jaringan ini. Coba lagi nanti.');
    return c.json(ok(await acct.register(input)), 201);
  })
  .post('/verify-email', async (c) => {
    const { email, code } = acct.verifyEmailSchema.parse(await c.req.json());
    const a = await acct.verifyEmail(email, code);
    return c.json(ok(await acct.accountSession(a)), 200);
  })
  .post('/resend-verification', async (c) => {
    const { email } = acct.resendSchema.parse(await c.req.json());
    return c.json(ok(await acct.resendVerification(email)), 200);
  })
  .post('/password/forgot', async (c) => {
    const { login } = acct.forgotSchema.parse(await c.req.json());
    await acct.hitRateLimit(`forgot:${acct.clientIp(c.req.raw.headers)}`, 10, 3_600_000, 'Terlalu banyak permintaan. Coba lagi nanti.');
    return c.json(ok(await acct.forgotPassword(login)), 200);
  })
  .post('/password/reset', async (c) => {
    const { login, code, newPassword } = acct.resetSchema.parse(await c.req.json());
    const a = await acct.resetPassword(login, code, newPassword);
    // Langsung masuk dengan password baru (semua sesi lama sudah dicabut).
    return c.json(ok(await authService.login({ emailOrPhone: a.email ?? login, password: newPassword }, acct.clientIp(c.req.raw.headers))), 200);
  })
  .post('/password/change', requireAuth, async (c) => {
    const { currentPassword, newPassword } = acct.changePasswordSchema.parse(await c.req.json());
    const accountId = await acct.accountIdOfAuth(c.get('auth'));
    if (!accountId) throw forbidden('Akun ini tidak punya login cloud.');
    const a = await acct.changePassword(accountId, currentPassword, newPassword);
    return c.json(ok({ account: acct.accountInfo(a), offlineAuth: acct.offlineAuthOf(a) }), 200);
  });
