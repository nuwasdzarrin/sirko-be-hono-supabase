import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app.js';
import { sql } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { uuid } from '../../src/lib/uuid.js';

/**
 * Contract test Backup (Fitur 1). Butuh Postgres nyata; skip bila tak tersambung.
 * Menguji: push idempotent (tak menggandakan), isolasi tenant, business_id dari
 * JWT, pull cursor (tak lewat/dobel), tombstone, batch terpaginasi, LWW/append,
 * sale tak ditolak.
 */

let dbUp = false;
try {
  await sql`SELECT 1`;
  dbUp = true;
} catch (err) {
  console.warn(`[contract] DB tak tersambung — suite di-skip: ${(err as Error).message}`);
}
const suite = dbUp ? describe : describe.skip;

async function req(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await app.request(path, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as any };
}

/** Daftarkan toko baru → { token, businessId }. */
async function newStore() {
  const tag = uuid().slice(0, 8);
  const { json } = await req('POST', '/v1/auth/register-business', undefined, {
    business: { name: `Toko ${tag}`, businessType: 'kelontong' },
    owner: { name: `Owner ${tag}`, email: `o-${tag}@toko.id`, password: 'rahasia123' },
  });
  return { token: json.data.accessToken as string, businessId: json.data.business.id as string };
}

const now = () => Date.now();

function product(over: Record<string, unknown> = {}) {
  const ts = now();
  return {
    id: uuid(),
    name: 'Indomie Goreng',
    barcode: '8991002101234',
    costPrice: 2500,
    sellingPrice: 3000,
    stock: 40,
    hasVariants: false,
    isActive: true,
    updatedAt: ts,
    deletedAt: null,
    ...over,
  };
}

function pushBody(tables: Record<string, unknown[]>) {
  return { clientInfo: { deviceId: uuid(), appVersion: '1.4.0', schemaVersion: 3 }, tables };
}

