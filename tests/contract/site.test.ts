import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app.js';
import { sql } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { uuid } from '../../src/lib/uuid.js';
import { hashPassword } from '../../src/lib/password.js';
import * as site from '../../src/services/site.service.js';
import * as adminSvc from '../../src/services/admin.service.js';
import { renderMarkdown, extractFaq } from '../../src/site/markdown.js';
import { loadContent } from '../../src/db/seed-site.js';

/**
 * Contract test website publik sirkopos.com + CMS dashboard (migrasi 0015):
 * beranda, blog, halaman, draf/terjadwal, pratinjau admin, 301 slug lama, sitemap/robots/RSS/llms,
 * kanonik & noindex per host, keamanan Markdown, dan editor dashboard.
 */

let dbUp = false;
try {
  await sql`SELECT 1`;
  dbUp = true;
} catch (err) {
  console.warn(`[contract] DB tak tersambung — suite di-skip: ${(err as Error).message}`);
}
const suite = dbUp ? describe : describe.skip;

const tag = uuid().slice(0, 8);
const SITE = 'https://sirkopos.com';

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await app.request(path, { headers: { host: 'sirkopos.com', ...headers }, redirect: 'manual' });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

suite('Website publik & CMS', () => {
  const ids: string[] = [];
  let postSlug = '';
  let pageSlug = '';

  beforeAll(async () => {
    await runMigrations(sql);
    const now = Date.now();
    const post = await site.save(null, {
      kind: 'post', title: `Cara Uji Artikel ${tag}`, slug: `uji-artikel-${tag}`, focusKeyword: 'uji artikel',
      metaTitle: `Uji Artikel ${tag} | Sirko`, metaDescription: 'Deskripsi meta uji artikel untuk pengujian kontrak website Sirko yang cukup panjang agar valid dan terbaca.',
      excerpt: 'Ringkasan uji.', category: 'Panduan Warung', tags: 'kasbon, warung',
      bodyMd: `Paragraf pembuka uji artikel.\n\n## Bagian satu\n\nIsi [halaman](/aplikasi-kasir-warung) dan [luar](https://contoh.id).\n\n<script>alert(1)</script>\n\n## Tanya jawab\n\n### Apa ini?\n\nIni uji.\n\n### Untuk apa?\n\nUntuk test.\n\nAjakan penutup.`,
      status: 'published', publishedAt: now - 60_000,
    }, 'tester');
    postSlug = post.slug;
    ids.push(post.id);
    const page = await site.save(null, { kind: 'page', title: `Halaman Uji ${tag}`, slug: `halaman-uji-${tag}`, bodyMd: '## A\n\nB', status: 'published' }, 'tester');
    pageSlug = page.slug;
    ids.push(page.id);
    ids.push((await site.save(null, { kind: 'post', title: `Draf ${tag}`, slug: `draf-${tag}`, bodyMd: 'x', status: 'draft' }, 'tester')).id);
    ids.push((await site.save(null, { kind: 'post', title: `Nanti ${tag}`, slug: `nanti-${tag}`, bodyMd: 'x', status: 'published', publishedAt: now + 86_400_000 }, 'tester')).id);
  });

  afterAll(async () => {
    await sql`DELETE FROM site_posts WHERE id IN ${sql(ids)}`;
    await sql`DELETE FROM site_redirects WHERE from_path LIKE ${'%' + tag + '%'} OR to_path LIKE ${'%' + tag + '%'}`;
    await sql`DELETE FROM admin_users WHERE email = ${`site-${tag}@contoh.id`}`;
    await sql.end({ timeout: 5 });
  });

  it('beranda: H1 berkata kunci, kanonik, schema, tema bawaan terang, tanpa noindex', async () => {
    const r = await get('/');
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/<h1><span class="eyebrow h1-kicker">Aplikasi kasir gratis untuk warung/);
    expect(r.text).toContain(`<link rel="canonical" href="${SITE}/">`);
    expect(r.text).toContain('"@type":"SoftwareApplication"');
    expect(r.text).toContain('"@type":"FAQPage"');
    expect(r.text).toContain('index, follow');
    expect(r.text).not.toMatch(/<html[^>]*data-theme/); // terang kecuali pengguna memilih gelap
    expect(r.text).toContain('data-theme-toggle');
    expect(r.headers.get('x-robots-tag')).toBeNull();
  });

  it('artikel: konten aman, TOC/schema BlogPosting + FAQ + breadcrumb, terkait, meta OG', async () => {
    const r = await get(`/blog/${postSlug}`);
    expect(r.status).toBe(200);
    expect(r.text).not.toContain('<script>alert(1)</script>');
    expect(r.text).toContain(`<link rel="canonical" href="${SITE}/blog/${postSlug}">`);
    expect(r.text).toContain('<meta property="og:type" content="article">');
    expect(r.text).toContain('"@type":"BlogPosting"');
    expect(r.text).toContain('"@type":"BreadcrumbList"');
    expect(r.text).toMatch(/"@type":"FAQPage".*"name":"Apa ini\?"/);
    expect(r.text).toContain('href="https://contoh.id" target="_blank" rel="noopener"');
    expect(r.text).toContain('<h2 id="bagian-satu">');
  });

  it('halaman, blog, kategori tampil; draf & terjadwal tersembunyi', async () => {
    expect((await get(`/${pageSlug}`)).status).toBe(200);
    const blog = await get('/blog');
    expect(blog.status).toBe(200);
    expect(blog.text).toContain(`/blog/${postSlug}`);
    expect(blog.text).not.toContain(`draf-${tag}`);
    expect(blog.text).not.toContain(`nanti-${tag}`);
    expect((await get('/blog/kategori/panduan-warung')).status).toBe(200);
    expect((await get(`/blog/draf-${tag}`)).status).toBe(404);
    expect((await get(`/blog/nanti-${tag}`)).status).toBe(404);
    expect((await get('/blog/kategori/tidak-ada')).status).toBe(404);
  });

  it('pratinjau draf hanya untuk admin yang login (noindex, no-store)', async () => {
    expect((await get(`/blog/draf-${tag}?preview=1`)).status).toBe(404);
    const email = `site-${tag}@contoh.id`;
    await adminSvc.ensureBootstrap();
    await sql`INSERT INTO admin_users ${sql({ id: uuid(), email, name: 'Site', password_hash: await hashPassword('rahasia-site-1'), password_changed_at: 0, created_at: Date.now(), updated_at: Date.now() })}`;
    const login = await app.request('/dashboard/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': `10.66.${tag.charCodeAt(0)}.1` },
      body: new URLSearchParams({ user: email, password: 'rahasia-site-1', next: '/dashboard' }).toString(),
      redirect: 'manual',
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
    const r = await get(`/blog/draf-${tag}?preview=1`, { cookie });
    expect(r.status).toBe(200);
    expect(r.text).toContain('Pratinjau');
    expect(r.text).toContain('noindex');
    expect(r.headers.get('cache-control')).toBe('no-store');

    // Editor dashboard: daftar, buat baru (validasi slug), simpan.
    const list = await app.request('/dashboard/site/posts', { headers: { cookie } });
    expect(list.status).toBe(200);
    expect(await list.text()).toContain(`Cara Uji Artikel ${tag}`);
    const bad = await app.request('/dashboard/site/pages', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ title: 'Halaman Blog', slug: 'blog', bodyMd: 'x', status: 'draft' }).toString(),
    });
    expect(bad.status).toBe(422);
    expect(await bad.text()).toContain('dipakai sistem');
    const ok = await app.request('/dashboard/site/posts', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ title: `Dibuat Dari Editor ${tag}`, bodyMd: '## Hai\n\nIsi', status: 'draft', tags: 'a, b' }).toString(),
      redirect: 'manual',
    });
    expect(ok.status).toBe(302);
    const made = (await sql`SELECT id, slug, tags FROM site_posts WHERE slug = ${`dibuat-dari-editor-${tag}`}`)[0]!;
    ids.push(made.id as string);
    expect(made.tags).toEqual(['a', 'b']);
    const pv = await app.request('/dashboard/site/preview', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ md: '## Satu\n\n[x](/a) <img src=x onerror=alert(1)>' }),
    });
    const j = (await pv.json()) as { html: string; h2: number; internalLinks: number };
    expect(j).toMatchObject({ h2: 1, internalLinks: 1 });
    expect(j.html).not.toContain('onerror');
  });

  it('slug artikel terbit diganti → 301 dari URL lama', async () => {
    const p = (await site.getLive('post', postSlug))!;
    const moved = await site.save(p.id, { ...p, kind: 'post', slug: `${postSlug}-baru`, tags: p.tags, publishedAt: p.publishedAt, coverUrl: p.coverUrl ?? '' }, 'tester');
    const r = await get(`/blog/${postSlug}`);
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe(`/blog/${moved.slug}`);
    postSlug = moved.slug;
  });

  it('sitemap, robots, RSS, llms.txt, manifest', async () => {
    const sm = await get('/sitemap.xml');
    expect(sm.headers.get('content-type')).toContain('application/xml');
    expect(sm.text).toContain(`<loc>${SITE}/blog/${postSlug}</loc>`);
    expect(sm.text).toContain(`<loc>${SITE}/${pageSlug}</loc>`);
    expect(sm.text).not.toContain(`draf-${tag}`);
    expect(sm.text).not.toContain(`nanti-${tag}`);
    const rb = await get('/robots.txt');
    expect(rb.text).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(rb.text).toContain('Disallow: /dashboard');
    const feed = await get('/feed.xml');
    expect(feed.text).toContain(`${SITE}/blog/${postSlug}`);
    expect((await get('/llms.txt')).text).toContain('# Sirko');
    expect((await get('/site.webmanifest')).status).toBe(200);
  });

  it('host lain: noindex & robots larang semua; www → 301 host utama; trailing slash → 301', async () => {
    const other = await get('/', { host: 'sirko.produkdesa.com' });
    expect(other.status).toBe(200);
    expect(other.headers.get('x-robots-tag')).toBe('noindex');
    expect(other.text).toContain(`<link rel="canonical" href="${SITE}/">`);
    // robots sama di semua host agar X-Robots-Tag noindex host lain bisa dibaca crawler.
    expect((await get('/robots.txt', { host: 'sirko.produkdesa.com' })).text).toContain('Allow: /');
    const www = await get('/blog?halaman=1', { host: 'www.sirkopos.com' });
    expect(www.status).toBe(301);
    expect(www.headers.get('location')).toBe(`${SITE}/blog?halaman=1`);
    const slash = await get('/blog/');
    expect(slash.status).toBe(301);
    expect(slash.headers.get('location')).toBe('/blog');
  });

  it('404 HTML untuk situs, tapi /v1 tetap JSON; dashboard noindex', async () => {
    const r = await get('/tidak-ada-halaman-ini');
    expect(r.status).toBe(404);
    expect(r.text).toContain('noindex');
    expect(r.text).not.toContain('rel="canonical"');
    const api = await get('/v1/tidak-ada');
    expect(api.status).toBe(404);
    expect(api.headers.get('content-type')).toContain('application/json');
    expect((await get('/dashboard/login')).headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('keamanan & kanonik: CSP, huruf besar → 301, font lokal tanpa pihak ketiga', async () => {
    const r = await get('/');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(r.headers.get('content-security-policy')).not.toContain("script-src 'self' 'unsafe-inline'");
    // Setiap <script> inline yang dapat dieksekusi wajib cocok dengan hash di CSP.
    const csp = r.headers.get('content-security-policy')!;
    const { createHash } = await import('node:crypto');
    for (const m of r.text.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      expect(csp).toContain(`'sha256-${createHash('sha256').update(m[1]!, 'utf8').digest('base64')}'`);
    }
    expect(r.text).not.toContain('fonts.googleapis.com');
    expect(r.text).toContain('/fonts/plus-jakarta-sans-latin.woff2');
    const up = await get(`/${pageSlug.toUpperCase()}`);
    expect(up.status).toBe(301);
    expect(up.headers.get('location')).toBe(`/${pageSlug}`);
    expect((await get('/fonts/plus-jakarta-sans-latin.woff2')).headers.get('cache-control')).toContain('immutable');
    expect((await get('/site.webmanifest')).headers.get('content-type')).toContain('application/manifest+json');
  });

  it('formulir: daftar tunggu, kontak, hapus akun → tersimpan; honeypot & validasi', async () => {
    const post = (path: string, data: Record<string, string>, ip: string) =>
      app.request(path, {
        method: 'POST',
        headers: { host: 'sirkopos.com', 'Content-Type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': ip },
        body: new URLSearchParams(data).toString(),
        redirect: 'manual',
      });
    const ip = `10.67.${tag.charCodeAt(1)}.${tag.charCodeAt(2)}`;
    const w = await post('/daftar-tunggu', { name: `Bu ${tag}`, contact: '081234567890', storeType: 'Toko sembako' }, ip);
    expect(w.status).toBe(303);
    expect(w.headers.get('location')).toBe('/?terdaftar=1#unduh');
    expect((await get('/?terdaftar=1')).text).toContain('Terima kasih');
    const bad = await post('/kontak', { contact: 'bukan-kontak', message: 'halo semua' }, ip);
    expect(bad.status).toBe(422);
    expect(await bad.text()).toContain('email atau nomor WhatsApp yang valid');
    expect((await post('/kontak', { name: `Kontak ${tag}`, contact: `k-${tag}@contoh.id`, message: 'Tanya harga Juragan' }, ip)).status).toBe(303);
    expect((await post('/hapus-akun', { name: `Hapus ${tag}`, contact: `h-${tag}@contoh.id` }, ip)).status).toBe(303);
    const spam = await post('/kontak', { name: `Bot ${tag}`, contact: `bot-${tag}@contoh.id`, message: 'spam', website: 'http://spam' }, ip);
    expect(spam.status).toBe(303); // bot dibohongi, tapi tak tersimpan
    const rows = await sql`SELECT kind FROM site_leads WHERE name LIKE ${'%' + tag} ORDER BY kind`;
    expect(rows.map((r) => r.kind)).toEqual(['contact', 'delete_account', 'waitlist']);
    expect((await get('/hapus-akun')).text).toContain('tanpa perlu memasang aplikasi');
    await sql`DELETE FROM site_leads WHERE name LIKE ${'%' + tag}`;
  });

  it('hapus konten: 410 Gone, atau 301 bila diberi tujuan; seed tak menghidupkan lagi', async () => {
    const a = await site.save(null, { kind: 'post', title: `Akan Dihapus ${tag}`, slug: `akan-dihapus-${tag}`, bodyMd: 'x', status: 'published' }, 'tester');
    const b = await site.save(null, { kind: 'post', title: `Dialihkan ${tag}`, slug: `dialihkan-${tag}`, bodyMd: 'x', status: 'published' }, 'tester');
    ids.push(a.id, b.id);
    await site.remove(a.id);
    await site.remove(b.id, `/blog/${postSlug}`);
    expect((await get(`/blog/akan-dihapus-${tag}`)).status).toBe(410);
    const moved = await get(`/blog/dialihkan-${tag}`);
    expect(moved.status).toBe(301);
    expect(moved.headers.get('location')).toBe(`/blog/${postSlug}`);
    expect(await site.seedIfMissing({ kind: 'post', slug: `akan-dihapus-${tag}`, title: 'Lagi', body: 'x' })).toBe(false);
    expect(await site.seedIfMissing({ kind: 'post', slug: `dialihkan-${tag}`, title: 'Lagi', body: 'x' })).toBe(false);
    await expect(site.remove(b.id, 'https://luar.com')).resolves.toBeUndefined(); // sudah terhapus → abaikan
  });

  it('revisi: tiap simpan menyimpan versi lama; pulihkan mengembalikan isi', async () => {
    const p = await site.save(null, { kind: 'page', title: `Revisi ${tag}`, slug: `revisi-${tag}`, bodyMd: 'versi satu', status: 'draft' }, 'tester');
    ids.push(p.id);
    await site.save(p.id, { kind: 'page', title: `Revisi ${tag}`, slug: `revisi-${tag}`, bodyMd: 'versi dua', status: 'draft' }, 'tester');
    const revs = await site.revisions(p.id);
    expect(revs).toHaveLength(1);
    const back = await site.restoreRevision(p.id, revs[0]!.id, 'tester');
    expect(back.bodyMd.trim()).toBe('versi satu');
    expect(await site.revisions(p.id)).toHaveLength(2);
  });

  it('hapus akun: data toko hilang, akun dianonimkan, catatan Poin tetap; salah konfirmasi ditolak', async () => {
    const { registerOwnerStore } = await import('../helpers/owner-store.js');
    const usersAdmin = await import('../../src/services/users-admin.service.js');
    const points = await import('../../src/services/points.service.js');
    const email = `hapus-${tag}@contoh.id`;
    const r = await registerOwnerStore({ business: { name: `Toko Hapus ${tag}` }, owner: { name: 'Pemilik', email, password: 'rahasia123' } });
    const biz = r.json.data.business.id as string;
    const acc = (await points.ownerAccountId(biz))!;
    await points.adminAdjust(acc, 10_000, 'uji hapus', 'tester', null);
    await points.adminAdjust(acc, 5_000, 'uji hapus toko', 'tester', biz); // ledger merujuk toko → toko dianonimkan
    await sql`INSERT INTO categories ${sql({ id: uuid(), business_id: biz, name: 'Uji', created_at: Date.now(), updated_at: Date.now() })}`.catch(() => null);
    await expect(usersAdmin.deleteAccount(acc, 'salah@contoh.id', 'tester')).rejects.toThrow(/konfirmasi/);
    expect(await usersAdmin.deleteAccount(acc, email.toUpperCase(), 'tester')).toEqual({ stores: 1 });
    const a = (await sql`SELECT email::text AS email, phone, name FROM accounts WHERE id = ${acc}`)[0]!;
    expect(a.email).toMatch(/@sirkopos\.invalid$/);
    expect(a.phone).toBeNull();
    const b = (await sql`SELECT name, deleted_at FROM businesses WHERE id = ${biz}`)[0]!;
    expect(b.name).toBe('Toko dihapus');
    expect(b.deleted_at).not.toBeNull();
    expect((await sql`SELECT count(*)::int n FROM categories WHERE business_id = ${biz}`)[0]!.n).toBe(0);
    expect((await sql`SELECT count(*)::int n FROM point_ledger WHERE account_id = ${acc}`)[0]!.n).toBe(2); // catatan keuangan disimpan
    const login = await app.request('/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: email, password: 'rahasia123' }) });
    expect(login.status).toBe(401);
  });

  it('retensi formulir: kiriman > 12 bulan dihapus', async () => {
    const old = uuid();
    await sql`INSERT INTO site_leads ${sql({ id: old, kind: 'contact', contact: `lama-${tag}@contoh.id`, created_at: Date.now() - 400 * 86_400_000 })}`;
    expect(await site.purgeOldLeads()).toBeGreaterThanOrEqual(1);
    expect((await sql`SELECT count(*)::int n FROM site_leads WHERE id = ${old}`)[0]!.n).toBe(0);
  });

  it('kontak & pengelola diisi saat render di halaman legal', () => {
    const html = renderMarkdown('Hubungi **[EMAIL KONTAK]**. Dikelola **[PENGELOLA]**.').html;
    expect(html).toContain('href="/kontak"');
    expect(html).not.toContain('[EMAIL KONTAK]');
    expect(html).not.toContain('[PENGELOLA]');
  });

  it('Markdown: FAQ diambil dari "## Tanya jawab" (paragraf ajakan tak ikut), H1 diturunkan', () => {
    const faq = extractFaq('## Tanya jawab\n\n### Satu?\n\nJawab satu.\n\n### Dua?\n\nJawab dua.\n\nAjakan coba Sirko.\n');
    expect(faq).toEqual([{ q: 'Satu?', a: 'Jawab satu.' }, { q: 'Dua?', a: 'Jawab dua.' }]);
    expect(renderMarkdown('# Judul').html).toContain('<h2 id="judul">');
  });

  it('konten awal (content/site) valid: meta dalam batas & kata kunci dipakai', () => {
    const docs = loadContent();
    expect(docs.length).toBeGreaterThanOrEqual(10);
    for (const d of docs) {
      expect(d.meta_title!.length, d.slug).toBeLessThanOrEqual(60);
      expect(d.meta_description!.length, d.slug).toBeGreaterThanOrEqual(120);
      expect(d.meta_description!.length, d.slug).toBeLessThanOrEqual(160);
      expect(d.published_at, d.slug).toBeGreaterThan(0);
      const k = d.focus_keyword!.toLowerCase();
      expect(`${d.title} ${d.meta_description}`.toLowerCase(), d.slug).toContain(k.split(' ')[0]);
    }
  });
});
