import { kvGet, kvSet } from '../db/db';
import { ApiError, request } from '../lib/api';
import { verifyOfflinePassword, type OfflineAuth } from '../lib/crypto';
import { planFromJson, WARUNG, type PlanInfo } from '../lib/plan';

/**
 * Sesi akun & toko di browser (KONTRAK-API-akun-app.md §2–§5).
 *
 * Disimpan di IndexedDB global (`sirko` → kv `session`):
 *  - akun, `offlineAuth` (login offline), `plan` (milik AKUN, bukan toko), daftar toko;
 *  - brankas token PER TOKO. Refresh ditolak (401/403) → hanya token toko itu yang dibuang;
 *    toko lain tetap masuk (pelajaran audit Juragan: jangan logout massal).
 */

export interface SessionUser {
  id: string;
  name: string;
  role: string;
  businessId: string | null;
}
export interface StoreSummary {
  id: string;
  name: string;
  role?: string;
}
export interface AccountInfo {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}
export interface StoreToken {
  access: string;
  refresh: string;
  user: SessionUser;
  businessName: string;
  businessType: string | null;
}
export interface Session {
  account: AccountInfo | null;
  offlineAuth: OfflineAuth | null;
  plan: PlanInfo;
  businesses: StoreSummary[];
  activeBusinessId: string | null;
  vault: Record<string, StoreToken>;
  /** Token sesi akun (belum punya toko) — hanya untuk buat toko / me. */
  accountToken: { access: string; refresh: string } | null;
}

/** Bentuk respons sesi server (login, verify, switch-business, POST /v1/businesses). */
export interface ServerSession {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
  business: { id: string; name: string; businessType: string | null } | null;
  businesses?: StoreSummary[];
  plan?: unknown;
  account?: AccountInfo | null;
  offlineAuth?: OfflineAuth | null;
}

const KEY = 'session';

export async function loadSession(): Promise<Session | null> {
  return (await kvGet<Session>(KEY)) ?? null;
}

export async function saveSession(s: Session | null): Promise<void> {
  await kvSet(KEY, s ?? undefined);
}

/** Gabungkan respons sesi server ke sesi tersimpan. */
export function mergeServerSession(prev: Session | null, r: ServerSession): Session {
  const s: Session = prev
    ? { ...prev, vault: { ...prev.vault } }
    : { account: null, offlineAuth: null, plan: WARUNG, businesses: [], activeBusinessId: null, vault: {}, accountToken: null };
  if (r.account !== undefined) s.account = r.account;
  if (r.offlineAuth) s.offlineAuth = r.offlineAuth;
  if (r.plan) s.plan = planFromJson(r.plan);
  if (r.businesses) s.businesses = r.businesses;
  if (r.business) {
    s.vault[r.business.id] = {
      access: r.accessToken,
      refresh: r.refreshToken,
      user: r.user,
      businessName: r.business.name,
      businessType: r.business.businessType ?? null,
    };
    s.activeBusinessId = r.business.id;
    s.accountToken = null;
    if (!s.businesses.some((b) => b.id === r.business!.id)) s.businesses = [...s.businesses, { id: r.business.id, name: r.business.name, role: r.user.role }];
  } else {
    s.accountToken = { access: r.accessToken, refresh: r.refreshToken };
  }
  return s;
}

export const normalizeWa = (s: string) => {
  const d = s.replace(/[^\d]/g, '');
  if (d.startsWith('62')) return d;
  if (d.startsWith('0')) return `62${d.slice(1)}`;
  if (d.startsWith('8')) return `62${d}`;
  return d;
};

/** Identitas login cocok dengan akun tersimpan (email persis / WA dinormalisasi)? */
export function sameIdentity(login: string, a: AccountInfo | null): boolean {
  if (!a) return false;
  const l = login.trim().toLowerCase();
  if (l.includes('@')) return !!a.email && a.email.toLowerCase() === l;
  return !!a.phone && normalizeWa(l) === normalizeWa(a.phone);
}

export async function loginOnline(login: string, password: string, businessId?: string): Promise<Session> {
  const r = await request<ServerSession>('POST', '/v1/auth/login', { body: { login: login.trim(), password, ...(businessId ? { businessId } : {}) } });
  const s = mergeServerSession(await loadSession(), r.data);
  await saveSession(s);
  await kvSet('lastLogin', login.trim());
  return s;
}

