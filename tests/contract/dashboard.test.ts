import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app.js';
import { sql } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { uuid } from '../../src/lib/uuid.js';
import { signAccessToken } from '../../src/lib/jwt.js';

/**
 * Contract test Dashboard admin (HTML). Butuh Postgres nyata; skip bila tak tersambung.
 * Menguji: login sesi cookie (gerbang, salah/benar, open-redirect, logout), filter
 * katalog via query URL (kategori/sumber/verified), link kategori & "lihat semua".
 */

let dbUp = false;
try {
  await sql`SELECT 1`;
  dbUp = true;
} catch (err) {
  console.warn(`[contract] DB tak tersambung — suite di-skip: ${(err as Error).message}`);
}
const authOn = Boolean(process.env.DASHBOARD_USER && process.env.DASHBOARD_PASSWORD);
const suite = dbUp && authOn ? describe : describe.skip;

const USER = process.env.DASHBOARD_USER ?? '';
const PASS = process.env.DASHBOARD_PASSWORD ?? '';

function form(data: Record<string, string>) {
  return { 'Content-Type': 'application/x-www-form-urlencoded', body: new URLSearchParams(data).toString() };
}

async function login(remember = false): Promise<string> {
  const { body, ...h } = form({ user: USER, password: PASS, next: '/dashboard', ...(remember ? { remember: 'on' } : {}) });
  const res = await app.request('/dashboard/login', { method: 'POST', headers: h, body });
  expect(res.status).toBe(302);
  const cookie = res.headers.get('set-cookie') ?? '';
  return cookie.split(';')[0]!;
}

