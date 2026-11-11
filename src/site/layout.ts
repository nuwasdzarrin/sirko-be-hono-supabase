import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { escAttr, escHtml } from './markdown.js';

/**
 * Kerangka HTML website publik sirkopos.com: <head> SEO lengkap (title, description,
 * canonical, robots, Open Graph, Twitter, JSON-LD), header, footer, dan tema terang/gelap
 * (bawaan TERANG; pilihan disimpan di localStorage 'sirko-theme' — sama dengan dashboard).
 */

export const SITE_NAME = 'Sirko';
export const TAGLINE = 'Kasir toko, untung kelihatan.';

export const siteUrl = (path = '/') => `${env.SITE_URL.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
export const siteHost = () => new URL(env.SITE_URL).hostname;

export interface Crumb {
  name: string;
  path: string;
}

export interface PageOpts {
  title: string; // <title> lengkap
  description: string;
  path: string; // path kanonik, mis. /blog/slug
  body: string;
  ogType?: 'website' | 'article';
  ogImage?: string | null;
  ogImageAlt?: string;
  noindex?: boolean;
  jsonLd?: object[];
  crumbs?: Crumb[];
  article?: { publishedAt: number; modifiedAt: number; section?: string; tags?: string[] };
  preload?: string; // URL gambar LCP
  preloadSrcset?: string;
  extraHead?: string;
}

export const ORG_ID = () => siteUrl('/#org');

export function orgJsonLd() {
  return {
    '@type': 'Organization',
    '@id': ORG_ID(),
    name: SITE_NAME,
    url: siteUrl('/'),
    logo: { '@type': 'ImageObject', url: siteUrl('/img/icon-512.png'), width: 512, height: 512 },
    slogan: TAGLINE,
    description: 'Aplikasi kasir Android untuk warung, toko kelontong, toko sembako, dan toko grosir di Indonesia.',
    ...(env.SITE_OPERATOR ? { legalName: env.SITE_OPERATOR } : {}),
    areaServed: { '@type': 'Country', name: 'Indonesia' },
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      availableLanguage: ['Indonesian'],
      url: siteUrl('/kontak'),
      ...(env.SITE_CONTACT_EMAIL ? { email: env.SITE_CONTACT_EMAIL } : {}),
    },
  };
}

export function breadcrumbJsonLd(crumbs: Crumb[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: siteUrl(c.path) })),
  };
}

const LOGO_SVG = `<svg viewBox="0 0 512 512" aria-hidden="true" focusable="false"><use href="#sirko-mark"/></svg>`;

/** Simbol logo (sekali per halaman), dibaca dari aset hasil branding/build-brand.py (sumber tunggal). */
const LOGO_SYMBOL = (() => {
  const raw = readFileSync(fileURLToPath(new URL('../../public/site/img/logo-mark.svg', import.meta.url)), 'utf8');
  const inner = raw.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="sirko-mark" viewBox="0 0 512 512">${inner}</symbol></svg>`;
})();

/** Hash CSP untuk skrip inline statis (THEME_BOOT/THEME_JS) — situs tak butuh 'unsafe-inline'. */
export const scriptHash = (code: string) => `'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`;

const THEME_BOOT = `(function(){try{var t=localStorage.getItem('sirko-theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark')}catch(e){}})();`;
const THEME_JS = `document.addEventListener('click',function(e){var b=e.target.closest('[data-theme-toggle]');if(!b)return;var r=document.documentElement,d=r.getAttribute('data-theme')==='dark';if(d)r.removeAttribute('data-theme');else r.setAttribute('data-theme','dark');b.setAttribute('aria-pressed',String(!d));try{localStorage.setItem('sirko-theme',d?'light':'dark')}catch(e){}});
(function(){var b=document.querySelector('[data-theme-toggle]');if(b)b.setAttribute('aria-pressed',String(document.documentElement.getAttribute('data-theme')==='dark'))})();
(function(){var t=document.querySelector('[data-menu-toggle]'),n=document.getElementById('site-nav');if(t&&n)t.addEventListener('click',function(){var o=n.classList.toggle('open');t.setAttribute('aria-expanded',String(o))})})();`;

