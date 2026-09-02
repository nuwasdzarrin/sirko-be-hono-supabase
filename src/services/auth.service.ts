import { sql } from '../db/client.ts';
import { AccountRepository } from '../db/repositories/account.repository.ts';
import { BusinessRepository } from '../db/repositories/business.repository.ts';
import { UserRepository } from '../db/repositories/user.repository.ts';
import { RefreshTokenRepository } from '../db/repositories/refresh_token.repository.ts';
import { hashPassword, verifyPassword } from '../lib/password.ts';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../lib/jwt.ts';
import { effectivePermissions, type Role } from '../lib/permissions.ts';
import { uuid } from '../lib/uuid.ts';
import { nowMs } from '../lib/time.ts';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from '../config/env.ts';
import { conflict, unauthenticated } from '../lib/errors.ts';
import type { RegisterBusinessInput, LoginInput } from '../schemas/auth.schema.ts';

/** Bentuk respons auth (register/login) — sesuai kontrak 10 §1.1/§1.2. */
export interface AuthPayload {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; name: string; role: Role; businessId: string | null };
  business: { id: string; name: string; businessType: string | null } | null;
}

const accounts = new AccountRepository();
const refreshTokens = new RefreshTokenRepository();

/** Terbitkan pasangan token & catat jti refresh untuk rotasi/revoke. */
async function issueTokens(user: {
  id: string;
  businessId: string | null;
  role: Role;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const jti = uuid();
  const ts = nowMs();
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({ userId: user.id, businessId: user.businessId, role: user.role }),
    signRefreshToken({ userId: user.id, jti }),
  ]);
  await refreshTokens.create({
    jti,
    userId: user.id,
    expiresAt: ts + REFRESH_TOKEN_TTL_SECONDS * 1000,
    createdAt: ts,
  });
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/** POST /v1/auth/register-business — buat business + account owner + user owner (atomik). */
export async function registerBusiness(input: RegisterBusinessInput): Promise<AuthPayload> {
  const email = input.owner.email ?? null;
  const phone = input.owner.phone ?? null;

  if (await accounts.existsByEmailOrPhone(email, phone)) {
    throw conflict('Email atau nomor telepon sudah terdaftar');
  }

  const ts = nowMs();
  const businessId = uuid();
  const accountId = uuid();
  const userId = uuid();
  const passwordHash = await hashPassword(input.owner.password);

  try {
    await sql.begin(async (tx) => {
      await BusinessRepository.create(
        {
          id: businessId,
          name: input.business.name,
          businessType: input.business.businessType ?? null,
          createdAt: ts,
          updatedAt: ts,
        },
        tx,
      );
      await accounts.create(
        { id: accountId, email, phone, passwordHash, createdAt: ts, updatedAt: ts },
        tx,
      );
      await UserRepository.create(
        {
          id: userId,
          businessId,
          accountId,
          name: input.owner.name,
          username: null,
          role: 'owner',
          permissions: [],
          createdAt: ts,
          updatedAt: ts,
        },
        tx,
      );
    });
  } catch (err) {
    // Balapan unik email/phone (23505) → CONFLICT alih-alih 500.
    if (isUniqueViolation(err)) throw conflict('Email atau nomor telepon sudah terdaftar');
    throw err;
  }

  const tokens = await issueTokens({ id: userId, businessId, role: 'owner' });
  return {
    ...tokens,
    user: { id: userId, name: input.owner.name, role: 'owner', businessId },
    business: {
      id: businessId,
      name: input.business.name,
      businessType: input.business.businessType ?? null,
    },
  };
}

/** POST /v1/auth/login — verifikasi kredensial, terbitkan token. */
export async function login(input: LoginInput): Promise<AuthPayload> {
  const account = await accounts.findByEmailOrPhone(input.emailOrPhone);
  // Pesan seragam untuk cegah user-enumeration (akun tak ada vs password salah).
  const invalid = () => unauthenticated('Email/telepon atau password salah');
  if (!account) {
    // Tetap jalankan verifikasi dummy agar waktu respons relatif seragam.
    await verifyPassword(input.password, '$2a$10$0000000000000000000000000000000000000000000000000000');
    throw invalid();
  }
  const passwordOk = await verifyPassword(input.password, account.password_hash);
  if (!passwordOk) throw invalid();

  const user = await UserRepository.findByAccountIdForAuth(account.id);
  if (!user || !user.is_active) throw invalid();

  const tokens = await issueTokens({
    id: user.id,
    businessId: user.business_id,
    role: user.role,
  });

  const business = user.business_id ? await loadBusinessSummary(user.business_id) : null;
  return {
    ...tokens,
    user: { id: user.id, name: user.name, role: user.role, businessId: user.business_id },
    business,
  };
}

/** POST /v1/auth/refresh — rotasi refresh token, terbitkan access baru. */
export async function refresh(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const { userId, jti } = await verifyRefreshToken(refreshToken);
  if (!(await refreshTokens.isActive(jti, userId, nowMs()))) {
    throw unauthenticated('Refresh token sudah dicabut atau tidak dikenal');
  }
  const user = await UserRepository.findByIdForAuth(userId);
  if (!user || !user.is_active) throw unauthenticated('Akun tidak aktif');

  // Rotasi: cabut jti lama, terbitkan pasangan baru.
  await refreshTokens.revoke(jti);
  return issueTokens({ id: user.id, businessId: user.business_id, role: user.role });
}

/** GET /v1/me — profil pengguna + business + permission efektif (kontrak 10 §1.4). */
export async function me(auth: {
  userId: string;
  businessId: string | null;
  role: Role;
}): Promise<{
  user: { id: string; name: string; role: Role; businessId: string | null };
  business: { id: string; name: string; businessType: string | null } | null;
  permissions: string[];
}> {
  // sirko_admin (businessId null) tak punya toko; user biasa dibaca tenant-scoped.
  if (!auth.businessId) {
    const user = await UserRepository.findByIdForAuth(auth.userId);
    if (!user) throw unauthenticated('User tidak ditemukan');
    return {
      user: { id: user.id, name: user.name, role: user.role, businessId: null },
      business: null,
      permissions: effectivePermissions(user.role, user.permissions),
    };
  }

  const userRepo = new UserRepository(auth.businessId);
  const businessRepo = new BusinessRepository(auth.businessId);
  const [user, business] = await Promise.all([userRepo.getById(auth.userId), businessRepo.getSelf()]);
  if (!user) throw unauthenticated('User tidak ditemukan');

  return {
    user: { id: user.id, name: user.name, role: user.role, businessId: auth.businessId },
    business: business
      ? { id: business.id, name: business.name, businessType: business.business_type }
      : null,
    permissions: effectivePermissions(user.role, user.permissions),
  };
}

async function loadBusinessSummary(
  businessId: string,
): Promise<{ id: string; name: string; businessType: string | null } | null> {
  const b = await new BusinessRepository(businessId).getSelf();
  return b ? { id: b.id, name: b.name, businessType: b.business_type } : null;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
