import ejs from 'ejs';
import type {
  Overview,
  Page,
  CatalogItem,
  BusinessItem,
  TxItem,
} from '../services/dashboard.service.js';

/**
 * View dashboard (EJS di-embed sebagai string → aman di serverless). Terdiri
 * dari layout bersama + halaman: ringkasan, katalog (foto + paginasi + cari),
 * toko, transaksi. Self-contained (CSS inline, tanpa aset eksternal).
 */

const RP = new Intl.NumberFormat('id-ID');
const DT = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
const D = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' });

const helpers = {
  fmtRp: (v: number) => 'Rp ' + RP.format(v || 0),
  fmtDateTime: (ms: number) => (ms ? DT.format(new Date(ms)) : '—'),
  fmtDate: (ms: number) => (ms ? D.format(new Date(ms)) : '—'),
};

const CSS = `
  :root{--bg:#0f1220;--card:#1a1f36;--line:#2a3150;--tx:#e7eaf3;--mut:#9aa3c0;--acc:#6ea8fe;--ok:#3ddc97;--warn:#ffb454;--bad:#ff6b6b}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  a{color:var(--acc);text-decoration:none}
  .wrap{max-width:1140px;margin:0 auto;padding:20px 16px 64px}
  nav.top{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:22px;border-bottom:1px solid var(--line);padding-bottom:12px}
  nav.top .brand{font-weight:800;letter-spacing:-.01em;margin-right:10px}
  nav.top a.tab{color:var(--mut);padding:6px 12px;border-radius:8px;font-weight:600}
  nav.top a.tab.active{background:var(--card);color:var(--tx)}
  nav.top .spacer{flex:1}
  nav.top .st{color:var(--mut);font-size:12px}
  .badge{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:11px;color:var(--mut)}
  h1{font-size:19px;margin:0 0 16px}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:22px 0 10px;font-weight:700}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}
  .kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .kpi .n{font-size:24px;font-weight:800;letter-spacing:-.02em}
  .kpi .l{color:var(--mut);font-size:12px;margin-top:2px}
  .cats{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}
  .cat{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px}
  .cat .bar{flex:1;height:6px;background:#101534;border-radius:999px;overflow:hidden}
  .cat .bar > i{display:block;height:100%;background:var(--acc)}
  .cat .nm{min-width:130px;font-size:13px}
  .cat .ct{color:var(--mut);font-size:12px;font-variant-numeric:tabular-nums}
  .quick{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
  .quick a{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;display:block}
  .quick a .big{font-size:20px;font-weight:800}
  .quick a .arw{color:var(--mut);font-size:12px;margin-top:4px}
  .strip{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px}
  .strip .p{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;text-align:center}
  .strip .p img{width:100%;height:80px;object-fit:contain;background:#fff}
  .strip .p .cap{font-size:11px;color:var(--mut);padding:4px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  form.search{display:flex;gap:8px;margin:4px 0 14px}
  form.search input{flex:1;max-width:360px;background:var(--card);border:1px solid var(--line);color:var(--tx);border-radius:8px;padding:8px 12px;font-size:14px}
  form.search button{background:var(--acc);color:#08122b;border:0;border-radius:8px;padding:8px 16px;font-weight:700;cursor:pointer}
  .tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;min-width:640px}
  th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);vertical-align:middle}
  th{color:var(--mut);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
  tr:last-child td{border-bottom:none}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  .mut{color:var(--mut)}
  code{color:var(--acc);font-size:12px}
  .thumb{width:44px;height:44px;border-radius:8px;object-fit:contain;background:#fff;border:1px solid var(--line)}
  .thumb.ph{display:flex;align-items:center;justify-content:center;color:var(--mut);font-size:10px;background:#101534}
  .pill{font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid var(--line)}
  .pill.ok{color:var(--ok);border-color:#1f5a44}.pill.warn{color:var(--warn);border-color:#5a4620}.pill.bad{color:var(--bad);border-color:#5a2626}
  .empty{padding:18px 14px;color:var(--mut)}
  .pager{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:14px}
  .pager a,.pager span{padding:6px 11px;border-radius:8px;border:1px solid var(--line);font-size:13px;font-variant-numeric:tabular-nums}
  .pager a{background:var(--card);color:var(--tx)}
  .pager .cur{background:var(--acc);color:#08122b;border-color:var(--acc);font-weight:700}
  .pager .dis{color:var(--mut);opacity:.5}
  .pager .info{border:0;color:var(--mut);margin-left:auto}
`;

const LAYOUT = `<!doctype html><html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title><%= title %> · Sirko Admin</title><style><%- css %></style></head>
<body><div class="wrap">
  <nav class="top">
    <span class="brand">Sirko Admin</span>
    <a class="tab <%= active==='overview'?'active':'' %>" href="/dashboard">Ringkasan</a>
    <a class="tab <%= active==='catalog'?'active':'' %>" href="/dashboard/catalog">Katalog</a>
    <a class="tab <%= active==='businesses'?'active':'' %>" href="/dashboard/businesses">Toko</a>
    <a class="tab <%= active==='transactions'?'active':'' %>" href="/dashboard/transactions">Transaksi</a>
    <span class="spacer"></span>
    <span class="badge">lintas-tenant</span>
    <span class="st"><%= fmtDateTime(serverTime) %> WIB</span>
  </nav>
  <%- body %>
</div></body></html>`;

