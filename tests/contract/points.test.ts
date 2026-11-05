import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app.js';
import { sql } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { uuid } from '../../src/lib/uuid.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { setNotifyTransport, type AdminNotice } from '../../src/lib/notify.js';
import * as points from '../../src/services/points.service.js';

/**
 * Contract test Poin Sirko (tahap 1): saldo per akun pemilik, top-up manual +
 * konfirmasi admin, ledger append-only, tanpa kredit ganda / saldo minus.
 * Butuh Postgres uji; skip bila tak tersambung.
 */

let dbUp = false;
try {
  await sql`SELECT 1`;
  dbUp = true;
} catch (err) {
  console.warn(`[contract] DB tak tersambung — suite di-skip: ${(err as Error).message}`);
}
const suite = dbUp ? describe : describe.skip;

async function req(method: string, path: string, token?: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function newStore(tag: string) {
  const { json } = await req('POST', '/v1/auth/register-business', undefined, {
    business: { name: `Toko Poin ${tag}` },
    owner: { name: `Owner ${tag}`, email: `poin-${tag}@toko.id`, password: 'rahasia123' },
  });
  return {
    token: json.data.accessToken as string,
    businessId: json.data.business.id as string,
    userId: json.data.user.id as string,
  };
}

const ledgerSum = async (accountId: string) =>
  Number((await sql<{ s: string }[]>`SELECT coalesce(sum(amount),0) s FROM point_ledger WHERE account_id = ${accountId}`)[0]!.s);

suite('Poin Sirko — tahap 1', () => {
  const tag = uuid().slice(0, 8);
  let A: Awaited<ReturnType<typeof newStore>>;
  let accountId = '';
  const notices: AdminNotice[] = [];
  let restore: () => void = () => {};
  const createdBiz: string[] = [];

  beforeAll(async () => {
    await runMigrations(sql);
    await sql`DELETE FROM app_config WHERE key = 'points'`;
    restore = setNotifyTransport(async (n) => {
      notices.push(n);
    });
    A = await newStore(tag);
    createdBiz.push(A.businessId);
    accountId = (await points.ownerAccountId(A.businessId))!;
  });

  afterAll(async () => {
    restore();
    // Ledger append-only (trigger) → bersihkan lewat penonaktifan trigger khusus test.
    await sql`ALTER TABLE point_ledger DISABLE TRIGGER trg_point_ledger_immutable`;
    for (const b of createdBiz) {
      const accs = await sql<{ account_id: string }[]>`SELECT DISTINCT account_id FROM users WHERE business_id = ${b} AND account_id IS NOT NULL`;
      for (const { account_id } of accs) {
        await sql`DELETE FROM point_ledger WHERE account_id = ${account_id}`;
        await sql`DELETE FROM point_topups WHERE account_id = ${account_id}`;
        await sql`DELETE FROM point_accounts WHERE account_id = ${account_id}`;
      }
    }
    await sql`ALTER TABLE point_ledger ENABLE TRIGGER trg_point_ledger_immutable`;
    await sql.end({ timeout: 5 });
  });

  it('saldo awal 0; butuh auth', async () => {
    expect((await req('GET', '/v1/points')).status).toBe(401);
    const r = await req('GET', '/v1/points', A.token);
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ balance: 0, ledger: [], pendingTopups: [] });
    expect(accountId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('top-up: validasi nominal, kode unik, instruksi, notifikasi admin', async () => {
    expect((await req('POST', '/v1/points/topups', A.token, { amount: 5000 })).status).toBe(422);
    expect((await req('POST', '/v1/points/topups', A.token, { amount: 99_000_000 })).status).toBe(422);

    const r = await req('POST', '/v1/points/topups', A.token, { amount: 100_000 });
    expect(r.status).toBe(201);
    const t = r.json.data.topup;
    expect(t.status).toBe('pending');
    expect(t.uniqueCode).toBeGreaterThanOrEqual(1);
    expect(t.uniqueCode).toBeLessThanOrEqual(999);
    expect(t.transferAmount).toBe(100_000 + t.uniqueCode);
    expect(r.json.data.instructions.transferAmount).toBe(t.transferAmount);
    await new Promise((res) => setTimeout(res, 20));
    expect(notices.some((n) => n.text.includes('Top-up Poin baru') && n.linkPath?.includes('topups'))).toBe(true);
  });

  it('kasir tak boleh top-up (403); toko tanpa akun pemilik → OWNER_ACCOUNT_MISSING', async () => {
    const cashier = await signAccessToken({ userId: uuid(), businessId: A.businessId, role: 'cashier' });
    expect((await req('POST', '/v1/points/topups', cashier, { amount: 50_000 })).status).toBe(403);
    expect((await req('GET', '/v1/points', cashier)).status).toBe(200); // boleh lihat saldo

    const bid = uuid();
    await sql`INSERT INTO businesses (id, name, created_at, updated_at) VALUES (${bid}, ${'Tanpa Akun ' + tag}, 1, 1)`;
    createdBiz.push(bid);
    const tok = await signAccessToken({ userId: uuid(), businessId: bid, role: 'owner' });
    const r = await req('GET', '/v1/points', tok);
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('OWNER_ACCOUNT_MISSING');
    await sql`DELETE FROM businesses WHERE id = ${bid}`;
  });

  it('batas top-up menunggu (3) lalu batalkan', async () => {
    await req('POST', '/v1/points/topups', A.token, { amount: 20_000 });
    await req('POST', '/v1/points/topups', A.token, { amount: 30_000 });
    const fourth = await req('POST', '/v1/points/topups', A.token, { amount: 40_000 });
    expect(fourth.status).toBe(409);

    const list = (await req('GET', '/v1/points/topups', A.token)).json.data as Array<{ id: string; amount: number }>;
    const t30 = list.find((x) => x.amount === 30_000)!;
    const c = await req('POST', `/v1/points/topups/${t30.id}/cancel`, A.token);
    expect(c.json.data.status).toBe('cancelled');
  });

  it('konfirmasi admin: kredit sekali walau diklik berkali-kali / paralel', async () => {
    const list = (await req('GET', '/v1/points/topups', A.token)).json.data as Array<{ id: string; amount: number; transferAmount: number }>;
    const t = list.find((x) => x.amount === 100_000)!;
    const results = await Promise.all(Array.from({ length: 5 }, () => points.adminConfirmTopup(t.id, 'tester')));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await points.balanceOf(accountId)).toBe(t.transferAmount);
    expect(await ledgerSum(accountId)).toBe(t.transferAmount);

    const again = await points.adminConfirmTopup(t.id, 'tester');
    expect(again.ok).toBe(false);
    const s = await req('GET', '/v1/points', A.token);
    expect(s.json.data.balance).toBe(t.transferAmount);
    expect(s.json.data.ledger[0]).toMatchObject({ type: 'topup', amount: t.transferAmount, businessName: `Toko Poin ${tag}` });
  });

  it('top-up kedaluwarsa tetap bisa dikonfirmasi admin (dana telat masuk); tolak', async () => {
    const list = (await req('GET', '/v1/points/topups', A.token)).json.data as Array<{ id: string; amount: number; transferAmount: number }>;
    const t20 = list.find((x) => x.amount === 20_000)!;
    await sql`UPDATE point_topups SET expires_at = 1 WHERE id = ${t20.id}`;
    expect(await points.expireStale()).toBeGreaterThanOrEqual(1);
    const before = await points.balanceOf(accountId);
    expect((await points.adminConfirmTopup(t20.id, 'tester')).ok).toBe(true);
    expect(await points.balanceOf(accountId)).toBe(before + t20.transferAmount);

    const r = await req('POST', '/v1/points/topups', A.token, { amount: 25_000 });
    const rej = await points.adminRejectTopup(r.json.data.topup.id, 'tester', 'dana tidak masuk');
    expect(rej.ok).toBe(true);
    expect((await points.getTopup(r.json.data.topup.id))!.status).toBe('rejected');
  });

  it('potongan: tak bisa minus; paralel tak bisa overdraw; ledger = saldo', async () => {
    const bal = await points.balanceOf(accountId);
    await expect(
      sql.begin((tx) =>
        points.applyLedger(tx, { accountId, businessId: A.businessId, type: 'purchase', amount: -(bal + 1), refType: 'ppob_order', refId: uuid(), createdBy: 'test' }),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_POINTS' });
    expect(await points.balanceOf(accountId)).toBe(bal);

    // Paralel: 6 potongan masing-masing ~bal/4 → paling banyak 4 lolos, saldo tak pernah < 0.
    const chunk = Math.floor(bal / 4);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        sql.begin((tx) =>
          points.applyLedger(tx, { accountId, businessId: A.businessId, type: 'purchase', amount: -chunk, refType: 'ppob_order', refId: uuid(), createdBy: 'test' }),
        ),
      ),
    );
    const okCount = results.filter((r) => r.status === 'fulfilled').length;
    expect(okCount).toBe(4);
    expect(await points.balanceOf(accountId)).toBe(bal - 4 * chunk);
    expect(await ledgerSum(accountId)).toBe(await points.balanceOf(accountId));
  });

  it('ref ganda ditolak (satu potongan per order)', async () => {
    await points.adminAdjust(accountId, 100, 'saldo uji ref ganda', 'tester', null);
    const ref = uuid();
    const one = () =>
      sql.begin((tx) =>
        points.applyLedger(tx, { accountId, businessId: A.businessId, type: 'purchase', amount: -1, refType: 'ppob_order', refId: ref, createdBy: 'test' }),
      );
    await one();
    const bal = await points.balanceOf(accountId);
    await expect(one()).rejects.toMatchObject({ code: '23505' });
    expect(await points.balanceOf(accountId)).toBe(bal); // rollback: saldo tak ikut terpotong
  });

  it('ledger append-only: UPDATE/DELETE ditolak database', async () => {
    await expect(sql`UPDATE point_ledger SET amount = 999999 WHERE account_id = ${accountId}`).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM point_ledger WHERE account_id = ${accountId}`).rejects.toThrow(/append-only/);
  });

  it('koreksi admin: catatan wajib, tak bisa membuat minus, tercatat', async () => {
    await expect(points.adminAdjust(accountId, 1000, '  ', 'tester', null)).rejects.toMatchObject({ code: 'VALIDATION' });
    const bal = await points.balanceOf(accountId);
    await expect(points.adminAdjust(accountId, -(bal + 5), 'koreksi', 'tester', null)).rejects.toMatchObject({ code: 'INSUFFICIENT_POINTS' });
    const r = await points.adminAdjust(accountId, 1500, 'bonus uji', 'tester', A.businessId);
    expect(r.balanceAfter).toBe(bal + 1500);
    expect(await ledgerSum(accountId)).toBe(bal + 1500);
  });

  // Satu akun di banyak toko baru mungkin setelah migrasi Juragan mencabut
  // uq_users_account (JURAGAN.md §3.1). Test aktif otomatis begitu indeks itu hilang.
  it('per akun pemilik: toko kedua milik akun sama memakai saldo yang sama', async (ctx) => {
    const idx = await sql`SELECT 1 FROM pg_indexes WHERE indexname = 'uq_users_account'`;
    if (idx.length) ctx.skip();
    const b2 = uuid();
    await sql`INSERT INTO businesses (id, name, created_at, updated_at) VALUES (${b2}, ${'Cabang ' + tag}, 1, 1)`;
    await sql`INSERT INTO users (id, business_id, account_id, name, role, created_at, updated_at)
              VALUES (${uuid()}, ${b2}, ${accountId}, 'Owner cabang', 'owner', 2, 2)`;
    createdBiz.push(b2);
    const tok2 = await signAccessToken({ userId: uuid(), businessId: b2, role: 'owner' });
    const s1 = await req('GET', '/v1/points', A.token);
    const s2 = await req('GET', '/v1/points', tok2);
    expect(s2.json.data.balance).toBe(s1.json.data.balance);

    const t = await req('POST', '/v1/points/topups', tok2, { amount: 50_000 });
    expect(t.status).toBe(201);
    expect(t.json.data.topup.businessName).toBe(`Cabang ${tag}`); // tercatat toko pengaju
    await points.adminConfirmTopup(t.json.data.topup.id, 'tester');
    const after = await req('GET', '/v1/points', A.token);
    expect(after.json.data.balance).toBe(s1.json.data.balance + t.json.data.topup.transferAmount);
  });

  it('riwayat mutasi berpaginasi (cursor) tanpa dobel/terlewat', async () => {
    const all = new Set<string>();
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const r = await req('GET', `/v1/points/ledger?limit=2${cursor ? `&cursor=${cursor}` : ''}`, A.token);
      for (const x of r.json.data) all.add(x.id);
      if (!r.json.meta.hasMore) break;
      cursor = r.json.meta.nextCursor;
    }
    const total = Number((await sql<{ c: string }[]>`SELECT count(*) c FROM point_ledger WHERE account_id = ${accountId}`)[0]!.c);
    expect(all.size).toBe(total);
  });

  describe('dashboard admin Poin', () => {
    let cookie = '';
    const form = (path: string, data: Record<string, string>) =>
      app.request(path, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(data).toString(),
      });
    const page = async (path: string) => {
      const res = await app.request(path, { headers: { Cookie: cookie } });
      return { status: res.status, html: await res.text() };
    };

    beforeAll(async () => {
      const body = new URLSearchParams({ user: process.env.DASHBOARD_USER!, password: process.env.DASHBOARD_PASSWORD! }).toString();
      const res = await app.request('/dashboard/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
    });

    it('menu Poin: badge + kartu top-up menunggu; konfirmasi via tombol mengkredit sekali', async () => {
      const r = await req('POST', '/v1/points/topups', A.token, { amount: 75_000 });
      const t = r.json.data.topup;
      const list = await page('/dashboard/points');
      expect(list.status).toBe(200);
      expect(list.html).toMatch(/Poin <span class="nb">\d+<\/span>/);
      expect(list.html).toContain(`/dashboard/points/topups/${t.id}/confirm`);

      const before = await points.balanceOf(accountId);
      const c1 = await form(`/dashboard/points/topups/${t.id}/confirm`, { back: '/dashboard/points?tab=topups' });
      expect(c1.status).toBe(302);
      expect(c1.headers.get('location')).toBe('/dashboard/points?tab=topups');
      await form(`/dashboard/points/topups/${t.id}/confirm`, { back: 'https://evil.example' });
      expect(await points.balanceOf(accountId)).toBe(before + t.transferAmount);
      expect((await points.getTopup(t.id))!.confirmedBy).toBe(process.env.DASHBOARD_USER);
    });

    it('tolak top-up via tombol', async () => {
      const r = await req('POST', '/v1/points/topups', A.token, { amount: 33_000 });
      await form(`/dashboard/points/topups/${r.json.data.topup.id}/reject`, { note: 'tak ada dana', back: '/dashboard/points' });
      const t = (await points.getTopup(r.json.data.topup.id))!;
      expect(t).toMatchObject({ status: 'rejected', adminNote: 'tak ada dana' });
    });

    it('tab Poin di halaman toko + koreksi saldo', async () => {
      const tab = await page(`/dashboard/businesses/${A.businessId}?tab=points`);
      expect(tab.status).toBe(200);
      expect(tab.html).toContain('Saldo akun pemilik');
      expect(tab.html).toContain('🪙 Poin');
      const before = await points.balanceOf(accountId);
      const back = `/dashboard/businesses/${A.businessId}?tab=points`;
      const res = await form(`/dashboard/points/accounts/${accountId}/adjust`, { amount: '-1000', note: 'salah input', back, businessId: A.businessId });
      expect(res.headers.get('location')).toBe(back);
      expect(await points.balanceOf(accountId)).toBe(before - 1000);
      await form(`/dashboard/points/accounts/${accountId}/adjust`, { amount: '500', note: '', back });
      expect(await points.balanceOf(accountId)).toBe(before - 1000); // tanpa catatan ditolak
    });

    it('pengaturan: simpan rekening & batas; validasi min ≤ maks; tampil di instruksi app', async () => {
      const ok = await form('/dashboard/points/settings', {
        bankName: 'BCA', accountNo: '1234567890', accountName: 'PT Sirko', qrisImageUrl: '', note: 'Transfer tepat',
        minTopup: '10000', maxTopup: '3000000', expiryHours: '12', maxPendingTopups: '5',
      });
      expect(ok.status).toBe(302);
      const bad = await form('/dashboard/points/settings', {
        bankName: 'BCA', accountNo: '1', accountName: 'X', qrisImageUrl: '', note: '',
        minTopup: '500000', maxTopup: '100000', expiryHours: '12', maxPendingTopups: '5',
      });
      expect(bad.status).toBe(422);
      const s = await req('GET', '/v1/points', A.token);
      expect(s.json.data.limits).toEqual({ minTopup: 10_000, maxTopup: 3_000_000 });
      const t = await req('POST', '/v1/points/topups', A.token, { amount: 12_000 });
      expect(t.json.data.instructions).toMatchObject({ bankName: 'BCA', accountNo: '1234567890', accountName: 'PT Sirko' });
      expect(t.json.data.topup.expiresAt - t.json.data.topup.createdAt).toBe(12 * 3_600_000);
      await sql`DELETE FROM app_config WHERE key = 'points'`;
    });

    it('saldo akun: daftar + total beredar', async () => {
      const r = await page(`/dashboard/points?tab=accounts&q=${encodeURIComponent('poin-' + tag)}`);
      expect(r.html).toContain(`Toko Poin ${tag}`);
      expect(r.html).toContain('Total Poin beredar');
    });
  });
});
