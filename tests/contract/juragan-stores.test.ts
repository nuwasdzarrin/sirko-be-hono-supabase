import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { uuid } from '../../src/lib/uuid.js';
import { req, register, login, makeJuragan, shape } from './juragan-helpers.js';

/**
 * Contract test Juragan — sesi & multi-toko (kontrak app §2, §6 no. 1, 7, 8;
 * JURAGAN.md §6). Butuh Postgres; skip bila tak tersambung.
 */

let dbUp = false;
try {
  await sql`SELECT 1`;
  dbUp = true;
} catch (err) {
  console.warn(`[contract] DB tak tersambung — suite di-skip: ${(err as Error).message}`);
}
const suite = dbUp ? describe : describe.skip;

suite('Juragan — sesi & multi-toko', () => {
  beforeAll(async () => {
    await runMigrations(sql);
  });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('[1] login & register akun warung: plan warung + businesses; field lama tetap', async () => {
    const a = await register();
    expect(a.status).toBe(201);
    expect(a.data.plan).toMatchObject({ name: 'warung', period: null, expiresAt: null, maxStores: 1, features: [] });
    expect(a.data.plan.serverTime).toBeTypeOf('number');
    expect(a.data.businesses).toEqual([{ id: a.businessId, name: a.data.business.name, role: 'owner' }]);

    const l = await login(a.email);
    expect(l.status).toBe(200);
    expect(l.json.data.plan).toMatchObject({ name: 'warung', features: [] });
    expect(l.json.data.plan.serverTime).toBeTypeOf('number');
    expect(l.json.data.user.businessId).toBe(a.businessId);
    expect(l.json.data.business.id).toBe(a.businessId);
    expect(l.json.data.businesses).toHaveLength(1);

    const me = await req('GET', '/v1/me', undefined, a.token);
    expect(me.json.data.businesses).toHaveLength(1);
    expect(me.json.data.plan.name).toBe('warung');
    const mine = await req('GET', '/v1/me/businesses', undefined, a.token);
    expect(mine.json.data).toMatchObject({ businesses: [{ id: a.businessId, role: 'owner' }], plan: { name: 'warung' } });
  });

  it('[7] POST /v1/businesses: warung → PLAN_REQUIRED; juragan toko ke-2/3 tercipta, ke-4 → PLAN_LIMIT', async () => {
    const a = await register();
    const warung = await req('POST', '/v1/businesses', { name: 'Cabang' }, a.token);
    expect(warung.status).toBe(403);
    expect(warung.json.error.code).toBe('PLAN_REQUIRED');

    await makeJuragan(a.token);
    const bad = await req('POST', '/v1/businesses', { name: '' }, a.token);
    expect(bad.status).toBe(422);
    expect(bad.json.error.code).toBe('VALIDATION');

    const c2 = await req('POST', '/v1/businesses', { name: 'Cabang 2', businessType: 'Kelontong' }, a.token);
    expect(c2.status).toBe(201);
    expect(c2.json.data.business).toMatchObject({ name: 'Cabang 2', businessType: 'Kelontong' });
    expect(c2.json.data.user).toMatchObject({ role: 'owner', businessId: c2.json.data.business.id });
    expect(c2.json.data.businesses).toHaveLength(2);
    expect(c2.json.data.plan.name).toBe('juragan');
    // Token toko baru langsung bisa push.
    const push = await req('POST', '/v1/backup/push', {
      tables: { products: [{ id: uuid(), name: 'Gula', updatedAt: Date.now() }] },
    }, c2.json.data.accessToken);
    expect(push.status).toBe(200);
    expect(push.json.data.applied.products).toBe(1);

    const c3 = await req('POST', '/v1/businesses', { name: 'Cabang 3' }, a.token);
    expect(c3.status).toBe(201);
    const c4 = await req('POST', '/v1/businesses', { name: 'Cabang 4' }, a.token);
    expect(c4.status).toBe(403);
    expect(c4.json.error.code).toBe('PLAN_LIMIT');
    expect(c4.json.error.message).toContain('3 toko');
  });

  it('[7] switch-business: toko sendiri → token baru & data terisolasi; toko orang → FORBIDDEN; warung → PLAN_REQUIRED', async () => {
    const a = await register();
    await makeJuragan(a.token);
    const b2 = await req('POST', '/v1/businesses', { name: 'Cabang B' }, a.token);
    const bId = b2.json.data.business.id as string;

    // Data di toko utama A.
    const pA = uuid();
    await req('POST', '/v1/backup/push', { tables: { products: [{ id: pA, name: 'Milik A', updatedAt: Date.now() }] } }, a.token);

    const sw = await req('POST', '/v1/auth/switch-business', { businessId: bId }, a.token);
    expect(sw.status).toBe(200);
    expect(sw.json.data.user.businessId).toBe(bId);
    expect(sw.json.data.business.id).toBe(bId);
    const pull = await req('GET', '/v1/backup/pull', undefined, sw.json.data.accessToken);
    expect((pull.json.data.tables.products ?? []).map((r: { id: string }) => r.id)).not.toContain(pA);

    // Refresh token toko A setelah switch tetap menghasilkan token toko A.
    const ref = await req('POST', '/v1/auth/refresh', { refreshToken: a.data.refreshToken });
    const meA = await req('GET', '/v1/me', undefined, ref.json.data.accessToken);
    expect(meA.json.data.user.businessId).toBe(a.businessId);

    // Login berikutnya tanpa businessId → toko terakhir dibuka (B).
    expect((await login(a.email)).json.data.user.businessId).toBe(bId);
    // Login dengan businessId eksplisit.
    expect((await login(a.email, a.businessId)).json.data.user.businessId).toBe(a.businessId);

    // Toko orang lain → 403 FORBIDDEN (login maupun switch).
    const other = await register();
    const foreign = await req('POST', '/v1/auth/switch-business', { businessId: other.businessId }, a.token);
    expect(foreign.status).toBe(403);
    expect(foreign.json.error.code).toBe('FORBIDDEN');
    const ghost = await req('POST', '/v1/auth/switch-business', { businessId: uuid() }, a.token);
    expect(ghost.json.error.code).toBe('FORBIDDEN'); // tak membedakan "tak ada" vs "bukan anggota"
    expect((await login(a.email, other.businessId)).json.error.code).toBe('FORBIDDEN');

    // Langganan habis → warung: toko kedua terkunci, toko utama tetap bisa.
    await sql`UPDATE subscriptions SET starts_at = starts_at - 400::bigint * 86400000, ends_at = ${Date.now() - 1000}
              WHERE account_id = ${a.accountId}`;
    const locked = await req('POST', '/v1/auth/switch-business', { businessId: bId }, a.token);
    expect(locked.status).toBe(403);
    expect(locked.json.error.code).toBe('PLAN_REQUIRED');
    const toMain = await req('POST', '/v1/auth/switch-business', { businessId: a.businessId }, sw.json.data.accessToken);
    expect(toMain.status).toBe(200);
    expect(toMain.json.data.plan.name).toBe('warung');
    // Login tanpa businessId saat warung → toko utama (bukan toko terakhir B).
    expect((await login(a.email)).json.data.user.businessId).toBe(a.businessId);
    // Sync token toko B yang sudah ada tetap jalan (J7, invarian §5.7).
    const stillPush = await req('POST', '/v1/backup/push', {
      tables: { products: [{ id: uuid(), name: 'Tetap jalan', updatedAt: Date.now() }] },
    }, sw.json.data.accessToken);
    expect(stillPush.status).toBe(200);
  });

  it('[8] respons login / switch-business / POST businesses berbentuk identik', async () => {
    const a = await register();
    await makeJuragan(a.token);
    const created = await req('POST', '/v1/businesses', { name: 'Cabang X' }, a.token);
    const sw = await req('POST', '/v1/auth/switch-business', { businessId: a.businessId }, created.json.data.accessToken);
    const l = await login(a.email);
    const reg = await register();

    const expected = shape(l.json.data);
    expect(shape(sw.json.data)).toEqual(expected);
    expect(shape(created.json.data)).toEqual(expected);
    expect(shape(reg.data)).toEqual(expected);
    expect(Object.keys(l.json.data).sort()).toEqual(
      ['accessToken', 'business', 'businesses', 'expiresIn', 'plan', 'refreshToken', 'user'],
    );
  });
});
