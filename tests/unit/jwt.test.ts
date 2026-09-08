import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../src/lib/jwt.js';
import { AppError } from '../../src/lib/errors.js';

const claims = { userId: 'u-1', businessId: 'b-1', role: 'owner' as const };

describe('jwt', () => {
  it('access token roundtrip mempertahankan klaim', async () => {
    const token = await signAccessToken(claims);
    const decoded = await verifyAccessToken(token);
    expect(decoded).toEqual(claims);
  });

  it('businessId null (sirko_admin) tetap terbawa', async () => {
    const token = await signAccessToken({ userId: 'a', businessId: null, role: 'sirko_admin' });
    const decoded = await verifyAccessToken(token);
    expect(decoded.businessId).toBeNull();
    expect(decoded.role).toBe('sirko_admin');
  });

  it('menolak token yang dirusak (UNAUTHENTICATED)', async () => {
    const token = await signAccessToken(claims);
    const tampered = token.slice(0, -3) + 'xxx';
    await expect(verifyAccessToken(tampered)).rejects.toBeInstanceOf(AppError);
    await expect(verifyAccessToken(tampered)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('menolak token sampah', async () => {
    await expect(verifyAccessToken('bukan.jwt.valid')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('menolak token kedaluwarsa', async () => {
    const key = new TextEncoder().encode(process.env.JWT_SECRET!);
    const expired = await new SignJWT({ businessId: 'b-1', role: 'owner' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u-1')
      .setIssuer('sirko-backend')
      .setAudience('sirko-access')
      .setIssuedAt(0)
      .setExpirationTime(1) // exp di 1970 → sudah lewat
      .sign(key);
    await expect(verifyAccessToken(expired)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('access token tak bisa dipakai sebagai refresh (audience beda)', async () => {
    const access = await signAccessToken(claims);
    await expect(verifyRefreshToken(access)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refresh token roundtrip membawa userId & jti', async () => {
    const token = await signRefreshToken({ userId: 'u-9', jti: 'jti-9' });
    const decoded = await verifyRefreshToken(token);
    expect(decoded).toEqual({ userId: 'u-9', jti: 'jti-9' });
  });
});
