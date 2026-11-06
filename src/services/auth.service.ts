import { sql } from '../db/client.js';
import { AccountRepository } from '../db/repositories/account.repository.js';
import { BusinessRepository } from '../db/repositories/business.repository.js';
import { UserRepository, type UserRow } from '../db/repositories/user.repository.js';
import { RefreshTokenRepository } from '../db/repositories/refresh_token.repository.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../lib/jwt.js';
import { effectivePermissions, type Role } from '../lib/permissions.js';
import { uuid } from '../lib/uuid.js';
import { nowMs } from '../lib/time.js';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from '../config/env.js';
import { AppError, conflict, forbidden, unauthenticated } from '../lib/errors.js';
import type {
  LoginInput,
  CreateBusinessInput,
} from '../schemas/auth.schema.js';
import * as plans from './plan.service.js';
import type { EffectivePlan } from './plan.service.js';
import * as acct from './account.service.js';
import type { AccountInfo, OfflineAuth } from './account.service.js';

/** Ringkasan keanggotaan toko (kontrak app §1.2). */
export interface BusinessSummary {
  id: string;
  name: string;
  role: Role;
}

/**
 * Bentuk respons sesi — SAMA untuk register, login, switch-business, dan
 * POST /v1/businesses (kontrak app §2, §6.8). Field lama (`user.businessId`,
 * `business`) dipertahankan untuk app ≤ 1.2.0+15.
 */
export interface AuthPayload {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; name: string; role: Role; businessId: string | null };
  business: { id: string; name: string; businessType: string | null } | null;
  businesses: BusinessSummary[];
  plan: EffectivePlan;
  /** Akun pemilik (nama, email, WA). null untuk user tanpa akun cloud. */
  account: AccountInfo | null;
  /** Turunan password khusus login OFFLINE di HP (bukan hash server). */
  offlineAuth: OfflineAuth | null;
}

const accounts = new AccountRepository();
const refreshTokens = new RefreshTokenRepository();

export const planRequired = (message = 'Fitur ini butuh Paket Juragan.') =>
  new AppError('PLAN_REQUIRED', message);
export const planLimit = (max: number) =>
  new AppError('PLAN_LIMIT', `Paket Juragan maksimal ${max} toko.`);

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

async function listBusinessSummaries(accountId: string | null): Promise<BusinessSummary[]> {
  if (!accountId) return [];
  const rows = await UserRepository.listMembershipsForAuth(accountId);
  return rows.map((r) => ({ id: r.business_id as string, name: r.business_name, role: r.role }));
}

/**
 * SATU-SATUNYA pembentuk respons sesi: terbitkan token untuk baris `users` toko
 * tujuan, catat `last_business_id`, sertakan daftar toko & paket.
 */
async function buildSession(user: Pick<UserRow, 'id' | 'name' | 'role' | 'business_id' | 'account_id'>): Promise<AuthPayload> {
  const [tokens, business, businesses, plan] = await Promise.all([
    issueTokens({ id: user.id, businessId: user.business_id, role: user.role }),
    user.business_id ? loadBusinessSummary(user.business_id) : Promise.resolve(null),
    listBusinessSummaries(user.account_id),
    plans.forBusiness(user.business_id, user.account_id),
  ]);
  if (user.account_id && user.business_id) {
    await sql`UPDATE accounts SET last_business_id = ${user.business_id} WHERE id = ${user.account_id}`;
  }
  const account = user.account_id ? await acct.accountById(user.account_id) : null;
  return {
    ...tokens,
    user: { id: user.id, name: user.name, role: user.role, businessId: user.business_id },
    business,
    businesses,
    plan,
    account: account ? acct.accountInfo(account) : null,
    offlineAuth: account ? acct.offlineAuthOf(account) : null,
  };
}

/**
 * POST /v1/auth/login — verifikasi kredensial lalu pilih toko:
 * `businessId` body (harus anggota, else 403) → `last_business_id` → toko utama.
 * Paket warung hanya boleh membuka toko utama (sama dengan switch-business).
 */