function renderLayout(opts: { title: string; active: string; body: string; serverTime: number }): string {
  return ejs.render(LAYOUT, { ...opts, css: CSS, ...helpers });
}

/** Bangun HTML paginasi (jendela ±2 + ujung). mkUrl(p) → URL halaman p. */
function pagerHtml(page: number, pages: number, total: number, mkUrl: (p: number) => string): string {
  if (pages <= 1) return `<div class="pager"><span class="info">${total} data</span></div>`;
  const parts: string[] = [];
  const prev = page > 1 ? `<a href="${mkUrl(page - 1)}">‹ Sebelumnya</a>` : `<span class="dis">‹ Sebelumnya</span>`;
  const next = page < pages ? `<a href="${mkUrl(page + 1)}">Berikutnya ›</a>` : `<span class="dis">Berikutnya ›</span>`;
  parts.push(prev);
  const win = new Set<number>([1, pages, page, page - 1, page + 1, page - 2, page + 2]);
  const nums = [...win].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  let last = 0;
  for (const p of nums) {
    if (p - last > 1) parts.push(`<span class="dis">…</span>`);
    parts.push(p === page ? `<span class="cur">${p}</span>` : `<a href="${mkUrl(p)}">${p}</a>`);
    last = p;
  }
  parts.push(next);
  parts.push(`<span class="info">hal. ${page}/${pages} · ${total} data</span>`);
  return `<div class="pager">${parts.join('')}</div>`;
}

// ── Ringkasan ─────────────────────────────────────────────────────────────────

const OVERVIEW_TPL = `
<h1>Ringkasan</h1>
<div class="grid">
  <div class="kpi"><div class="n"><%= d.counts.businesses %></div><div class="l">Toko</div></div>
  <div class="kpi"><div class="n"><%= d.counts.accounts %></div><div class="l">Akun</div></div>
  <div class="kpi"><div class="n"><%= d.counts.users %></div><div class="l">User/Staff</div></div>
  <div class="kpi"><div class="n"><%= d.counts.transactions %></div><div class="l">Transaksi</div></div>
  <div class="kpi"><div class="n"><%= d.counts.products %></div><div class="l">Produk Toko</div></div>
  <div class="kpi"><div class="n"><%= d.counts.customers %></div><div class="l">Pelanggan</div></div>
  <div class="kpi"><div class="n"><%= d.counts.catalog %></div><div class="l">Katalog Umum</div></div>
</div>

<h2>Lihat data lengkap</h2>
<div class="quick">
  <a href="/dashboard/catalog"><div class="big"><%= d.counts.catalog %></div><div>Katalog Produk Umum</div><div class="arw">Buka daftar + cari →</div></a>
  <a href="/dashboard/businesses"><div class="big"><%= d.counts.businesses %></div><div>Toko Terdaftar</div><div class="arw">Buka daftar →</div></a>
  <a href="/dashboard/transactions"><div class="big"><%= d.counts.transactions %></div><div>Transaksi</div><div class="arw">Buka daftar →</div></a>
</div>

<% if (d.categories.length) { %>
<h2>Kategori Katalog</h2>
<div class="cats">
  <% const max = d.categories[0].n || 1; d.categories.forEach(function(c){ %>
    <div class="cat">
      <span class="nm"><%= c.category %></span>
      <span class="bar"><i style="width:<%= Math.max(4, Math.round(100*c.n/max)) %>%"></i></span>
      <span class="ct"><%= c.n %></span>
    </div>
  <% }) %>
</div>
<% } %>

<% if (d.recentCatalog.length) { %>
<h2>Katalog terbaru</h2>
<div class="strip">
  <% d.recentCatalog.forEach(function(p){ %>
    <a class="p" href="/dashboard/catalog?q=<%= encodeURIComponent(p.name || '') %>">
      <img src="<%= p.photoUrl %>" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="cap"><%= p.name || '—' %></div>
    </a>
  <% }) %>
</div>
<% } %>
`;

export function renderOverview(d: Overview): string {
  const body = ejs.render(OVERVIEW_TPL, { d, ...helpers });
  return renderLayout({ title: 'Ringkasan', active: 'overview', body, serverTime: d.serverTime });
}

// ── Katalog (foto + paginasi + cari) ─────────────────────────────────────────

