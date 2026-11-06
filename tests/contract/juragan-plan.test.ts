import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app.js';
import { sql } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { uuid } from '../../src/lib/uuid.js';
import * as plans from '../../src/services/plan.service.js';
import { registerOwnerStore } from '../helpers/owner-store.js';

/**
 * Contract test Juragan tahap a: migrasi 0007 (index keanggotaan, plan_prices),
 * PlanService.effective (aktif/habis/perpanjangan bersambung), objek `plan` di
 * login & /v1/me. Butuh Postgres; skip bila tak tersambung.
 */

let dbUp = false;
try {
  await sql`SELECT 1`;
  dbUp = true;
} catch (err) {
  console.warn(`[contract] DB tak tersambung — suite di-skip: ${(err as Error).message}`);
}
const suite = dbUp ? describe : describe.skip;

const DAY = 86_400_000;

async function req(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
}

/** Daftar toko baru → { email, accountId, businessId, userId, token }. */
async function register() {
  const tag = uuid().slice(0, 8);
  const email = `jp-${tag}@toko.id`;
  const r = await registerOwnerStore({
    business: { name: `Toko ${tag}` },
    owner: { name: `Owner ${tag}`, email, password: 'rahasia123' },
  });
  const [acc] = await sql<{ id: string }[]>`SELECT id FROM accounts WHERE email = ${email}`;
  return {
    email,
    accountId: acc!.id,
    businessId: r.json.data.business.id as string,
    userId: r.json.data.user.id as string,
    token: r.json.data.accessToken as string,
  };
}

async function addSub(accountId: string, startsAt: number, endsAt: number, period = 'monthly') {
  await sql`INSERT INTO subscriptions (id, account_id, plan, period, starts_at, ends_at, created_by, created_at)
            VALUES (${uuid()}, ${accountId}, 'juragan', ${period}, ${startsAt}, ${endsAt}, 'test', ${Date.now()})`;
}

suite('Juragan — paket efektif & migrasi 0007', () => {
  beforeAll(async () => {
    await runMigrations(sql);
  });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('migrasi idempoten; harga awal Juragan tersedia', async () => {
    await runMigrations(sql); // kedua kali: tak ada yang diterapkan ulang / gagal
    const rows = await sql<{ period: string; amount: string; max_stores: number }[]>`
      SELECT period, amount, max_stores FROM plan_prices WHERE plan = 'juragan' ORDER BY period`;
    expect(rows.map((r) => [r.period, Number(r.amount), r.max_stores])).toEqual([
      ['monthly', 49000, 3],
      ['yearly', 499000, 3],
    ]);
  });

  it('index keanggotaan: satu akun boleh di banyak toko, tapi satu baris per toko', async () => {
    const a = await register();
    const b = await register();
    const ts = Date.now();
    // Akun A jadi anggota toko B → boleh (K3).
    await sql`INSERT INTO users (id, business_id, account_id, name, role, created_at, updated_at)
              VALUES (${uuid()}, ${b.businessId}, ${a.accountId}, 'A di B', 'owner', ${ts}, ${ts})`;
    // Baris kedua akun A di toko B → ditolak.
    await expect(
      sql`INSERT INTO users (id, business_id, account_id, name, role, created_at, updated_at)
          VALUES (${uuid()}, ${b.businessId}, ${a.accountId}, 'dobel', 'owner', ${ts}, ${ts})`,
    ).rejects.toMatchObject({ code: '23505' });
    // sirko_admin (business_id NULL) tetap satu per akun (NULLS NOT DISTINCT).
    const admAcc = uuid();
    await sql`INSERT INTO accounts (id, email, password_hash, created_at, updated_at)
              VALUES (${admAcc}, ${`adm-${admAcc.slice(0, 8)}@sirko.id`}, 'x', ${ts}, ${ts})`;
    await sql`INSERT INTO users (id, business_id, account_id, name, role, created_at, updated_at)
              VALUES (${uuid()}, NULL, ${admAcc}, 'adm', 'sirko_admin', ${ts}, ${ts})`;
    await expect(
      sql`INSERT INTO users (id, business_id, account_id, name, role, created_at, updated_at)
          VALUES (${uuid()}, NULL, ${admAcc}, 'adm2', 'sirko_admin', ${ts}, ${ts})`,
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('akun baru = warung (1 toko, tanpa fitur) di login & /v1/me', async () => {
    const a = await register();
    const login = await req('POST', '/v1/auth/login', { emailOrPhone: a.email, password: 'rahasia123' });
    expect(login.status).toBe(200);
    expect(login.json.data.plan).toMatchObject({ name: 'warung', period: null, expiresAt: null, maxStores: 1, features: [] });
    expect(login.json.data.plan.serverTime).toBeTypeOf('number');
    // Kompatibilitas mundur: field lama tetap ada.
    expect(login.json.data.user.businessId).toBe(a.businessId);
    expect(login.json.data.business.id).toBe(a.businessId);

    const me = await req('GET', '/v1/me', undefined, a.token);
    expect(me.json.data.plan).toMatchObject({ name: 'warung', maxStores: 1 });
  });

  it('langganan aktif → juragan (4 fitur, maxStores dari plan_prices)', async () => {
    const a = await register();
    const now = Date.now();
    await addSub(a.accountId, now - DAY, now + 29 * DAY, 'yearly');

    const me = await req('GET', '/v1/me', undefined, a.token);
    expect(me.json.data.plan).toMatchObject({
      name: 'juragan',
      period: 'yearly',
      expiresAt: now + 29 * DAY,
      maxStores: 3,
      features: ['multi_store', 'staff', 'advanced_reports', 'receipt_branding'],
    });
    const login = await req('POST', '/v1/auth/login', { emailOrPhone: a.email, password: 'rahasia123' });
    expect(login.json.data.plan.name).toBe('juragan');
  });

  it('perpanjangan bersambung → expiresAt = ujung rantai; habis → warung', async () => {
    const a = await register();
    const now = Date.now();
    const end1 = now + 10 * DAY;
    await addSub(a.accountId, now - 20 * DAY, end1);
    await addSub(a.accountId, end1, end1 + 30 * DAY); // dibayar sebelum habis
    const p = await plans.effective(a.accountId, now);
    expect(p.name).toBe('juragan');
    expect(p.expiresAt).toBe(end1 + 30 * DAY);

    // Setelah rantai habis → warung; tepat di ends_at sudah tidak aktif.
    expect((await plans.effective(a.accountId, end1 + 30 * DAY)).name).toBe('warung');
    // Langganan yang belum mulai (masa depan, terputus) tak mengaktifkan.
    const b = await register();
    await addSub(b.accountId, now + DAY, now + 31 * DAY);
    expect((await plans.effective(b.accountId, now)).name).toBe('warung');
    // Akun tanpa login cloud → warung.
    expect((await plans.effective(null, now)).name).toBe('warung');
  });

  it('status paket tak memblok sync (langganan habis tetap bisa push/pull)', async () => {
    const a = await register();
    const now = Date.now();
    await addSub(a.accountId, now - 40 * DAY, now - 10 * DAY); // sudah habis
    const push = await req('POST', '/v1/backup/push', {
      tables: { products: [{ id: uuid(), name: 'Kopi', updatedAt: now }] },
    }, a.token);
    expect(push.status).toBe(200);
    expect(push.json.data.applied.products).toBe(1);
    const pull = await req('GET', '/v1/backup/pull', undefined, a.token);
    expect(pull.status).toBe(200);
  });
});