export const SITE_CSS = `
:root{
  --green:#0F7B5F;--green-d:#0A5A45;--green-50:#E7F4EF;--green-tx:#0F7B5F;
  --mango:#FF9F1C;--mango-50:#FFF3E0;
  --ink:#14213D;--mut:#535C70;--line:#E6E1D6;
  --bg:#FFFBF4;--card:#FFFFFF;--sunk:#F6F1E7;
  --shadow:0 18px 50px -20px rgba(20,33,61,.25);color-scheme:light;
}
:root[data-theme="dark"]{
  --ink:#EEF1F7;--mut:#A8B0C2;--line:#283247;--green-tx:#4FD1A5;
  --bg:#0E1424;--card:#151D31;--sunk:#111A2C;--green-50:#10302A;--mango-50:#3A2A10;
  --shadow:0 18px 50px -20px rgba(0,0,0,.6);color-scheme:dark;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
@font-face{font-family:"Plus Jakarta Sans";font-style:normal;font-weight:400 800;font-display:swap;src:url(/fonts/plus-jakarta-sans-latin.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:17px;line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:inherit}
img,svg{display:block;max-width:100%}
.wrap{max-width:1140px;margin:0 auto;padding:0 20px}
.skip{position:absolute;left:-999px;top:8px;background:var(--ink);color:var(--bg);padding:8px 14px;border-radius:8px;z-index:99}
.skip:focus{left:12px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:14px 22px;border-radius:14px;font-weight:700;text-decoration:none;font-size:16px;border:2px solid transparent;transition:transform .15s ease,box-shadow .15s ease;cursor:pointer;font-family:inherit}
.btn:hover{transform:translateY(-2px)}
.btn-primary{background:var(--green);color:#fff;box-shadow:0 10px 24px -10px rgba(15,123,95,.7)}
.btn-ghost{border-color:var(--line);background:var(--card);color:var(--ink)}
.eyebrow{display:inline-block;font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--green-tx)}
h1,h2,h3{line-height:1.2;letter-spacing:-.02em;margin:0}
h2{font-size:clamp(28px,4vw,40px);font-weight:800}
.lead{font-size:19px;color:var(--mut)}
section{padding:88px 0}
.center{text-align:center}
.center .lead{max-width:680px;margin:14px auto 0}
:focus-visible{outline:3px solid var(--mango);outline-offset:3px;border-radius:6px}

header.top{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
header.top .wrap{display:flex;align-items:center;gap:14px;height:68px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;font-weight:800;font-size:23px;letter-spacing:-.03em}
.brand svg{width:36px;height:36px}
#site-nav{display:flex;gap:22px;margin-left:auto;align-items:center}
#site-nav a{text-decoration:none;color:var(--mut);font-weight:600;font-size:15px}
#site-nav a:hover,#site-nav a[aria-current="page"]{color:var(--ink)}
.icon-btn{display:inline-grid;place-items:center;width:42px;height:42px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;flex:none}
.icon-btn svg{width:19px;height:19px}
.ico-dark{display:none}
:root[data-theme="dark"] .ico-dark{display:block}
:root[data-theme="dark"] .ico-light{display:none}
header .btn{padding:10px 16px;font-size:15px}
.menu-btn{display:none}
@media (max-width:860px){
  .menu-btn{display:inline-grid}
  #site-nav{display:none;position:absolute;top:68px;left:0;right:0;flex-direction:column;align-items:stretch;gap:0;background:var(--card);border-bottom:1px solid var(--line);padding:8px 20px 16px;box-shadow:var(--shadow)}
  #site-nav.open{display:flex}
  #site-nav a{padding:12px 0;font-size:17px;border-bottom:1px solid var(--line)}
  header .cta-top{display:none}
  .brand{margin-right:auto}
}

.crumbs{font-size:14px;color:var(--mut);margin:28px 0 0}
.crumbs ol{list-style:none;display:flex;flex-wrap:wrap;gap:6px;padding:0;margin:0}
.crumbs li+li::before{content:"›";margin-right:6px;opacity:.6}
.crumbs a{text-decoration:none}
.crumbs a:hover{color:var(--ink);text-decoration:underline}

footer.site{border-top:1px solid var(--line);padding:48px 0 56px;color:var(--mut);font-size:15px;margin-top:40px}
footer.site .cols{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr 1fr;gap:28px}
footer.site h3{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink);margin-bottom:12px}
footer.site ul{list-style:none;padding:0;margin:0;display:grid;gap:8px}
footer.site a{text-decoration:none}
footer.site a:hover{color:var(--ink);text-decoration:underline}
footer.site .legal{margin-top:32px;padding-top:20px;border-top:1px solid var(--line);font-size:14px}
@media (max-width:980px){footer.site .cols{grid-template-columns:1fr 1fr 1fr}footer.site .cols>div:first-child{grid-column:1/-1}}
@media (max-width:560px){footer.site .cols{grid-template-columns:1fr 1fr}}

/* artikel & halaman */
.doc{max-width:760px;margin:0 auto;padding:12px 0 40px}
.doc-head h1{font-size:clamp(32px,5vw,46px);font-weight:800;margin:14px 0 14px}
.doc-meta{display:flex;flex-wrap:wrap;gap:6px 16px;color:var(--mut);font-size:15px}
.doc-meta a{color:var(--green-tx);font-weight:700;text-decoration:none}
.cover{margin:28px 0 8px;border-radius:20px;overflow:hidden;border:1px solid var(--line);background:var(--sunk);aspect-ratio:1200/630}
.cover img{width:100%;height:100%;object-fit:cover}
.toc{background:var(--sunk);border:1px solid var(--line);border-radius:16px;padding:16px 20px;margin:28px 0}
.toc b{display:block;margin-bottom:6px}
.toc ol{margin:0;padding-left:20px;display:grid;gap:4px;font-size:16px}
.toc a{text-decoration:none;color:var(--mut)}
.toc a:hover{color:var(--ink);text-decoration:underline}
.prose{font-size:18px}
.prose>*+*{margin-top:1.1em}
.prose h2{font-size:clamp(24px,3.2vw,30px);margin-top:1.8em;scroll-margin-top:84px}
.prose h3{font-size:21px;margin-top:1.5em;scroll-margin-top:84px}
.prose h4{font-size:18px;margin-top:1.3em}
.prose p,.prose li{color:var(--ink)}
.prose a{color:var(--green-tx);font-weight:600;text-underline-offset:3px}
.prose ul,.prose ol{padding-left:1.3em}
.prose li+li{margin-top:.4em}
.prose blockquote{margin-left:0;border-left:4px solid var(--mango);background:var(--mango-50);padding:12px 18px;border-radius:0 12px 12px 0}
.prose img{border-radius:14px;border:1px solid var(--line);height:auto}
.prose code{background:var(--sunk);padding:2px 6px;border-radius:6px;font-size:.9em}
.prose pre{background:var(--sunk);padding:14px;border-radius:12px;overflow:auto}
.prose pre code{background:none;padding:0}
.prose hr{border:0;border-top:1px solid var(--line);margin:2em 0}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px}
.prose table{border-collapse:collapse;width:100%;font-size:16px;min-width:480px}
.prose th,.prose td{padding:10px 14px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.prose th{background:var(--sunk);font-weight:700}
.prose tr:last-child td{border-bottom:0}
.cta-box{margin:48px 0 0;background:#0A5A45;color:#fff;border-radius:24px;padding:32px;display:flex;gap:20px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.cta-box b{font-size:22px;display:block;letter-spacing:-.02em}
.cta-box p{margin:6px 0 0;color:#E3F1EC}
.cta-box .btn{background:var(--mango);color:#14213D;box-shadow:none}

.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;overflow:hidden;display:flex;flex-direction:column;text-decoration:none;transition:transform .15s ease,box-shadow .15s ease}
.card:hover{transform:translateY(-3px);box-shadow:var(--shadow)}
.card .thumb{aspect-ratio:1200/630;background:var(--sunk);overflow:hidden}
.card .thumb img{width:100%;height:100%;object-fit:cover}
.card .thumb.ph{display:grid;place-items:center;background:linear-gradient(140deg,var(--green-50),var(--mango-50))}
.card .thumb.ph svg{width:64px;height:64px;opacity:.9}
.card .in{padding:18px 20px 22px;display:flex;flex-direction:column;gap:8px;flex:1}
.card .cat{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--green-tx)}
.card h2,.card h3{font-size:20px;line-height:1.3;font-weight:800}
.card p{margin:0;color:var(--mut);font-size:15px}
.card .meta{margin-top:auto;font-size:13px;color:var(--mut)}
@media (max-width:900px){.cards{grid-template-columns:1fr 1fr}}
@media (max-width:600px){.cards{grid-template-columns:1fr}}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:24px 0 30px}
.chips a{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:7px 14px;font-size:14px;font-weight:600;text-decoration:none;color:var(--mut)}
.chips a[aria-current="page"]{background:var(--green);border-color:var(--green);color:#fff}
.pager{display:flex;gap:10px;justify-content:center;margin-top:36px}
.related{margin-top:56px}
.related h2{font-size:26px;margin-bottom:18px}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:28px}
.tags span{background:var(--sunk);border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:14px;color:var(--mut)}
.preview-bar{background:var(--mango);color:#14213D;text-align:center;padding:8px 16px;font-weight:700;font-size:14px}
`;