async function get(path: string, cookie?: string) {
  const res = await app.request(path, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location'), html: await res.text() };
}

suite('Dashboard contract', () => {
  let cookie: string;
  const tag = `zz${uuid().slice(0, 8)}`;
  const catA = `Kat ${tag}`;

  beforeAll(async () => {
    await runMigrations(sql);
    const admin = await signAccessToken({ userId: uuid(), businessId: null, role: 'sirko_admin' });
    const mk = (over: Record<string, unknown>) =>
      app.request('/v1/catalog', {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${tag} produk`, keywords: [tag], ...over }),
      });
    await mk({ name: `${tag} verified`, category: catA, verified: true, barcode: `55${Date.now()}`, photoUrl: 'https://example.com/p.jpg' }); // berfoto → muncul di "Katalog terbaru"
    await mk({ name: `${tag} belum`, category: catA, verified: false });
    await mk({ name: `${tag} lain`, category: `Lain ${tag}`, verified: true });
    cookie = await login();
  });
  afterAll(async () => {
    await sql`DELETE FROM public_products WHERE name LIKE ${tag + '%'}`;
    await sql.end({ timeout: 5 });
  });

  it('tanpa sesi → redirect ke login dengan next', async () => {
    const r = await get('/dashboard/catalog?category=Snack');
    expect(r.status).toBe(302);
    expect(r.location).toBe('/dashboard/login?next=' + encodeURIComponent('/dashboard/catalog?category=Snack'));
  });

  it('halaman login tampil; password salah → 401 tanpa cookie', async () => {
    const page = await get('/dashboard/login');
    expect(page.status).toBe(200);
    expect(page.html).toContain('name="password"');

    const { body, ...h } = form({ user: USER, password: 'salah-banget' });
    const res = await app.request('/dashboard/login', { method: 'POST', headers: h, body });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.text()).toContain('Username atau password salah');
  });

  it('login benar → cookie HttpOnly SameSite=Lax; next eksternal ditolak (open redirect)', async () => {
    const { body, ...h } = form({ user: USER, password: PASS, next: 'https://evil.example/x' });
    const res = await app.request('/dashboard/login', { method: 'POST', headers: h, body });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/dashboard');
    const sc = res.headers.get('set-cookie') ?? '';
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    expect(sc).not.toMatch(/Secure/i); // request http → tanpa Secure

    const https = form({ user: USER, password: PASS });
    const r2 = await app.request('/dashboard/login', {
      method: 'POST',
      headers: { 'Content-Type': https['Content-Type'], 'x-forwarded-proto': 'https' },
      body: https.body,
    });
    expect(r2.headers.get('set-cookie')).toMatch(/Secure/);
  });

  it('cookie dipalsukan ditolak', async () => {
    const r = await get('/dashboard', 'sirko_admin=admin|9999999999999.fakesig');
    expect(r.status).toBe(302);
  });

  it('filter katalog via query URL: kategori + verified', async () => {
    const all = await get(`/dashboard/catalog?category=${encodeURIComponent(catA)}`, cookie);
    expect(all.status).toBe(200);
    expect(all.html).toContain(`${tag} verified`);
    expect(all.html).toContain(`${tag} belum`);
    expect(all.html).not.toContain(`${tag} lain`);

    const ver = await get(`/dashboard/catalog?category=${encodeURIComponent(catA)}&verified=1`, cookie);
    expect(ver.html).toContain(`${tag} verified`);
    expect(ver.html).not.toContain(`${tag} belum`);
    // filter aktif tetap di form & chip (aman saat reload)
    expect(ver.html).toContain(`name="category" value="${catA}"`);
    expect(ver.html).toContain('name="verified" value="1"');

    const none = await get(`/dashboard/catalog?q=${tag}&source=crowdsource`, cookie);
    expect(none.html).not.toContain(`${tag} verified`); // dibuat via admin → source=admin
    const adm = await get(`/dashboard/catalog?q=${tag}&source=admin`, cookie);
    expect(adm.html).toContain(`${tag} lain`);
  });

  it('ringkasan: kategori = link ke katalog terfilter + tombol lihat semua', async () => {
    const r = await get('/dashboard', cookie);
    expect(r.status).toBe(200);
    expect(r.html).toContain(`href="/dashboard/catalog?category=${encodeURIComponent(catA).replace(/%20/g, '+')}"`);
    expect(r.html).toContain('Lihat semua produk');
  });

  async function post(path: string, data: Record<string, string | string[]>) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(data)) for (const x of [v].flat()) body.append(k, x);
    const res = await app.request(path, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    return { status: res.status, location: res.headers.get('location'), html: await res.text() };
  }

  async function idsByName(prefix: string): Promise<string[]> {
    const rows = await sql<{ id: string }[]>`SELECT id FROM public_products WHERE name LIKE ${prefix + '%'} ORDER BY name`;
    return rows.map((r) => r.id);
  }

  it('edit produk via form: simpan, validasi, barcode duplikat', async () => {
    const id = (await idsByName(`${tag} belum`))[0]!;
    const form = await get(`/dashboard/catalog/${id}`, cookie);
    expect(form.status).toBe(200);
    expect(form.html).toContain(`value="${tag} belum"`);

    const back = `/dashboard/catalog?category=${encodeURIComponent(catA)}`;
    const ok = await post(`/dashboard/catalog/${id}`, {
      back, name: `${tag} belum EDIT`, brand: 'BrandX', category: catA, netSize: '250', netUnit: 'ml',
      keywords: 'a, b, a', verified: 'on', source: 'admin',
    });
    expect(ok.status).toBe(302);
    expect(ok.location).toBe(back);
    const [row] = await sql<Record<string, unknown>[]>`SELECT * FROM public_products WHERE id = ${id}`;
    expect(row).toMatchObject({ name: `${tag} belum EDIT`, brand: 'BrandX', net_unit: 'ml', verified: true, keywords: ['a', 'b'] });

    const bad = await post(`/dashboard/catalog/${id}`, { back, name: '' });
    expect(bad.status).toBe(422);
    expect(bad.html).toContain('flash err');

    const [other] = await sql<{ barcode: string }[]>`SELECT barcode FROM public_products WHERE name = ${`${tag} verified`}`;
    const dup = await post(`/dashboard/catalog/${id}`, { back, name: 'x', barcode: other!.barcode });
    expect(dup.status).toBe(422);
    expect(dup.html).toContain('Barcode sudah dipakai');
  });

  it('back URL di luar katalog ditolak (tetap ke /dashboard/catalog)', async () => {
    const id = (await idsByName(`${tag} lain`))[0]!;
    const r = await post(`/dashboard/catalog/${id}`, { back: 'https://evil.example', name: `${tag} lain` });
    expect(r.location).toBe('/dashboard/catalog');
  });

  it('hapus massal → Sampah → pulihkan; tandai verified massal', async () => {
    const ids = await idsByName(tag);
    const back = `/dashboard/catalog?q=${tag}`;
    const del = await post('/dashboard/catalog/bulk', { action: 'delete', ids, back });
    expect(del.location).toBe(back);

    const live = await get(`/dashboard/catalog?q=${tag}`, cookie);
    expect(live.html).not.toContain(`${tag} lain`);
    const [{ c }] = (await sql<{ c: number }[]>`SELECT count(*)::int c FROM public_products WHERE name LIKE ${tag + '%'} AND deleted_at IS NULL`) as unknown as [{ c: number }];
    expect(c).toBe(0);

    const trash = await get(`/dashboard/catalog?q=${tag}&trash=1`, cookie);
    expect(trash.html).toContain('Sampah Katalog');
    expect(trash.html).toContain(`${tag} lain`);

    const res = await post('/dashboard/catalog/bulk', { action: 'restore', ids, back });
    expect(res.status).toBe(302);
    const [{ c: c2 }] = (await sql<{ c: number }[]>`SELECT count(*)::int c FROM public_products WHERE name LIKE ${tag + '%'} AND deleted_at IS NULL`) as unknown as [{ c: number }];
    expect(c2).toBe(ids.length);

    await post('/dashboard/catalog/bulk', { action: 'unverify', ids, back });
    const [{ v }] = (await sql<{ v: number }[]>`SELECT count(*)::int v FROM public_products WHERE name LIKE ${tag + '%'} AND verified`) as unknown as [{ v: number }];
    expect(v).toBe(0);
  });

  it('flash tampil sekali setelah aksi', async () => {
    const id = (await idsByName(`${tag} lain`))[0]!;
    const body = new URLSearchParams({ back: '/dashboard/catalog' }).toString();
    const r = await app.request(`/dashboard/catalog/${id}/delete`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    const flashCookie = (r.headers.get('set-cookie') ?? '').split(';')[0]!;
    const next = await get('/dashboard/catalog', `${cookie}; ${flashCookie}`);
    expect(next.html).toContain('Produk dipindah ke Sampah.');
  });

  it('detail toko: ringkasan jumlah data + tab tabel (aktif & dihapus)', async () => {
    const reg = await app.request('/v1/auth/register-business', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business: { name: `Toko ${tag}` }, owner: { name: 'Bu Tini', email: `o-${tag.slice(2)}@toko.id`, password: 'rahasia123' } }),
    });
    const { data } = (await reg.json()) as { data: { accessToken: string; business: { id: string } } };
    const ts = Date.now();
    const catId = uuid();
    await app.request('/v1/backup/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${data.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tables: {
        categories: [{ id: catId, name: `Minuman ${tag}`, updatedAt: ts }],
        products: [
          { id: uuid(), name: `Kopi ${tag}`, categoryId: catId, sellingPrice: 3500, stock: 12, pinHash: 'x', updatedAt: ts },
          { id: uuid(), name: `Lama ${tag}`, updatedAt: ts, deletedAt: ts },
        ],
        customers: [{ id: uuid(), name: `Pak Budi ${tag}`, debtBalance: 25000, updatedAt: ts }],
      } }),
    });
    const bid = data.business.id;

    const list = await get('/dashboard/businesses', cookie);
    expect(list.html).toContain(`/dashboard/businesses/${bid}`);

    const sum = await get(`/dashboard/businesses/${bid}`, cookie);
    expect(sum.status).toBe(200);
    expect(sum.html).toContain('Bu Tini');
    expect(sum.html).toContain(`?tab=products`);

    const prod = await get(`/dashboard/businesses/${bid}?tab=products`, cookie);
    expect(prod.html).toContain(`Kopi ${tag}`);
    expect(prod.html).toContain('Rp 3.500');
    expect(prod.html).toContain(`Minuman ${tag}`); // kolom relasi tampil sebagai nama
    expect(prod.html).not.toContain(`Lama ${tag}`);

    const gone = await get(`/dashboard/businesses/${bid}?tab=products&deleted=1`, cookie);
    expect(gone.html).toContain(`Lama ${tag}`);

    const users = await get(`/dashboard/businesses/${bid}?tab=users`, cookie);
    expect(users.html).not.toContain('pin_hash');
    expect(users.html).not.toContain('Pin Hash');

    expect((await get(`/dashboard/businesses/${uuid()}`, cookie)).status).toBe(404);
    await sql`DELETE FROM businesses WHERE id = ${bid}`;
  });

  it('logout menghapus cookie', async () => {
    const res = await app.request('/dashboard/logout', { method: 'POST', headers: { Cookie: cookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/dashboard/login');
    expect(res.headers.get('set-cookie')).toMatch(/sirko_admin=;/);
  });
});
