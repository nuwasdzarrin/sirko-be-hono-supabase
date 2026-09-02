import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app.ts';
import { sql } from '../../src/db/client.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { uuid } from '../../src/lib/uuid.ts';

/**
 * Contract test auth: register → login → /v1/me; tolak token invalid; isolasi
 * tenant. Butuh Postgres nyata (DATABASE_URL). Bila DB tak tersambung, seluruh
 * suite di-skip (bukan gagal) — CI/dev tanpa DB tetap hijau di unit test.
 */

let dbUp = false;
try {
  await sql`SELECT 1`;
  dbUp = true;
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn(`[contract] DB tak tersambung — suite di-skip: ${(err as Error).message}`);
}

const suite = dbUp ? describe : describe.skip;

async function post(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await app.request(path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
}

async function get(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await app.request(path, { method: 'GET', headers });
  return { status: res.status, json: (await res.json()) as any };
}

function newOwner() {
  const tag = uuid().slice(0, 8);
  return {
    business: { name: `Toko ${tag}`, businessType: 'kelontong' },
    owner: { name: `Owner ${tag}`, email: `owner-${tag}@toko.id`, password: 'rahasia123' },
  };
}

suite('Auth contract', () => {
  beforeAll(async () => {
    await runMigrations(sql);
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('register-business → 201 dengan token, user owner, business', async () => {
    const input = newOwner();
    const { status, json } = await post('/v1/auth/register-business', input);
    expect(status).toBe(201);
    expect(json.data.accessToken).toBeTypeOf('string');
    expect(json.data.refreshToken).toBeTypeOf('string');
    expect(json.data.expiresIn).toBe(3600);
    expect(json.data.user.role).toBe('owner');
    expect(json.data.user.businessId).toBe(json.data.business.id);
    expect(json.data.business.name).toBe(input.business.name);
  });

  it('register-business email duplikat → 409 CONFLICT', async () => {
    const input = newOwner();
    await post('/v1/auth/register-business', input);
    const { status, json } = await post('/v1/auth/register-business', input);
    expect(status).toBe(409);
    expect(json.error.code).toBe('CONFLICT');
  });

  it('login benar → 200; password salah → 401', async () => {
    const input = newOwner();
    await post('/v1/auth/register-business', input);

    const okRes = await post('/v1/auth/login', {
      emailOrPhone: input.owner.email,
      password: input.owner.password,
    });
    expect(okRes.status).toBe(200);
    expect(okRes.json.data.accessToken).toBeTypeOf('string');

    const badRes = await post('/v1/auth/login', {
      emailOrPhone: input.owner.email,
      password: 'salah-total',
    });
    expect(badRes.status).toBe(401);
    expect(badRes.json.error.code).toBe('UNAUTHENTICATED');
  });

  it('GET /v1/me dengan token → 200 profil + permissions', async () => {
    const input = newOwner();
    const reg = await post('/v1/auth/register-business', input);
    const token = reg.json.data.accessToken;

    const { status, json } = await get('/v1/me', token);
    expect(status).toBe(200);
    expect(json.data.user.id).toBe(reg.json.data.user.id);
    expect(json.data.business.id).toBe(reg.json.data.business.id);
    expect(json.data.permissions).toContain('administrator');
  });

  it('GET /v1/me tanpa token → 401', async () => {
    const { status, json } = await get('/v1/me');
    expect(status).toBe(401);
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('GET /v1/me token dirusak → 401', async () => {
    const input = newOwner();
    const reg = await post('/v1/auth/register-business', input);
    const tampered = (reg.json.data.accessToken as string).slice(0, -3) + 'zzz';
    const { status, json } = await get('/v1/me', tampered);
    expect(status).toBe(401);
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('validasi gagal (password pendek) → 422 VALIDATION', async () => {
    const input = newOwner();
    input.owner.password = '123';
    const { status, json } = await post('/v1/auth/register-business', input);
    expect(status).toBe(422);
    expect(json.error.code).toBe('VALIDATION');
  });

  it('isolasi tenant: token toko A hanya melihat business A (bukan B)', async () => {
    const a = await post('/v1/auth/register-business', newOwner());
    const b = await post('/v1/auth/register-business', newOwner());
    expect(a.json.data.business.id).not.toBe(b.json.data.business.id);

    const meA = await get('/v1/me', a.json.data.accessToken);
    const meB = await get('/v1/me', b.json.data.accessToken);
    expect(meA.json.data.business.id).toBe(a.json.data.business.id);
    expect(meB.json.data.business.id).toBe(b.json.data.business.id);
    // Token A tak pernah mengembalikan business B.
    expect(meA.json.data.business.id).not.toBe(b.json.data.business.id);
  });

  it('refresh token → access baru; rotasi mencabut token lama', async () => {
    const reg = await post('/v1/auth/register-business', newOwner());
    const oldRefresh = reg.json.data.refreshToken;

    const r1 = await post('/v1/auth/refresh', { refreshToken: oldRefresh });
    expect(r1.status).toBe(200);
    expect(r1.json.data.accessToken).toBeTypeOf('string');

    // Refresh lama sudah dicabut (rotasi) → 401.
    const r2 = await post('/v1/auth/refresh', { refreshToken: oldRefresh });
    expect(r2.status).toBe(401);
  });
});
