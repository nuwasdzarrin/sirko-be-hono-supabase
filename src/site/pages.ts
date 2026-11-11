import { escAttr, escHtml, renderMarkdown, slugify, type Rendered } from './markdown.js';
import { breadcrumbsHtml, renderPage, siteHost, siteUrl, ORG_ID, type Crumb } from './layout.js';
import { pathOf, type SitePost } from '../services/site.service.js';

/** Halaman publik selain beranda: daftar blog, kategori, artikel, halaman, 404. */

const fmtDate = (ms: number) =>
  new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(ms));
const isoDate = (ms: number) => new Date(ms).toISOString();

/**
 * Sampul buatan Sirko (seed /img/blog/*.jpg atau unggahan editor .../site/...jpg) selalu punya
 * kembaran lebar 600 (`-600.jpg`) → srcset agar HP murah tak mengunduh 1200px.
 */
export function coverSrcset(url: string): string | null {
  return /\.jpg$/.test(url) && (url.startsWith('/img/blog/') || url.includes('/site/')) ? `${url.replace(/\.jpg$/, '-600.jpg')} 600w, ${url} 1200w` : null;
}
function coverImg(url: string, alt: string, opts: { lcp?: boolean; sizes: string }): string {
  const set = coverSrcset(url);
  return `<img src="${escAttr(url)}"${set ? ` srcset="${escAttr(set)}" sizes="${opts.sizes}"` : ''} alt="${escAttr(alt)}" width="1200" height="630" decoding="async"${opts.lcp ? ' fetchpriority="high"' : ' loading="lazy"'}>`;
}

const PLACEHOLDER = `<svg viewBox="0 0 512 512" aria-hidden="true"><use href="#sirko-mark"/></svg>`;

export function postCards(posts: SitePost[], heading: 'h2' | 'h3' = 'h2'): string {
  return `<div class="cards">${posts
    .map((p) => {
      const minutes = renderMarkdown(p.bodyMd).readingMinutes;
      const thumb = p.coverUrl
        ? `<div class="thumb">${coverImg(p.coverUrl, p.coverAlt || p.title, { sizes: '(max-width:600px) 92vw, (max-width:900px) 46vw, 360px' })}</div>`
        : `<div class="thumb ph">${PLACEHOLDER}</div>`;
      return `<a class="card" href="${escAttr(pathOf(p))}">${thumb}<div class="in">
  ${p.category ? `<span class="cat">${escHtml(p.category)}</span>` : ''}
  <${heading}>${escHtml(p.title)}</${heading}>
  ${p.excerpt ? `<p>${escHtml(p.excerpt)}</p>` : ''}
  <span class="meta"><time datetime="${isoDate(p.publishedAt ?? p.updatedAt)}">${fmtDate(p.publishedAt ?? p.updatedAt)}</time> · ${minutes} menit baca</span>
</div></a>`;
    })
    .join('')}</div>`;
}

const ctaBox = () => `<aside class="cta-box" aria-label="Coba Sirko">
  <div><b>Kasir toko, untung kelihatan.</b><p>Coba Sirko gratis untuk satu toko — jalan tanpa internet.</p></div>
  <a class="btn" href="/#unduh">Coba Gratis</a>
</aside>`;

function toc(r: Rendered): string {
  const h2 = r.headings.filter((h) => h.depth === 2);
  if (h2.length < 3) return '';
  return `<nav class="toc" aria-label="Daftar isi"><b>Daftar isi</b><ol>${h2
    .map((h) => `<li><a href="#${escAttr(h.id)}">${escHtml(h.text)}</a></li>`)
    .join('')}</ol></nav>`;
}

function faqLd(r: Rendered) {
  return r.faq.length >= 2
    ? [{ '@type': 'FAQPage', mainEntity: r.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }]
    : [];
}

const titleOf = (p: SitePost) => p.metaTitle || `${p.title} | Sirko`;
const descOf = (p: SitePost, r: Rendered) =>
  p.metaDescription || p.excerpt || r.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 155);