export async function login(input: LoginInput, ip = 'unknown'): Promise<AuthPayload | acct.AccountSessionPayload> {
  // Email ATAU nomor WA + password; 5 gagal → kunci 15 menit per akun & per IP.
  let account = await acct.checkCredentials(input.emailOrPhone, input.password, ip);
  if (account.pending_verification) await acct.rejectUnverified(account);
  account = await acct.ensureOffline(account, input.password);

  const memberships = await UserRepository.listMembershipsForAuth(account.id);
  if (memberships.length === 0) {
    // sirko_admin (baris users tanpa toko): perilaku lama.
    const admin = await UserRepository.findByAccountIdForAuth(account.id);
    if (admin && admin.role === 'sirko_admin' && admin.is_active && !admin.business_id) return buildSession(admin);
    // Pemilik yang belum membuat toko → sesi akun (lanjut "Buat toko").
    return acct.accountSession(account);
  }

  const [plan, primaryId, last] = await Promise.all([
    plans.effective(account.id),
    UserRepository.primaryBusinessIdOfAccount(account.id),
    sql<{ last_business_id: string | null }[]>`SELECT last_business_id FROM accounts WHERE id = ${account.id}`,
  ]);
  const multi = plans.hasFeature(plan, 'multi_store');
  const byId = (id: string | null | undefined) => memberships.find((m) => m.business_id === id);
  const allowed = (id: string | null | undefined) => multi || !primaryId || id === primaryId || memberships.length === 1;

  let chosen: UserRow | undefined;
  if (input.businessId) {
    chosen = byId(input.businessId);
    if (!chosen) throw forbidden('Anda bukan anggota toko ini.');
    if (!allowed(chosen.business_id)) throw planRequired('Toko cabang hanya bisa dibuka dengan Paket Juragan.');
  } else {
    const lastId = last[0]?.last_business_id;
    chosen = (allowed(lastId) ? byId(lastId) : undefined) ?? byId(primaryId) ?? memberships[0];
  }
  return buildSession(chosen!);
}

/**
 * POST /v1/auth/switch-business — token baru untuk toko lain milik akun yang sama.
 * Bukan anggota → 403 FORBIDDEN (tanpa membocorkan keberadaan toko). Paket
 * warung & bukan toko utama → 403 PLAN_REQUIRED. Token toko asal tak dicabut.
 */
export async function switchBusiness(auth: { userId: string }, businessId: string): Promise<AuthPayload> {
  const accountId = await plans.accountIdOfUser(auth.userId);
  if (!accountId) throw forbidden('Anda bukan anggota toko ini.');
  const target = await UserRepository.findMembershipForAuth(accountId, businessId);
  if (!target) throw forbidden('Anda bukan anggota toko ini.');

  const [plan, primaryId] = await Promise.all([
    plans.effective(accountId),
    UserRepository.primaryBusinessIdOfAccount(accountId),
  ]);
  if (!plans.hasFeature(plan, 'multi_store') && primaryId && businessId !== primaryId) {
    throw planRequired('Toko cabang hanya bisa dibuka dengan Paket Juragan.');
  }
  return buildSession(target);
}

/**
 * POST /v1/businesses — owner menambah toko (butuh multi_store, kuota maxStores).
 * Akun dikunci (FOR UPDATE) selama transaksi → dua permintaan bersamaan tak
 * bisa melampaui kuota. Respons = sesi untuk toko baru (token langsung bisa push).
 */
export async function createBusiness(
  auth: { userId: string; role: Role; scope?: 'account' },
  input: CreateBusinessInput,
): Promise<AuthPayload> {
  if (auth.role !== 'owner') throw forbidden('Hanya pemilik toko yang bisa menambah toko.');
  const accountId = await acct.accountIdOfAuth(auth);
  if (!accountId) throw forbidden('Hanya pemilik toko yang bisa menambah toko.');

  const plan = await plans.effective(accountId);
  const ownedNow = await UserRepository.countOwnedBusinesses(accountId);
  // Toko PERTAMA selalu gratis (paket Warung); toko berikutnya butuh multi_store.
  if (ownedNow > 0 && !plans.hasFeature(plan, 'multi_store')) {
    throw planRequired('Tambah toko cabang hanya bisa dengan Paket Juragan.');
  }

  const account = await acct.accountById(accountId);
  const [me] = auth.scope === 'account' ? [] : await sql<{ name: string }[]>`SELECT name FROM users WHERE id = ${auth.userId}`;
  const ts = nowMs();
  const businessId = uuid();
  const userId = uuid();
  const ownerName = me?.name ?? account?.name ?? 'Pemilik';

  await sql.begin(async (tx) => {
    await tx`SELECT id FROM accounts WHERE id = ${accountId} FOR UPDATE`;
    const owned = await UserRepository.countOwnedBusinesses(accountId, tx);
    if (owned > 0 && !plans.hasFeature(plan, 'multi_store')) throw planRequired('Tambah toko cabang hanya bisa dengan Paket Juragan.');
    if (owned >= Math.max(1, plan.maxStores)) throw planLimit(plan.maxStores);
    await BusinessRepository.create(
      { id: businessId, name: input.name, businessType: input.businessType ?? null, createdAt: ts, updatedAt: ts },
      tx,
    );
    // Owner versi cloud: tanpa username/PIN (app mengabaikannya saat pull, SYNC.md §8.3).
    await UserRepository.create(
      {
        id: userId,
        businessId,
        accountId,
        name: ownerName,
        username: null,
        role: 'owner',
        permissions: [],
        createdAt: ts,
        updatedAt: ts,
      },
      tx,
    );
  });

  return buildSession({ id: userId, name: ownerName, role: 'owner', business_id: businessId, account_id: accountId });
}

