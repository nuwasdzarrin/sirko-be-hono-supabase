import { Hono, type Context } from 'hono';
import { compress } from 'hono/compress';
import { serveStatic } from '@hono/node-server/serve-static';
import { env } from '../config/env.js';
import * as site from '../services/site.service.js';
import * as adminSvc from '../services/admin.service.js';
import { sessionInfo } from '../lib/dashboard-session.js';
import { renderLanding } from '../site/landing.js';
import { render404, renderBlogIndex, renderPost, renderStaticPage } from '../site/pages.js';
import { siteHost, siteUrl, SITE_NAME, SITE_SCRIPT_SRC, TAGLINE } from '../site/layout.js';
import { escHtml } from '../site/markdown.js';
import { renderContact, renderDeleteAccount, type FormState } from '../site/forms.js';
import { clientIp, hitRateLimit } from '../services/account.service.js';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';

/**
 * Website publik (sirkopos.com): beranda, blog, halaman, sitemap, robots, RSS, llms.txt.
 * Dipasang PALING AKHIR di app (setelah /v1 & /dashboard) karena punya rute tangkap-semua /:slug.
 *
 * Host: URL kanonik selalu SITE_URL. Host lain (mis. sirko.produkdesa.com) mendapat
 * `X-Robots-Tag: noindex` agar tak jadi konten ganda; www.<host> → 301 ke host utama;
 * SITE_FORCE_HOST=true → semua host lain 301 ke SITE_URL (nyalakan setelah domain live).
 */

export const siteRoutes = new Hono();

const isLocal = (h: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h);
const hostOf = (c: Context) => (c.req.header('x-forwarded-host') ?? c.req.header('host') ?? '').toLowerCase().split(',')[0]!.trim();

const isApp = (path: string) => path.startsWith('/v1') || path.startsWith('/dashboard');

siteRoutes.use('*', async (c, next) => {
  if (isApp(c.req.path)) return next();
  const host = hostOf(c);
  const primary = siteHost();
  const bare = host.replace(/:\d+$/, '');
  const url = new URL(c.req.url);
  if (bare === `www.${primary}` || (env.SITE_FORCE_HOST && bare !== primary && !isLocal(host) && host !== '')) {
    return c.redirect(siteUrl(url.pathname + url.search), 301);
  }
  // Satu URL kanonik: huruf kecil (kecuali aset di /img & /fonts).
  if (c.req.method === 'GET' && /[A-Z]/.test(url.pathname) && !/^\/(img|fonts)\//.test(url.pathname)) {
    return c.redirect(url.pathname.toLowerCase() + url.search, 301);
  }
  await next();
  if ((c.req.header('x-forwarded-proto') ?? url.protocol.replace(':', '')) === 'https') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if ((c.res.headers.get('content-type') ?? '').startsWith('text/html')) {
    c.header(
      'Content-Security-Policy',
      `default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src ${SITE_SCRIPT_SRC}; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'`,
    );
  }
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Frame-Options', 'SAMEORIGIN');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (bare !== primary && !isLocal(host) && !c.res.headers.get('X-Robots-Tag')) c.header('X-Robots-Tag', 'noindex');
});
const gzip = compress();
siteRoutes.use('*', (c, next) => (isApp(c.req.path) ? next() : gzip(c, next)));