export function renderPost(p: SitePost, related: SitePost[], opts: { preview?: boolean } = {}): string {
  const r = renderMarkdown(p.bodyMd, { siteHost: siteHost() });
  const path = pathOf(p);
  const crumbs: Crumb[] = [
    { name: 'Beranda', path: '/' },
    { name: 'Blog', path: '/blog' },
    ...(p.category ? [{ name: p.category, path: `/blog/kategori/${slugify(p.category)}` }] : []),
    { name: p.title, path },
  ];
  const published = p.publishedAt ?? p.updatedAt;
  const body = `${opts.preview ? '<div class="preview-bar">Pratinjau — belum tampil untuk publik</div>' : ''}
<main id="isi"><div class="wrap"><article class="doc">
  ${breadcrumbsHtml(crumbs)}
  <header class="doc-head">
    ${p.category ? `<a class="eyebrow" href="/blog/kategori/${escAttr(slugify(p.category))}" style="text-decoration:none;margin-top:24px">${escHtml(p.category)}</a>` : ''}
    <h1>${escHtml(p.title)}</h1>
    <div class="doc-meta">
      <span>Oleh <a href="/tentang">${escHtml(p.author)}</a></span>
      <span>Terbit <time datetime="${isoDate(published)}">${fmtDate(published)}</time></span>
      ${p.updatedAt > published + 86_400_000 ? `<span>Diperbarui <time datetime="${isoDate(p.updatedAt)}">${fmtDate(p.updatedAt)}</time></span>` : ''}
      <span>${r.readingMinutes} menit baca</span>
    </div>
  </header>
  ${p.coverUrl ? `<figure class="cover">${coverImg(p.coverUrl, p.coverAlt || p.title, { lcp: true, sizes: '(max-width:800px) 92vw, 760px' })}</figure>` : ''}
  ${toc(r)}
  <div class="prose">${r.html}</div>
  ${p.tags.length ? `<div class="tags" aria-label="Topik">${p.tags.map((t) => `<span>#${escHtml(t)}</span>`).join('')}</div>` : ''}
  ${ctaBox()}
</article>
${related.length ? `<section class="related" aria-labelledby="terkait" style="padding:0 0 40px"><h2 id="terkait">Artikel terkait</h2>${postCards(related, 'h3')}</section>` : ''}
</div></main>`;
  const image = p.coverUrl ? (p.coverUrl.startsWith('http') ? p.coverUrl : siteUrl(p.coverUrl)) : siteUrl('/img/og-image.png');
  return renderPage({
    title: titleOf(p),
    description: descOf(p, r),
    path,
    body,
    ogType: 'article',
    waAsk: `artikel "${p.title}"`,
    ogImage: p.coverUrl,
    ogImageAlt: p.coverAlt || p.title,
    noindex: p.noindex || opts.preview,
    crumbs,
    preload: p.coverUrl ?? undefined,
    preloadSrcset: p.coverUrl ? (coverSrcset(p.coverUrl) ?? undefined) : undefined,
    article: { publishedAt: published, modifiedAt: p.updatedAt, section: p.category || undefined, tags: p.tags },
    jsonLd: [
      {
        '@type': 'BlogPosting',
        '@id': siteUrl(`${path}#artikel`),
        headline: p.title.slice(0, 110),
        description: descOf(p, r),
        image: [image],
        datePublished: isoDate(published),
        dateModified: isoDate(p.updatedAt),
        author: { '@type': 'Organization', name: p.author, url: siteUrl('/tentang'), parentOrganization: { '@id': ORG_ID() } },
        publisher: { '@id': ORG_ID() },
        mainEntityOfPage: { '@type': 'WebPage', '@id': siteUrl(path) },
        inLanguage: 'id-ID',
        wordCount: r.words,
        ...(p.category ? { articleSection: p.category } : {}),
        ...(p.tags.length ? { keywords: p.tags.join(', ') } : {}),
      },
      ...faqLd(r),
    ],
  });
}

export function renderStaticPage(p: SitePost, opts: { preview?: boolean } = {}): string {
  const r = renderMarkdown(p.bodyMd, { siteHost: siteHost() });
  const path = pathOf(p);
  const crumbs: Crumb[] = [{ name: 'Beranda', path: '/' }, { name: p.title, path }];
  const legal = /privasi|syarat|ketentuan/.test(p.slug);
  const body = `${opts.preview ? '<div class="preview-bar">Pratinjau — belum tampil untuk publik</div>' : ''}
<main id="isi"><div class="wrap"><article class="doc">
  ${breadcrumbsHtml(crumbs)}
  <header class="doc-head"><h1>${escHtml(p.title)}</h1>
    <div class="doc-meta"><span>Diperbarui <time datetime="${isoDate(p.updatedAt)}">${fmtDate(p.updatedAt)}</time></span></div>
  </header>
  ${p.coverUrl ? `<figure class="cover">${coverImg(p.coverUrl, p.coverAlt || p.title, { lcp: true, sizes: '(max-width:800px) 92vw, 760px' })}</figure>` : ''}
  ${toc(r)}
  <div class="prose">${r.html}</div>
  ${legal ? '' : ctaBox()}
</article></div></main>`;
  return renderPage({
    title: titleOf(p),
    description: descOf(p, r),
    path,
    body,
    waAsk: legal ? `${p.title.toLowerCase()}` : `${p.title}`,
    ogImage: p.coverUrl,
    ogImageAlt: p.coverAlt || p.title,
    noindex: p.noindex || opts.preview,
    crumbs,
    preload: p.coverUrl ?? undefined,
    jsonLd: [
      {
        '@type': 'WebPage',
        '@id': siteUrl(path),
        url: siteUrl(path),
        name: p.title,
        description: descOf(p, r),
        inLanguage: 'id-ID',
        dateModified: isoDate(p.updatedAt),
        isPartOf: { '@id': siteUrl('/#website') },
        publisher: { '@id': ORG_ID() },
      },
      ...faqLd(r),
    ],
  });
}