/** Login tanpa internet dengan `offlineAuth` tersimpan. */
export async function loginOffline(login: string, password: string): Promise<Session | null> {
  const s = await loadSession();
  if (!s || !sameIdentity(login, s.account) || !s.activeBusinessId) return null;
  return (await verifyOfflinePassword(password, s.offlineAuth)) ? s : null;
}

export async function createBusiness(name: string, businessType: string | null): Promise<Session> {
  const s = await loadSession();
  const token = s?.accountToken?.access ?? (s?.activeBusinessId ? s.vault[s.activeBusinessId]?.access : null);
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Sesi berakhir. Masuk lagi.');
  const r = await request<ServerSession>('POST', '/v1/businesses', { token, body: { name, ...(businessType ? { businessType } : {}) } });
  const next = mergeServerSession(s, r.data);
  await saveSession(next);
  return next;
}

/** Pindah toko (wajib online). Token toko asal tetap di brankas. */
export async function switchBusiness(businessId: string): Promise<Session> {
  const s = await loadSession();
  const token = await accessToken();
  if (!s || !token) throw new ApiError(401, 'UNAUTHENTICATED', 'Sesi berakhir. Masuk lagi.');
  const r = await request<ServerSession>('POST', '/v1/auth/switch-business', { token, body: { businessId } });
  const next = mergeServerSession(s, r.data);
  await saveSession(next);
  return next;
}

/** Perbarui akun, plan, daftar toko & offlineAuth dari `GET /v1/me`. */
export async function refreshMe(): Promise<Session | null> {
  const s = await loadSession();
  if (!s) return null;
  const r = await authed<{ plan?: unknown; businesses?: StoreSummary[]; account?: AccountInfo; offlineAuth?: OfflineAuth | null }>('GET', '/v1/me');
  const next: Session = { ...s };
  if (r.data.plan) next.plan = planFromJson(r.data.plan);
  if (r.data.businesses) next.businesses = r.data.businesses;
  if (r.data.account) next.account = r.data.account;
  if (r.data.offlineAuth) next.offlineAuth = r.data.offlineAuth;
  await saveSession(next);
  return next;
}

export async function accessToken(): Promise<string | null> {
  const s = await loadSession();
  if (!s) return null;
  if (s.activeBusinessId && s.vault[s.activeBusinessId]) return s.vault[s.activeBusinessId]!.access;
  return s.accountToken?.access ?? null;
}

let refreshing: Promise<boolean> | null = null;

/**
 * Refresh token toko aktif. 401/403 → buang token toko ITU saja (toko lain tetap) dan kembalikan
 * false; error jaringan/5xx → token tak disentuh.
 */
export async function refreshActive(): Promise<boolean> {
  refreshing ??= (async () => {
    const s = await loadSession();
    const bid = s?.activeBusinessId;
    const tok = bid ? s?.vault[bid] : null;
    if (!s || !bid || !tok) return false;
    try {
      const r = await request<{ accessToken: string; refreshToken: string }>('POST', '/v1/auth/refresh', { body: { refreshToken: tok.refresh } });
      const now = (await loadSession())!;
      if (now.vault[bid]) {
        now.vault[bid] = { ...now.vault[bid]!, access: r.data.accessToken, refresh: r.data.refreshToken };
        await saveSession(now);
      }
      return true;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        const now = (await loadSession())!;
        if (now.vault[bid]?.refresh === tok.refresh) {
          delete now.vault[bid];
          await saveSession(now);
        } else return true; // sudah diganti proses lain
      }
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Permintaan ber-Bearer toko aktif; 401 → refresh sekali lalu ulangi. */
export async function authed<T>(method: string, path: string, body?: unknown) {
  const token = await accessToken();
  if (!token) throw new ApiError(401, 'NEEDS_LOGIN', 'Sesi toko ini berakhir. Masuk lagi untuk sinkron.');
  try {
    return await request<T>(method, path, { token, body });
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    if (!(await refreshActive())) throw new ApiError(401, 'NEEDS_LOGIN', 'Sesi toko ini berakhir. Masuk lagi untuk sinkron.');
    return request<T>(method, path, { token: await accessToken(), body });
  }
}
