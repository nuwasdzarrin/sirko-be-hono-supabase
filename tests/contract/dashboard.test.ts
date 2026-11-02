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
    await mk({ name: `${tag} verified`, category: catA, verified: true, barcode: `55${Date.now()}` });
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

  it('logout menghapus cookie', async () => {
    const res = await app.request('/dashboard/logout', { method: 'POST', headers: { Cookie: cookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/dashboard/login');
    expect(res.headers.get('set-cookie')).toMatch(/sirko_admin=;/);
  });
});
