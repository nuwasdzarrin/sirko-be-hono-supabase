import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import {
  env,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from '../config/env.js';
import { isRole, type Role } from './permissions.js';
import { unauthenticated } from './errors.js';

/**
 * JWT self-owned (jose, HS256) — portabel, tanpa Supabase Auth.
 * Access token membawa identitas & tenant; refresh token membawa `jti` untuk rotasi.
 */

const accessKey = new TextEncoder().encode(env.JWT_SECRET);
const refreshKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET);
const ALG = 'HS256';
const ISSUER = 'sirko-backend';
const AUD_ACCESS = 'sirko-access';
const AUD_REFRESH = 'sirko-refresh';

export interface AccessClaims {
  userId: string;
  businessId: string | null;
  role: Role;
}

export interface RefreshClaims {
  userId: string;
  jti: string;
}

/** Terbitkan access token. `businessId` bisa null untuk sirko_admin. */
export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ businessId: claims.businessId, role: claims.role })
    .setProtectedHeader({ alg: ALG })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUD_ACCESS)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(accessKey);
}

/** Terbitkan refresh token dengan `jti` (dicatat di tabel refresh_tokens untuk revoke). */
export async function signRefreshToken(claims: RefreshClaims): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: ALG })
    .setSubject(claims.userId)
    .setJti(claims.jti)
    .setIssuer(ISSUER)
    .setAudience(AUD_REFRESH)
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TOKEN_TTL_SECONDS}s`)
    .sign(refreshKey);
}

/** Verifikasi access token → klaim tervalidasi. Lempar AppError UNAUTHENTICATED bila invalid/kedaluwarsa. */
export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, accessKey, {
      issuer: ISSUER,
      audience: AUD_ACCESS,
    });
    const { sub, businessId, role } = payload as {
      sub?: string;
      businessId?: unknown;
      role?: unknown;
    };
    if (!sub || !isRole(role)) {
      throw unauthenticated('Klaim token tidak lengkap');
    }
    return {
      userId: sub,
      businessId: typeof businessId === 'string' ? businessId : null,
      role,
    };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) throw unauthenticated('Token kedaluwarsa');
    if (err instanceof joseErrors.JOSEError) throw unauthenticated('Token tidak valid');
    throw err;
  }
}

/** Verifikasi refresh token → { userId, jti }. Lempar AppError UNAUTHENTICATED bila invalid. */
export async function verifyRefreshToken(token: string): Promise<RefreshClaims> {
  try {
    const { payload } = await jwtVerify(token, refreshKey, {
      issuer: ISSUER,
      audience: AUD_REFRESH,
    });
    const { sub, jti } = payload;
    if (!sub || !jti) throw unauthenticated('Refresh token tidak lengkap');
    return { userId: sub, jti };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) throw unauthenticated('Refresh token kedaluwarsa');
    if (err instanceof joseErrors.JOSEError) throw unauthenticated('Refresh token tidak valid');
    throw err;
  }
}
