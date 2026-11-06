import { app } from '../../src/app.js';
import { sql } from '../../src/db/client.js';
import { uuid } from '../../src/lib/uuid.js';
import * as subscriptions from '../../src/services/subscription.service.js';
import { registerOwnerStore } from '../helpers/owner-store.js';

/** Helper bersama contract test Juragan (bukan file test). */

export async function req(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
}

export const PASSWORD = 'rahasia123';

/** Daftar toko baru → data sesi register + email & accountId. */
export async function register(prefix = 'jr') {
  const tag = uuid().slice(0, 8);
  const email = `${prefix}-${tag}@toko.id`;
  const r = await registerOwnerStore({
    business: { name: `Toko ${tag}` },
    owner: { name: `Owner ${tag}`, email, password: PASSWORD },
  });
  const [acc] = await sql<{ id: string }[]>`SELECT id FROM accounts WHERE email = ${email}`;
  return {
    status: r.status,
    data: r.json.data,
    email,
    accountId: acc!.id,
    businessId: r.json.data.business.id as string,
    token: r.json.data.accessToken as string,
  };
}

export const login = (emailOrPhone: string, businessId?: string) =>
  req('POST', '/v1/auth/login', { emailOrPhone, password: PASSWORD, ...(businessId ? { businessId } : {}) });

/** Jadikan akun Juragan lewat alur sungguhan: checkout → konfirmasi admin. */
export async function makeJuragan(token: string, period: 'monthly' | 'yearly' = 'monthly') {
  const co = await req('POST', '/v1/plan/checkout', { period }, token);
  await subscriptions.confirmPayment(co.json.data.id, 'admin-test');
  return co.json.data;
}

/** Bentuk kunci rekursif sebuah respons (untuk membandingkan "bentuk identik"). */
export function shape(v: unknown): unknown {
  if (Array.isArray(v)) return v.length && typeof v[0] === 'object' ? [shape(v[0])] : 'v[]'; // array primitif = nilai
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, shape((v as Record<string, unknown>)[k])]));
  }
  return 'v'; // hanya struktur kunci (nilai & null diabaikan)
}
