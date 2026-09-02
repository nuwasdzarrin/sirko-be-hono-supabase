import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app.ts';
import { sql } from '../../src/db/client.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { uuid } from '../../src/lib/uuid.ts';
import { signAccessToken } from '../../src/lib/jwt.ts';

/**
 * Contract test Katalog (Fitur 2). Butuh Postgres nyata; skip bila tak tersambung.
 * Menguji: lookup hit/404, search relevan+paginasi, tulis hanya sirko_admin (403),
 * soft delete, barcode duplikat, signed-URL media valid, katalog GLOBAL tanpa businessId.
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
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await app.request(path, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function storeToken() {
  const tag = uuid().slice(0, 8);
  const { json } = await req('POST', '/v1/auth/register-business', undefined, {
    business: { name: `Toko ${tag}` },
    owner: { name: `O ${tag}`, email: `o-${tag}@toko.id`, password: 'rahasia123' },
  });
  return json.data.accessToken as string;
}

/** Token sirko_admin di-mint langsung (write hanya butuh role dari JWT). */
function adminToken() {
  return signAccessToken({ userId: uuid(), businessId: null, role: 'sirko_admin' });
}

function catalogBody(over: Record<string, unknown> = {}) {
  return {
    name: 'Indomie Goreng Special',
    shortDescription: 'Mi instan goreng 85g',
    brand: 'Indomie',
    category: 'Makanan Instan',
    manufacturer: 'Indofood',
    defaultUnit: 'pcs',
    netSize: 85,
    netUnit: 'g',
    keywords: ['indomie', 'mi goreng'],
    verified: true,
    ...over,
  };
}

suite('Catalog contract', () => {
  let admin: string;

  beforeAll(async () => {
    await runMigrations(sql);
    admin = await adminToken();
  });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('non-admin DITOLAK menulis (403); sirko_admin bisa create (201)', async () => {
    const store = await storeToken();
    const denied = await req('POST', '/v1/catalog', store, catalogBody());
    expect(denied.status).toBe(403);
    expect(denied.json.error.code).toBe('FORBIDDEN');

    const created = await req('POST', '/v1/catalog', admin, catalogBody({ barcode: `890${Date.now()}` }));
    expect(created.status).toBe(201);
    expect(created.json.data.id).toBeTypeOf('string');
    expect(created.json.data.name).toBe('Indomie Goreng Special');
    expect(created.json.data).not.toHaveProperty('businessId'); // GLOBAL, tanpa tenant
    expect(created.json.data).not.toHaveProperty('sellingPrice'); // tanpa harga/stok
  });

  it('lookup barcode: hit oleh toko mana pun, 404 bila tak ada', async () => {
    const barcode = `899${Date.now()}`;
    await req('POST', '/v1/catalog', admin, catalogBody({ barcode, name: 'Teh Botol' }));

    const store = await storeToken(); // toko biasa boleh baca
    const hit = await req('GET', `/v1/catalog/lookup?barcode=${barcode}`, store);
    expect(hit.status).toBe(200);
    expect(hit.json.data.name).toBe('Teh Botol');
    expect(hit.json.data.barcode).toBe(barcode);

    const miss = await req('GET', `/v1/catalog/lookup?barcode=0000000000000`, store);
    expect(miss.status).toBe(404);
    expect(miss.json.error.code).toBe('NOT_FOUND');
  });

  it('barcode duplikat → 409 CONFLICT', async () => {
    const barcode = `771${Date.now()}`;
    const a = await req('POST', '/v1/catalog', admin, catalogBody({ barcode }));
    expect(a.status).toBe(201);
    const b = await req('POST', '/v1/catalog', admin, catalogBody({ barcode, name: 'Lain' }));
    expect(b.status).toBe(409);
    expect(b.json.error.code).toBe('CONFLICT');
  });

  it('search relevan & terpaginasi (cursor)', async () => {
    // Tag alfanumerik acak → tak trigram-mirip antar-run (DB uji persisten).
    const tag = `zz${uuid().replace(/-/g, '').slice(0, 10)}`;
    const createdIds = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const r = await req('POST', '/v1/catalog', admin, {
        ...catalogBody({ name: `${tag} sachet ${i}`, brand: 'Kapal Api', keywords: [tag] }),
      });
      createdIds.add(r.json.data.id);
    }
    const all: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const url = `/v1/catalog/search?q=${tag}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const { json } = await req('GET', url, admin);
      for (const r of json.data) all.push(r.id);
      pages += 1;
      if (!json.meta.hasMore) break;
      cursor = json.meta.nextCursor;
      if (pages > 8) throw new Error('search tak konvergen');
    }
    // Tak ada baris terlewat/dobel; ketiga produk baru semua ditemukan; terpaginasi.
    expect(new Set(all).size).toBe(all.length); // tanpa duplikat lintas halaman
    for (const id of createdIds) expect(all).toContain(id);
    expect(pages).toBeGreaterThanOrEqual(2);
  });

  it('update (200) & soft delete (200) → lookup jadi 404', async () => {
    const barcode = `123${Date.now()}`;
    const created = await req('POST', '/v1/catalog', admin, catalogBody({ barcode }));
    const id = created.json.data.id;

    const updated = await req('PUT', `/v1/catalog/${id}`, admin, { name: 'Nama Baru', verified: false });
    expect(updated.status).toBe(200);
    expect(updated.json.data.name).toBe('Nama Baru');
    expect(updated.json.data.verified).toBe(false);

    const del = await req('DELETE', `/v1/catalog/${id}`, admin);
    expect(del.status).toBe(200);
    expect(del.json.data).toEqual({ id, deleted: true });

    // Setelah soft delete, lookup barcode tak menemukan.
    const store = await storeToken();
    const after = await req('GET', `/v1/catalog/lookup?barcode=${barcode}`, store);
    expect(after.status).toBe(404);
  });

  it('non-admin update/delete → 403', async () => {
    const store = await storeToken();
    const upd = await req('PUT', `/v1/catalog/${uuid()}`, store, { name: 'x' });
    expect(upd.status).toBe(403);
    const del = await req('DELETE', `/v1/catalog/${uuid()}`, store);
    expect(del.status).toBe(403);
  });

  it('media sign-upload: signed URL valid; scope catalog khusus sirko_admin', async () => {
    const store = await storeToken();

    // Toko biasa: scope catalog → 403
    const denied = await req('POST', '/v1/media/sign-upload', store, {
      scope: 'catalog', fileName: 'indomie.jpg', contentType: 'image/jpeg', size: 84213,
    });
    expect(denied.status).toBe(403);

    // Toko biasa: scope product → OK
    const prod = await req('POST', '/v1/media/sign-upload', store, {
      scope: 'product', fileName: 'foto produk.jpg', contentType: 'image/jpeg',
    });
    expect(prod.status).toBe(200);
    expect(prod.json.data.method).toBe('PUT');

    // sirko_admin: scope catalog → signed URL lengkap
    const signed = await req('POST', '/v1/media/sign-upload', admin, {
      scope: 'catalog', fileName: 'indomie.jpg', contentType: 'image/jpeg', size: 84213,
    });
    expect(signed.status).toBe(200);
    const d = signed.json.data;
    expect(d.method).toBe('PUT');
    expect(d.headers['Content-Type']).toBe('image/jpeg');
    expect(d.expiresIn).toBe(300);
    expect(d.uploadUrl).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(d.uploadUrl).toContain('X-Amz-Signature=');
    expect(d.uploadUrl).toContain('X-Amz-Credential=');
    expect(d.uploadUrl).toContain('/sirko-media/catalog/');
    expect(d.publicUrl).toContain('/catalog/');
  });
});