export function renderBlogIndex(d: {
  items: SitePost[];
  page: number;
  pages: number;
  categories: Array<{ name: string; slug: string; count: number }>;
  category?: { name: string; slug: string } | null;
}): string {
  const base = d.category ? `/blog/kategori/${d.category.slug}` : '/blog';
  const path = d.page > 1 ? `${base}?halaman=${d.page}` : base;
  const crumbs: Crumb[] = [{ name: 'Beranda', path: '/' }, { name: 'Blog', path: '/blog' }, ...(d.category ? [{ name: d.category.name, path: base }] : [])];
  const h1 = d.category ? `Artikel ${d.category.name}` : 'Blog Sirko: tips mengelola warung & toko';
  const lead = d.category
    ? `Kumpulan artikel kategori ${d.category.name} untuk pemilik warung dan toko kelontong.`
    : 'Panduan praktis untuk pemilik warung dan toko kelontong: mencatat kasbon, menghitung laba, stok, sampai jualan pulsa & token listrik.';
  const chips = d.categories.length
    ? `<nav class="chips" aria-label="Kategori"><a href="/blog"${d.category ? '' : ' aria-current="page"'}>Semua</a>${d.categories
        .map((c) => `<a href="/blog/kategori/${escAttr(c.slug)}"${d.category?.slug === c.slug ? ' aria-current="page"' : ''}>${escHtml(c.name)} (${c.count})</a>`)
        .join('')}</nav>`
    : '';
  const pager =
    d.pages > 1
      ? `<nav class="pager" aria-label="Halaman">${d.page > 1 ? `<a class="btn btn-ghost" rel="prev" href="${base}${d.page - 1 > 1 ? `?halaman=${d.page - 1}` : ''}">← Sebelumnya</a>` : ''}${
          d.page < d.pages ? `<a class="btn btn-ghost" rel="next" href="${base}?halaman=${d.page + 1}">Berikutnya →</a>` : ''
        }</nav>`
      : '';
  const body = `<main id="isi"><div class="wrap" style="padding-bottom:40px">
  ${breadcrumbsHtml(crumbs)}
  <header style="margin:20px 0 0;max-width:760px"><span class="eyebrow">Blog</span><h1 style="font-size:clamp(32px,5vw,46px);font-weight:800;margin:10px 0 12px">${escHtml(h1)}</h1><p class="lead" style="margin:0">${escHtml(lead)}</p></header>
  ${chips}
  ${d.items.length ? postCards(d.items) : '<p class="lead">Belum ada artikel. Nantikan tulisan pertama kami.</p>'}
  ${pager}
</div></main>`;
  return renderPage({
    title: d.category ? `Artikel ${d.category.name} | Blog Sirko` : 'Blog Sirko — Tips Mengelola Warung & Toko Kelontong',
    description: lead.slice(0, 160),
    path,
    body,
    crumbs,
    waAsk: 'tips mengelola warung dan aplikasi kasir Sirko',
    noindex: d.items.length === 0,
    jsonLd: [
      {
        '@type': 'CollectionPage',
        '@id': siteUrl(path),
        url: siteUrl(path),
        name: h1,
        inLanguage: 'id-ID',
        isPartOf: { '@id': siteUrl('/#website') },
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: d.items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: siteUrl(pathOf(p)), name: p.title })),
        },
      },
    ],
  });
}

export function render404(gone = false): string {
  return renderPage({
    title: gone ? 'Halaman sudah dihapus | Sirko' : 'Halaman tidak ditemukan | Sirko',
    description: 'Halaman yang Anda cari tidak ada atau sudah dipindahkan.',
    path: '/404',
    noindex: true,
    body: `<main id="isi"><div class="wrap"><div class="doc" style="text-align:center;padding:80px 0">
  <span class="eyebrow">${gone ? '410' : '404'}</span>
  <h1 style="font-size:40px;margin:12px 0">${gone ? 'Halaman sudah dihapus' : 'Halaman tidak ditemukan'}</h1>
  <p class="lead">Halaman yang Anda cari tidak ada atau sudah dipindahkan.</p>
  <p style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:24px"><a class="btn btn-primary" href="/">Ke beranda</a><a class="btn btn-ghost" href="/blog">Baca blog</a></p>
</div></div></main>`,
  });
}