suite('Backup contract', () => {
  beforeAll(async () => {
    await runMigrations(sql);
  });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('push menyimpan batch; applied benar; butuh auth', async () => {
    const { token } = await newStore();
    const p = product();
    const { status, json } = await req('POST', '/v1/backup/push', token, pushBody({ products: [p] }));
    expect(status).toBe(200);
    expect(json.data.applied.products).toBe(1);
    expect(json.data.rejected).toEqual([]);
    expect(typeof json.data.serverTime).toBe('number');

    const noAuth = await req('POST', '/v1/backup/push', undefined, pushBody({ products: [p] }));
    expect(noAuth.status).toBe(401);
  });

  it('push 2× TAK menggandakan (idempotent) + LWW stale → skipped', async () => {
    const { token } = await newStore();
    const p = product();
    const first = await req('POST', '/v1/backup/push', token, pushBody({ products: [p] }));
    expect(first.json.data.applied.products).toBe(1);

    // Push ulang persis (updatedAt sama) → LWW skip STALE, tak menggandakan.
    const second = await req('POST', '/v1/backup/push', token, pushBody({ products: [p] }));
    expect(second.json.data.applied.products).toBe(0);
    expect(second.json.data.skipped).toContainEqual({ table: 'products', id: p.id, reason: 'STALE' });

    const st = await req('GET', '/v1/backup/status', token);
    expect(st.json.data.counts.products).toBe(1); // hanya 1 baris
  });

  it('LWW: push lebih baru meng-update (mis. void); lebih lama di-skip', async () => {
    const { token } = await newStore();
    const id = uuid();
    const t0 = now();
    await req('POST', '/v1/backup/push', token, pushBody({ transactions: [txn({ id, updatedAt: t0, status: 'paid' })] }));

    const newer = await req('POST', '/v1/backup/push', token, pushBody({ transactions: [txn({ id, updatedAt: t0 + 1000, status: 'void' })] }));
    expect(newer.json.data.applied.transactions).toBe(1);

    const older = await req('POST', '/v1/backup/push', token, pushBody({ transactions: [txn({ id, updatedAt: t0 - 1000, status: 'paid' })] }));
    expect(older.json.data.applied.transactions).toBe(0);

    const pull = await req('GET', `/v1/backup/pull`, token);
    const stored = pull.json.data.tables.transactions.find((r: any) => r.id === id);
    expect(stored.status).toBe('void'); // versi terbaru menang
  });

  it('append-only (payments): re-push tak menggandakan', async () => {
    const { token } = await newStore();
    const pay = { id: uuid(), transactionId: uuid(), method: 'cash', amount: 10000, updatedAt: now(), deletedAt: null };
    await req('POST', '/v1/backup/push', token, pushBody({ payments: [pay] }));
    await req('POST', '/v1/backup/push', token, pushBody({ payments: [{ ...pay, amount: 99999, updatedAt: now() + 1 }] }));
    const st = await req('GET', '/v1/backup/status', token);
    expect(st.json.data.counts.payments).toBe(1); // immutable, tak dobel
  });

  it('isolasi tenant: toko B tak melihat data A; business_id body diabaikan', async () => {
    const a = await newStore();
    const b = await newStore();
    const pA = product({ name: 'Milik A' });
    await req('POST', '/v1/backup/push', a.token, pushBody({ products: [pA] }));

    // B pull → tak ada produk A.
    const bPull = await req('GET', '/v1/backup/pull', b.token);
    expect(bPull.json.data.tables.products ?? []).toEqual([]);

    // B push dengan businessId palsu milik A di body → diabaikan, tersimpan di B.
    const pB = product({ name: 'Milik B', businessId: a.businessId });
    await req('POST', '/v1/backup/push', b.token, pushBody({ products: [pB] }));

    const aPull = await req('GET', '/v1/backup/pull', a.token);
    const aProducts = aPull.json.data.tables.products ?? [];
    expect(aProducts.some((r: any) => r.id === pB.id)).toBe(false); // A tak kebagian baris B
    expect(aProducts.some((r: any) => r.id === pA.id)).toBe(true);
  });

  it('pull cursor: batch terpaginasi, tak lewat/tak dobel', async () => {
    const { token } = await newStore();
    const products = Array.from({ length: 5 }, (_, i) => product({ name: `P${i}` }));
    await req('POST', '/v1/backup/push', token, pushBody({ products }));

    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const url = `/v1/backup/pull?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const { json } = await req('GET', url, token);
      for (const r of json.data.tables.products ?? []) seen.add(r.id);
      pages += 1;
      if (!json.meta.hasMore) break;
      cursor = json.meta.nextCursor;
      if (pages > 10) throw new Error('pull tak konvergen');
    }
    expect(seen.size).toBe(5); // semua unik, tak ada terlewat/dobel
    expect(pages).toBeGreaterThanOrEqual(3);
  });

  it('tombstone (delete) tersimpan & muncul di pull', async () => {
    const { token } = await newStore();
    const p = product({ deletedAt: now() });
    await req('POST', '/v1/backup/push', token, pushBody({ products: [p] }));
    const { json } = await req('GET', '/v1/backup/pull', token);
    const row = (json.data.tables.products ?? []).find((r: any) => r.id === p.id);
    expect(row).toBeDefined();
    expect(row.deletedAt).toBe(p.deletedAt);
  });

  it('sale TAK ditolak; baris cacat struktur → rejected tanpa menggagalkan yang valid', async () => {
    const { token } = await newStore();
    const good = txn({ status: 'paid' });
    const badEnum = txn({ status: 'nonsense' as any }); // enum invalid → rejected
    const { json } = await req('POST', '/v1/backup/push', token, pushBody({ transactions: [good, badEnum] }));
    expect(json.data.applied.transactions).toBe(1); // yang valid tetap tersimpan
    expect(json.data.rejected).toContainEqual(
      expect.objectContaining({ table: 'transactions', id: badEnum.id, code: 'VALIDATION' }),
    );
  });

  it('schemaVersion terlalu baru → 409 UPGRADE_REQUIRED', async () => {
    const { token } = await newStore();
    const body = { clientInfo: { schemaVersion: 999 }, tables: { products: [product()] } };
    const { status, json } = await req('POST', '/v1/backup/push', token, body);
    expect(status).toBe(409);
    expect(json.error.code).toBe('UPGRADE_REQUIRED');
  });

  it('Idempotency-Key: retry mengembalikan hasil identik', async () => {
    const { token } = await newStore();
    const p = product();
    const key = uuid();
    const r1 = await req('POST', '/v1/backup/push', token, pushBody({ products: [p] }), { 'Idempotency-Key': key });
    const r2 = await req('POST', '/v1/backup/push', token, pushBody({ products: [p] }), { 'Idempotency-Key': key });
    expect(r2.json.data.applied).toEqual(r1.json.data.applied); // identik, bukan STALE skip
    expect(r2.json.data.applied.products).toBe(1);
  });
});

function txn(over: Record<string, unknown> = {}) {
  const ts = now();
  return {
    id: uuid(),
    invoiceNo: `INV-${ts}`,
    datetime: ts,
    subtotal: 9000,
    discountTotal: 0,
    taxTotal: 0,
    grandTotal: 9000,
    paidTotal: 10000,
    changeTotal: 1000,
    status: 'paid',
    isCredit: false,
    updatedAt: ts,
    deletedAt: null,
    ...over,
  };
}