const NAV = [
  { href: '/#fitur', label: 'Fitur' },
  { href: '/jualan-pulsa-token-listrik', label: 'Pulsa & Token' },
  { href: '/#harga', label: 'Harga' },
  { href: '/blog', label: 'Blog' },
];

export function header(currentPath: string): string {
  const cur = (href: string) => (href === currentPath || (href === '/blog' && currentPath.startsWith('/blog')) ? ' aria-current="page"' : '');
  return `<a class="skip" href="#isi">Langsung ke isi</a>
<header class="top"><div class="wrap">
  <a class="brand" href="/" aria-label="Sirko — beranda">${LOGO_SVG}sirko</a>
  <nav id="site-nav" aria-label="Menu utama">${NAV.map((n) => `<a href="${n.href}"${cur(n.href)}>${n.label}</a>`).join('')}</nav>
  <button type="button" class="icon-btn" data-theme-toggle aria-pressed="false" aria-label="Ganti tema terang/gelap" title="Ganti tema terang/gelap">
    <svg class="ico-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
    <svg class="ico-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
  </button>
  <button type="button" class="icon-btn menu-btn" data-menu-toggle aria-expanded="false" aria-controls="site-nav" aria-label="Buka menu">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
  </button>
  <a class="btn btn-primary cta-top" href="/#unduh">Coba Gratis</a>
</div></header>`;
}