/** GET /v1/me/businesses — daftar toko akun + paket. */
export async function myBusinesses(auth: { userId: string; businessId: string | null; scope?: 'account' }): Promise<{
  businesses: BusinessSummary[];
  plan: EffectivePlan;
}> {
  const accountId = await acct.accountIdOfAuth(auth);
  const [businesses, plan] = await Promise.all([
    listBusinessSummaries(accountId),
    plans.forBusiness(auth.businessId, accountId),
  ]);
  return { businesses, plan };
}

/** POST /v1/auth/refresh — rotasi refresh token, terbitkan access baru. */
export async function refresh(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const { userId, jti } = await verifyRefreshToken(refreshToken);
  // Refresh token sesi AKUN (pemilik tanpa toko): subjek = accounts.id.
  const acctRow = await sql<{ account_id: string }[]>`
    SELECT account_id FROM refresh_tokens
    WHERE jti = ${jti} AND account_id = ${userId} AND user_id IS NULL AND revoked = false AND expires_at > ${nowMs()}`;
  if (acctRow[0]) {
    await refreshTokens.revoke(jti);
    return acct.issueAccountTokens(acctRow[0].account_id);
  }
  if (!(await refreshTokens.isActive(jti, userId, nowMs()))) {
    throw unauthenticated('Refresh token sudah dicabut atau tidak dikenal');
  }
  const user = await UserRepository.findByIdForAuth(userId);
  if (!user || !user.is_active) throw unauthenticated('Akun tidak aktif');

  // Rotasi: cabut jti lama, terbitkan pasangan baru. Token tetap untuk toko
  // baris users ini (per toko — K3), tak terpengaruh switch-business.
  // SENGAJA tidak memeriksa paket (J7): HP yang sudah login ke toko cabang
  // tetap bisa refresh & sync setelah langganan habis. Jangan tambah guard di sini.
  await refreshTokens.revoke(jti);
  return issueTokens({ id: user.id, businessId: user.business_id, role: user.role });
}

/** GET /v1/me — profil pengguna + business + permission efektif + paket + daftar toko. */
export async function me(auth: {
  userId: string;
  businessId: string | null;
  role: Role;
  scope?: 'account';
}): Promise<{
  user: { id: string; name: string; role: Role; businessId: string | null };
  business: { id: string; name: string; businessType: string | null } | null;
  permissions: string[];
  plan: EffectivePlan;
  businesses: BusinessSummary[];
  account: AccountInfo | null;
  offlineAuth: OfflineAuth | null;
}> {
  const withAccount = async <T extends object>(base: T, accountId: string | null) => {
    const a = accountId ? await acct.accountById(accountId) : null;
    return { ...base, account: a ? acct.accountInfo(a) : null, offlineAuth: a ? acct.offlineAuthOf(a) : null };
  };
  // Sesi AKUN (pemilik belum punya toko / token tingkat akun).
  if (auth.scope === 'account') {
    const a = await acct.accountById(auth.userId);
    if (!a) throw unauthenticated('Akun tidak ditemukan');
    return withAccount(
      {
        user: { id: a.id, name: a.name ?? 'Pemilik', role: 'owner' as Role, businessId: null },
        business: null,
        permissions: effectivePermissions('owner'),
        plan: await plans.effective(a.id),
        businesses: await listBusinessSummaries(a.id),
      },
      a.id,
    );
  }
  // sirko_admin (businessId null) tak punya toko; user biasa dibaca tenant-scoped.
  if (!auth.businessId) {
    const user = await UserRepository.findByIdForAuth(auth.userId);
    if (!user) throw unauthenticated('User tidak ditemukan');
    return withAccount(
      {
        user: { id: user.id, name: user.name, role: user.role, businessId: null },
        business: null,
        permissions: effectivePermissions(user.role, user.permissions),
        plan: await plans.effective(user.account_id),
        businesses: await listBusinessSummaries(user.account_id),
      },
      user.account_id,
    );
  }

  const userRepo = new UserRepository(auth.businessId);
  const businessRepo = new BusinessRepository(auth.businessId);
  const [user, business] = await Promise.all([userRepo.getById(auth.userId), businessRepo.getSelf()]);
  if (!user) throw unauthenticated('User tidak ditemukan');
  const [plan, businesses] = await Promise.all([
    plans.forBusiness(auth.businessId, user.account_id),
    listBusinessSummaries(user.account_id),
  ]);

  return withAccount(
    {
      user: { id: user.id, name: user.name, role: user.role, businessId: auth.businessId },
      business: business
        ? { id: business.id, name: business.name, businessType: business.business_type }
        : null,
      permissions: effectivePermissions(user.role, user.permissions),
      plan,
      businesses,
    },
    user.account_id,
  );
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