// ── Aset statis ──────────────────────────────────────────────────────────────
const ROOT = './public/site';
const longCache = async (c: Context, next: () => Promise<void>) => {
  await next();
  if (c.res.status === 200) c.header('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
};
siteRoutes.use('/img/*', longCache, serveStatic({ root: ROOT }));
siteRoutes.get('/favicon.ico', longCache, serveStatic({ path: `${ROOT}/favicon.ico` }));
siteRoutes.use(
  '/fonts/*',
  async (c, next) => {
    await next();
    if (c.res.status === 200) c.header('Cache-Control', 'public, max-age=31536000, immutable');
  },
  serveStatic({ root: ROOT }),
);

const html = (c: Context, body: string, status: 200 | 404 = 200, cache?: string) => {
  c.header('Cache-Control', cache ?? 'public, max-age=300, stale-while-revalidate=3600');
  return c.html(body, status);
};

/** Admin yang sedang login (untuk pratinjau draf). */
async function isAdmin(c: Context): Promise<boolean> {
  const s = await sessionInfo(c);
  if (!s) return false;
  const a = await adminSvc.adminByEmail(s.user);
  return Boolean(a && s.iat >= a.passwordChangedAt);
}

// ── Mesin ────────────────────────────────────────────────────────────────────

siteRoutes.get('/robots.txt', (c) => {
  c.header('Cache-Control', 'public, max-age=3600');
  // Sama untuk semua host: host non-utama memakai X-Robots-Tag noindex (perlu boleh di-crawl agar terbaca).
  return c.text(`User-agent: *\nAllow: /\nDisallow: /dashboard\nDisallow: /v1/\nDisallow: /*?preview=\n\nSitemap: ${siteUrl('/sitemap.xml')}\n`);
});

siteRoutes.get('/sitemap.xml', async (c) => {
  const all = (await site.liveAll()).filter((p) => !p.noindex);
  const posts = all.filter((p) => p.kind === 'post');
  const newest = Math.max(0, ...all.map((p) => p.updatedAt));
  const cats = await site.liveCategories();
  const urls: Array<{ loc: string; lastmod?: number; img?: string }> = [
    { loc: siteUrl('/'), lastmod: newest || undefined },
    ...(posts.length ? [{ loc: siteUrl('/blog'), lastmod: Math.max(...posts.map((p) => p.updatedAt)) }] : []),
    ...cats.map((k) => ({ loc: siteUrl(`/blog/kategori/${k.slug}`) })),
    { loc: siteUrl('/kontak') },
    { loc: siteUrl('/hapus-akun') },
    ...all.map((p) => ({ loc: siteUrl(site.pathOf(p)), lastmod: p.updatedAt, img: p.coverUrl ?? undefined })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls
  .map(
    (u) =>
      `  <url><loc>${escHtml(u.loc)}</loc>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString()}</lastmod>` : ''}${
        u.img ? `<image:image><image:loc>${escHtml(u.img.startsWith('http') ? u.img : siteUrl(u.img))}</image:loc></image:image>` : ''
      }</url>`,
  )
  .join('\n')}
</urlset>`;
  c.header('Cache-Control', 'public, max-age=900');
  return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
});

siteRoutes.get('/feed.xml', async (c) => {
  const posts = (await site.listLivePosts({ limit: 20 })).items;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Blog Sirko</title>
  <link>${siteUrl('/blog')}</link>
  <atom:link href="${siteUrl('/feed.xml')}" rel="self" type="application/rss+xml"/>
  <description>Tips mengelola warung &amp; toko kelontong dari Sirko — ${escHtml(TAGLINE)}</description>
  <language>id-id</language>
${posts
  .map(
    (p) => `  <item>
    <title>${escHtml(p.title)}</title>
    <link>${siteUrl(site.pathOf(p))}</link>
    <guid isPermaLink="true">${siteUrl(site.pathOf(p))}</guid>
    <pubDate>${new Date(p.publishedAt ?? p.updatedAt).toUTCString()}</pubDate>
    ${p.category ? `<category>${escHtml(p.category)}</category>` : ''}
    <description>${escHtml(p.metaDescription || p.excerpt)}</description>
  </item>`,
  )
  .join('\n')}
</channel>
</rss>`;
  c.header('Cache-Control', 'public, max-age=900');
  return c.body(xml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
});

/** Ringkasan untuk mesin jawaban AI (llmstxt.org). */
siteRoutes.get('/llms.txt', async (c) => {
  const all = (await site.liveAll()).filter((p) => !p.noindex);
  const line = (p: site.SitePost) => `- [${p.title}](${siteUrl(site.pathOf(p))}): ${p.metaDescription || p.excerpt}`;
  const txt = `# ${SITE_NAME}

> ${SITE_NAME} adalah aplikasi kasir (POS) Android untuk warung, toko kelontong, toko sembako, dan toko grosir di Indonesia. ${TAGLINE}

- Paket Warung gratis untuk 1 toko; Paket Juragan Rp49.000/bulan atau Rp499.000/tahun untuk sampai 3 toko.
- Kasir, stok, dan kasbon jalan tanpa internet; data dicadangkan otomatis saat online.
- Jual pulsa, paket data, dan token listrik dari layar kasir, satu nota dengan barang lain.
- Tidak dirancang untuk kafe atau restoran.

## Halaman
${all.filter((p) => p.kind === 'page').map(line).join('\n')}

## Artikel
${all.filter((p) => p.kind === 'post').map(line).join('\n')}
`;
  c.header('Cache-Control', 'public, max-age=3600');
  return c.text(txt);
});

siteRoutes.get('/site.webmanifest', (c) => {
  c.header('Cache-Control', 'public, max-age=86400');
  c.header('Content-Type', 'application/manifest+json; charset=utf-8');
  return c.body(JSON.stringify({
    name: 'Sirko — Aplikasi Kasir Warung',
    short_name: 'Sirko',
    description: 'Aplikasi kasir gratis untuk warung & toko kelontong.',
    start_url: '/',
    display: 'browser',
    background_color: '#FFFBF4',
    theme_color: '#0F7B5F',
    lang: 'id',
    icons: [
      { src: '/img/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/img/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/img/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }));
});

// ── Halaman ──────────────────────────────────────────────────────────────────

siteRoutes.get('/', async (c) => {
  const state: FormState = c.req.query('terdaftar') === '1' ? { ok: true } : {};
  return html(c, renderLanding((await site.listLivePosts({ limit: 3 })).items, state), 200, state.ok ? 'no-store' : undefined);
});

// ── Formulir publik ──────────────────────────────────────────────────────────

const formErr = (e: unknown) =>
  e instanceof ZodError ? (e.issues[0]?.message ?? 'Data tidak valid') : e instanceof AppError && e.status < 500 ? e.message : null;

async function submitLead(c: Context, kind: site.LeadKind): Promise<{ ok: true } | { error: string; values: Record<string, string> }> {
  const body = (await c.req.parseBody()) as Record<string, string>;
  const values = { name: body.name ?? '', contact: body.contact ?? '', storeType: body.storeType ?? '', message: body.message ?? '' };
  if (body.website) return { ok: true }; // honeypot terisi → bot; pura-pura sukses
  try {
    const ip = clientIp(c.req.raw.headers);
    await hitRateLimit(`lead:${ip}`, 8, 3_600_000, 'Terlalu banyak kiriman dari jaringan ini. Coba lagi dalam 1 jam.');
    await site.createLead({ kind, ...values }, ip);
    return { ok: true };
  } catch (e) {
    const m = formErr(e);
    if (!m) throw e;
    return { error: m, values };
  }
}

siteRoutes.post('/daftar-tunggu', async (c) => {
  const r = await submitLead(c, 'waitlist');
  if ('ok' in r) return c.redirect('/?terdaftar=1#unduh', 303);
  c.header('Cache-Control', 'no-store');
  return c.html(renderLanding((await site.listLivePosts({ limit: 3 })).items, { error: r.error, values: r.values }), 422);
});

siteRoutes.get('/kontak', (c) => html(c, renderContact(c.req.query('terkirim') === '1' ? { ok: true } : {}), 200, c.req.query('terkirim') ? 'no-store' : undefined));
siteRoutes.post('/kontak', async (c) => {
  const r = await submitLead(c, 'contact');
  if ('ok' in r) return c.redirect('/kontak?terkirim=1', 303);
  c.header('Cache-Control', 'no-store');
  return c.html(renderContact({ error: r.error, values: r.values }), 422);
});

siteRoutes.get('/hapus-akun', (c) => html(c, renderDeleteAccount(c.req.query('terkirim') === '1' ? { ok: true } : {}), 200, c.req.query('terkirim') ? 'no-store' : undefined));
siteRoutes.post('/hapus-akun', async (c) => {
  const r = await submitLead(c, 'delete_account');
  if ('ok' in r) return c.redirect('/hapus-akun?terkirim=1', 303);
  c.header('Cache-Control', 'no-store');
  return c.html(renderDeleteAccount({ error: r.error, values: r.values }), 422);
});

const pageNum = (c: Context) => {
  const n = Number(c.req.query('halaman') ?? '1');
  return Number.isInteger(n) && n >= 1 ? n : 1;
};

siteRoutes.get('/blog', async (c) => {
  const d = await site.listLivePosts({ page: pageNum(c), limit: 12 });
  if (pageNum(c) > d.pages) return html(c, render404(), 404);
  return html(c, renderBlogIndex({ ...d, categories: await site.liveCategories() }));
});

siteRoutes.get('/blog/kategori/:cat', async (c) => {
  const cats = await site.liveCategories();
  const cat = cats.find((k) => k.slug === c.req.param('cat'));
  if (!cat) return notFound(c);
  const d = await site.listLivePosts({ page: pageNum(c), limit: 12, category: cat.name });
  if (pageNum(c) > d.pages) return html(c, render404(), 404);
  return html(c, renderBlogIndex({ ...d, categories: cats, category: cat }));
});

siteRoutes.get('/blog/:slug', async (c) => {
  const slug = c.req.param('slug');
  const preview = c.req.query('preview') !== undefined && (await isAdmin(c));
  const p = preview ? await site.getAny('post', slug) : await site.getLive('post', slug);
  if (!p) return notFound(c);
  const body = renderPost(p, preview ? [] : await site.related(p), { preview });
  return preview ? html(c, body, 200, 'no-store') : html(c, body);
});

siteRoutes.get('/:slug{[a-z0-9-]+}', async (c) => {
  const slug = c.req.param('slug');
  const preview = c.req.query('preview') !== undefined && (await isAdmin(c));
  const p = preview ? await site.getAny('page', slug) : await site.getLive('page', slug);
  if (!p) return notFound(c);
  const body = renderStaticPage(p, { preview });
  return preview ? html(c, body, 200, 'no-store') : html(c, body);
});

/** 404 dengan pengalihan 301 bila slug lama pernah dipakai. */
async function notFound(c: Context) {
  const path = new URL(c.req.url).pathname.replace(/\/+$/, '') || '/';
  const to = await site.redirectFor(path);
  if (to) return c.redirect(to, 301);
  if (await site.wasDeleted(path)) return c.html(render404(true), 410);
  return html(c, render404(), 404, 'no-store');
}

siteRoutes.get('*', (c) => {
  const path = new URL(c.req.url).pathname;
  if (isApp(path)) return c.notFound(); // 404 JSON API/dashboard tetap milik app
  // Garis miring di akhir → versi tanpa garis miring (satu URL kanonik).
  if (path.length > 1 && path.endsWith('/') && !path.startsWith('/v1') && !path.startsWith('/dashboard')) {
    return c.redirect(path.replace(/\/+$/, '') + new URL(c.req.url).search, 301);
  }
  return notFound(c);
});
