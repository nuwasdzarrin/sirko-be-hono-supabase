import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { uuid } from '../../src/lib/uuid.js';
import * as subscriptions from '../../src/services/subscription.service.js';
import { req, register, login, PASSWORD } from './juragan-helpers.js';

/**
 * Contract test Juragan — langganan (kontrak app §3, §6 no. 2–6).
 * Butuh Postgres; skip bila tak tersambung.
 */

let dbUp = false;
try {
  await sql`SELECT 1`;
  dbUp = true;
} catch (err) {
  console.warn(`[contract] DB tak tersambung — suite di-skip: ${(err as Error).message}`);
}
const suite = dbUp ? describe : describe.skip;

suite('Juragan — langganan', () => {
  beforeAll(async () => {
    await runMigrations(sql);
    await subscriptions.setPaymentConfig(
      { qrisUrl: 'https://cdn.example/qris.png', bankName: 'BCA', accountNo: '1234567890', accountName: 'CV Sirko', note: 'Transfer persis.' },
      'test',
    );
  });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('[5] GET /v1/plans: harga seed 49.000 & 499.000 + payment + plan', async () => {
    const a = await register();
    const r = await req('GET', '/v1/plans', undefined, a.token);
    expect(r.status).toBe(200);
    expect(r.json.data.prices).toEqual([
      { plan: 'juragan', period: 'monthly', amount: 49000, maxStores: 3 },
      { plan: 'juragan', period: 'yearly', amount: 499000, maxStores: 3 },
    ]);
    expect(r.json.data.payment).toEqual({
      qrisUrl: 'https://cdn.example/qris.png', bankName: 'BCA', accountNo: '1234567890', accountName: 'CV Sirko', note: 'Transfer persis.',
    });
    expect(r.json.data.plan).toMatchObject({ name: 'warung' });
    expect((await req('GET', '/v1/plans')).status).toBe(401);
  });

  it('[2] checkout → pending (harga + kode unik); konfirmasi admin → confirmed + plan juragan ≈ +1 bulan', async () => {
    const a = await register();
    const co = await req('POST', '/v1/plan/checkout', { period: 'monthly' }, a.token);
    expect(co.status).toBe(201);
    const c = co.json.data;
    expect(c).toMatchObject({ period: 'monthly', status: 'pending', note: null, plan: null, qrisUrl: 'https://cdn.example/qris.png' });
    expect(c.uniqueCode).toBeGreaterThanOrEqual(1);
    expect(c.uniqueCode).toBeLessThanOrEqual(999);
    expect(c.amount).toBe(49000 + c.uniqueCode);
    expect(c.expiresAt).toBeGreaterThan(Date.now());

    const pending = await req('GET', `/v1/plan/checkout/${c.id}`, undefined, a.token);
    expect(pending.json.data).toMatchObject({ id: c.id, status: 'pending', plan: null });

    const before = Date.now();
    await subscriptions.confirmPayment(c.id, 'admin-test');
    const done = await req('GET', `/v1/plan/checkout/${c.id}`, undefined, a.token);
    expect(done.status).toBe(200);
    expect(done.json.data.status).toBe('confirmed');
    expect(done.json.data.plan).toMatchObject({
      name: 'juragan', period: 'monthly', maxStores: 3,
      features: ['multi_store', 'staff', 'advanced_reports', 'receipt_branding'],
    });
    const exp = done.json.data.plan.expiresAt as number;
    expect(exp - before).toBeGreaterThan(27 * 86_400_000);
    expect(exp - before).toBeLessThan(32 * 86_400_000);
    // Konfirmasi ganda ditolak; login kini juragan.
    await expect(subscriptions.confirmPayment(c.id, 'admin-test')).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await login(a.email)).json.data.plan.name).toBe('juragan');

    // Tahunan ≈ +1 tahun (akun lain).
    const y = await register();
    const cy = await req('POST', '/v1/plan/checkout', { period: 'yearly' }, y.token);
    expect(cy.json.data.amount).toBe(499000 + cy.json.data.uniqueCode);
    await subscriptions.confirmPayment(cy.json.data.id, 'admin-test');
    const py = (await req('GET', `/v1/plan/checkout/${cy.json.data.id}`, undefined, y.token)).json.data.plan;
    expect(py.period).toBe('yearly');
    expect(py.expiresAt - Date.now()).toBeGreaterThan(364 * 86_400_000);
  });

  it('[3] perpanjang sebelum habis → expiresAt baru = expiresAt lama + periode', async () => {
    const a = await register();
    const c1 = await req('POST', '/v1/plan/checkout', { period: 'monthly' }, a.token);
    await subscriptions.confirmPayment(c1.json.data.id, 'admin-test');
    const exp1 = (await req('GET', '/v1/me', undefined, a.token)).json.data.plan.expiresAt as number;

    const c2 = await req('POST', '/v1/plan/checkout', { period: 'monthly' }, a.token);
    await subscriptions.confirmPayment(c2.json.data.id, 'admin-test');
    const plan = (await req('GET', `/v1/plan/checkout/${c2.json.data.id}`, undefined, a.token)).json.data.plan;
    expect(plan.expiresAt).toBe(subscriptions.addPeriod(exp1, 'monthly'));
  });

  it('[4] tolak admin → rejected + note; plan tetap warung', async () => {
    const a = await register();
    const co = await req('POST', '/v1/plan/checkout', { period: 'monthly' }, a.token);
    await expect(subscriptions.rejectPayment(co.json.data.id, 'admin-test', '  ')).rejects.toMatchObject({ code: 'VALIDATION' });
    await subscriptions.rejectPayment(co.json.data.id, 'admin-test', 'Dana belum masuk ke rekening.');
    const r = await req('GET', `/v1/plan/checkout/${co.json.data.id}`, undefined, a.token);
    expect(r.json.data).toMatchObject({ status: 'rejected', note: 'Dana belum masuk ke rekening.', plan: null });
    expect((await req('GET', '/v1/me', undefined, a.token)).json.data.plan.name).toBe('warung');
  });

  it('[6] karyawan (non-owner) checkout → FORBIDDEN; boleh baca /v1/plans', async () => {
    const a = await register();
    const ts = Date.now();
    const accId = uuid();
    const email = `kasir-${accId.slice(0, 8)}@toko.id`;
    const { hashPassword } = await import('../../src/lib/password.js');
    await sql`INSERT INTO accounts (id, email, password_hash, created_at, updated_at)
              VALUES (${accId}, ${email}, ${await hashPassword(PASSWORD)}, ${ts}, ${ts})`;
    await sql`INSERT INTO users (id, business_id, account_id, name, role, created_at, updated_at)
              VALUES (${uuid()}, ${a.businessId}, ${accId}, 'Kasir', 'cashier', ${ts}, ${ts})`;
    const kasir = await login(email);
    expect(kasir.json.data.user.role).toBe('cashier');
    const co = await req('POST', '/v1/plan/checkout', { period: 'monthly' }, kasir.json.data.accessToken);
    expect(co.status).toBe(403);
    expect(co.json.error.code).toBe('FORBIDDEN');
    expect((await req('GET', '/v1/plans', undefined, kasir.json.data.accessToken)).status).toBe(200);
  });

  it('satu pending per akun; nominal pending tak pernah kembar; validasi & 404; PLAN_UNAVAILABLE', async () => {
    const a = await register();
    const first = await req('POST', '/v1/plan/checkout', { period: 'monthly' }, a.token);
    const second = await req('POST', '/v1/plan/checkout', { period: 'monthly' }, a.token);
    expect((await req('GET', `/v1/plan/checkout/${first.json.data.id}`, undefined, a.token)).json.data.status).toBe('expired');
    expect(second.json.data.status).toBe('pending');

    // Banyak akun checkout bersamaan → semua nominal pending berbeda.
    const many = await Promise.all(Array.from({ length: 15 }, () => register()));
    const results = await Promise.all(many.map((m) => req('POST', '/v1/plan/checkout', { period: 'monthly' }, m.token)));
    expect(results.map((r) => r.status)).toEqual(Array(15).fill(201));
    expect(new Set(results.map((r) => r.json.data.amount)).size).toBe(15);
    const dup = await sql`SELECT amount FROM subscription_payments WHERE status = 'pending' GROUP BY amount HAVING count(*) > 1`;
    expect(dup).toHaveLength(0);

    expect((await req('POST', '/v1/plan/checkout', { period: 'weekly' }, a.token)).json.error.code).toBe('VALIDATION');
    const other = await register();
    expect((await req('GET', `/v1/plan/checkout/${second.json.data.id}`, undefined, other.token)).status).toBe(404);
    expect((await req('GET', `/v1/plan/checkout/${uuid()}`, undefined, a.token)).status).toBe(404);

    // Harga belum diatur → 503 PLAN_UNAVAILABLE (dikembalikan setelahnya).
    await sql`DELETE FROM plan_prices WHERE plan = 'juragan' AND period = 'yearly'`;
    try {
      const u = await req('POST', '/v1/plan/checkout', { period: 'yearly' }, a.token);
      expect(u.status).toBe(503);
      expect(u.json.error.code).toBe('PLAN_UNAVAILABLE');
    } finally {
      await subscriptions.setPrice('yearly', 499000, 3);
    }
  });
});