const CATALOG_TPL = `
<h1>Katalog Produk Umum</h1>
<form class="search" method="get" action="/dashboard/catalog">
  <input type="text" name="q" value="<%= pg.q %>" placeholder="Cari nama / brand / barcode…">
  <button type="submit">Cari</button>
</form>
<div class="tablewrap">
  <% if (pg.items.length === 0) { %>
    <div class="empty">Tidak ada produk<%= pg.q ? ' untuk "'+pg.q+'"' : '' %>.</div>
  <% } else { %>
  <table>
    <thead><tr><th>Foto</th><th>Nama</th><th>Brand</th><th>Kategori</th><th>Ukuran</th><th>Verified</th><th>Sumber</th></tr></thead>
    <tbody>
    <% pg.items.forEach(function(it){ %>
      <tr>
        <td><% if (it.photoUrl) { %><img class="thumb" src="<%= it.photoUrl %>" alt="" loading="lazy" onerror="this.style.display='none'"><% } else { %><div class="thumb ph">?</div><% } %></td>
        <td><%= it.name || '—' %><br><span class="mut" style="font-size:11px"><code><%= it.barcode || '—' %></code></span></td>
        <td class="mut"><%= it.brand || '—' %></td>
        <td><%= it.category || '—' %></td>
        <td class="mut"><%= it.netSize ? (it.netSize + ' ' + (it.netUnit||'')) : '—' %></td>
        <td><span class="pill <%= it.verified?'ok':'warn' %>"><%= it.verified?'ya':'belum' %></span></td>
        <td class="mut"><%= it.source %></td>
      </tr>
    <% }) %>
    </tbody>
  </table>
  <% } %>
</div>
<%- pager %>
`;

export function renderCatalog(pg: Page<CatalogItem>): string {
  const mkUrl = (p: number) => `/dashboard/catalog?page=${p}` + (pg.q ? `&q=${encodeURIComponent(pg.q)}` : '');
  const pager = pagerHtml(pg.page, pg.pages, pg.total, mkUrl);
  const body = ejs.render(CATALOG_TPL, { pg, pager, ...helpers });
  return renderLayout({ title: 'Katalog', active: 'catalog', body, serverTime: pg.serverTime });
}

// ── Toko ──────────────────────────────────────────────────────────────────────

const BUSINESSES_TPL = `
<h1>Toko Terdaftar</h1>
<div class="tablewrap">
  <% if (pg.items.length === 0) { %>
    <div class="empty">Belum ada toko terdaftar.</div>
  <% } else { %>
  <table>
    <thead><tr><th>Nama</th><th>Jenis</th><th class="num">User</th><th class="num">Produk</th><th class="num">Transaksi</th><th>Dibuat</th><th>Backup terakhir</th></tr></thead>
    <tbody>
    <% pg.items.forEach(function(b){ %>
      <tr>
        <td><%= b.name %><br><span class="mut" style="font-size:11px"><code><%= b.id.slice(0,8) %></code></span></td>
        <td class="mut"><%= b.businessType || '—' %></td>
        <td class="num"><%= b.users %></td>
        <td class="num"><%= b.products %></td>
        <td class="num"><%= b.transactions %></td>
        <td class="mut"><%= fmtDate(b.createdAt) %></td>
        <td class="mut"><%= b.lastBackupAt ? fmtDateTime(b.lastBackupAt) : '—' %></td>
      </tr>
    <% }) %>
    </tbody>
  </table>
  <% } %>
</div>
<%- pager %>
`;

export function renderBusinesses(pg: Page<BusinessItem>): string {
  const mkUrl = (p: number) => `/dashboard/businesses?page=${p}`;
  const pager = pagerHtml(pg.page, pg.pages, pg.total, mkUrl);
  const body = ejs.render(BUSINESSES_TPL, { pg, pager, ...helpers });
  return renderLayout({ title: 'Toko', active: 'businesses', body, serverTime: pg.serverTime });
}

// ── Transaksi ─────────────────────────────────────────────────────────────────

const TRANSACTIONS_TPL = `
<h1>Transaksi</h1>
<div class="tablewrap">
  <% if (pg.items.length === 0) { %>
    <div class="empty">Belum ada transaksi.</div>
  <% } else { %>
  <table>
    <thead><tr><th>Invoice</th><th>Toko</th><th class="num">Total</th><th>Status</th><th>Waktu</th></tr></thead>
    <tbody>
    <% pg.items.forEach(function(t){ %>
      <tr>
        <td><code><%= t.invoiceNo || t.id.slice(0,8) %></code></td>
        <td><%= t.businessName || '—' %></td>
        <td class="num"><%= fmtRp(t.grandTotal) %></td>
        <td><span class="pill <%= t.status==='paid'?'ok':(t.status==='void'?'bad':'warn') %>"><%= t.status || '—' %></span></td>
        <td class="mut"><%= t.datetime ? fmtDateTime(t.datetime) : '—' %></td>
      </tr>
    <% }) %>
    </tbody>
  </table>
  <% } %>
</div>
<%- pager %>
`;

export function renderTransactions(pg: Page<TxItem>): string {
  const mkUrl = (p: number) => `/dashboard/transactions?page=${p}`;
  const pager = pagerHtml(pg.page, pg.pages, pg.total, mkUrl);
  const body = ejs.render(TRANSACTIONS_TPL, { pg, pager, ...helpers });
  return renderLayout({ title: 'Transaksi', active: 'transactions', body, serverTime: pg.serverTime });
}