export function footer(): string {
  const year = new Date().getUTCFullYear();
  return `<footer class="site"><div class="wrap">
  <div class="cols">
    <div>
      <a class="brand" href="/" style="font-size:20px">${LOGO_SVG.replace('aria-hidden', 'style="width:30px;height:30px" aria-hidden')}sirko</a>
      <p style="margin:12px 0 0;max-width:300px">Aplikasi kasir gratis untuk warung &amp; toko kelontong. ${TAGLINE}</p>
    </div>
    <nav aria-label="Produk"><h3>Produk</h3><ul>
      <li><a href="/aplikasi-kasir-warung">Aplikasi kasir warung</a></li>
      <li><a href="/aplikasi-kasir-offline">Kasir offline</a></li>
      <li><a href="/aplikasi-kasbon">Catatan kasbon</a></li>
      <li><a href="/jualan-pulsa-token-listrik">Pulsa &amp; token listrik</a></li>
      <li><a href="/#harga">Harga</a></li>
    </ul></nav>
    <nav aria-label="Belajar"><h3>Belajar</h3><ul>
      <li><a href="/blog">Blog</a></li>
      <li><a href="/#faq">Tanya jawab</a></li>
      <li><a href="/feed.xml">RSS</a></li>
    </ul></nav>
    <nav aria-label="Perusahaan"><h3>Perusahaan</h3><ul>
      <li><a href="/tentang">Tentang Sirko</a></li>
      <li><a href="/kontak">Kontak</a></li>
      <li><a href="/hapus-akun">Hapus akun</a></li>
    </ul></nav>
    <nav aria-label="Legal"><h3>Legal</h3><ul>
      <li><a href="/kebijakan-privasi">Kebijakan privasi</a></li>
      <li><a href="/syarat-ketentuan">Syarat &amp; ketentuan</a></li>
    </ul></nav>
  </div>
  <div class="legal">© ${year} Sirko${env.SITE_OPERATOR ? ` · dikelola oleh ${escHtml(env.SITE_OPERATOR)}` : ''} · ${TAGLINE}</div>
</div></footer>`;
}

export function breadcrumbsHtml(crumbs: Crumb[]): string {
  if (crumbs.length < 2) return '';
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol>${crumbs
    .map((c, i) => (i === crumbs.length - 1 ? `<li aria-current="page">${escHtml(c.name)}</li>` : `<li><a href="${escAttr(c.path)}">${escHtml(c.name)}</a></li>`))
    .join('')}</ol></nav>`;
}

export function renderPage(o: PageOpts): string {
  const canonical = siteUrl(o.path);
  const og = o.ogImage ? (o.ogImage.startsWith('http') ? o.ogImage : siteUrl(o.ogImage)) : siteUrl('/img/og-image.png');
  const graph = [orgJsonLd(), ...(o.crumbs && o.crumbs.length > 1 ? [breadcrumbJsonLd(o.crumbs)] : []), ...(o.jsonLd ?? [])];
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
  const art = o.article
    ? `<meta property="article:published_time" content="${new Date(o.article.publishedAt).toISOString()}">
<meta property="article:modified_time" content="${new Date(o.article.modifiedAt).toISOString()}">
${o.article.section ? `<meta property="article:section" content="${escAttr(o.article.section)}">` : ''}
${(o.article.tags ?? []).map((t) => `<meta property="article:tag" content="${escAttr(t)}">`).join('\n')}`
    : '';
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(o.title)}</title>
<meta name="description" content="${escAttr(o.description)}">
${o.noindex ? '' : `<link rel="canonical" href="${escAttr(canonical)}">
`}<meta name="robots" content="${o.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1'}">
<meta name="theme-color" content="#0F7B5F">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/img/logo-mark.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="alternate" type="application/rss+xml" title="Blog Sirko" href="/feed.xml">
<meta property="og:type" content="${o.ogType ?? 'website'}">
<meta property="og:locale" content="id_ID">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:url" content="${escAttr(canonical)}">
<meta property="og:title" content="${escAttr(o.title)}">
<meta property="og:description" content="${escAttr(o.description)}">
<meta property="og:image" content="${escAttr(og)}">
<meta property="og:image:alt" content="${escAttr(o.ogImageAlt ?? `${SITE_NAME} — ${TAGLINE}`)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="${/\.png($|\?)/i.test(og) ? 'image/png' : 'image/jpeg'}">
${art}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(o.title)}">
<meta name="twitter:description" content="${escAttr(o.description)}">
<meta name="twitter:image" content="${escAttr(og)}">
<meta name="twitter:image:alt" content="${escAttr(o.ogImageAlt ?? `${SITE_NAME} — ${TAGLINE}`)}">
<link rel="preload" href="/fonts/plus-jakarta-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
${env.GOOGLE_SITE_VERIFICATION ? `<meta name="google-site-verification" content="${escAttr(env.GOOGLE_SITE_VERIFICATION)}">` : ''}
${o.preload ? `<link rel="preload" as="image" href="${escAttr(o.preload)}"${o.preloadSrcset ? ` imagesrcset="${escAttr(o.preloadSrcset)}" imagesizes="(max-width:800px) 92vw, 760px"` : ''} fetchpriority="high">` : ''}
<script>${THEME_BOOT}</script>
<style>${SITE_CSS}</style>
${o.extraHead ?? ''}
<script type="application/ld+json">${ld}</script>
</head>
<body>
${LOGO_SYMBOL}
${header(o.path)}
${o.body}
${footer()}
<script>${THEME_JS}</script>
</body>
</html>`;
}

/** Nilai script-src CSP situs: hanya skrip sendiri + dua skrip tema inline (via hash). */
export const SITE_SCRIPT_SRC = `'self' ${scriptHash(THEME_BOOT)} ${scriptHash(THEME_JS)}`;
