import ejs from 'ejs';
import type { DashboardData } from '../services/dashboard.service.ts';

/**
 * Template EJS di-embed sebagai STRING (bukan file .ejs di disk) agar ikut
 * ter-bundle & andal di serverless Vercel. Self-contained (CSS inline, tanpa
 * aset eksternal) → aman CSP & jalan offline.
 */
const TEMPLATE = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sirko — Admin Dashboard</title>
<style>
  :root{--bg:#0f1220;--card:#1a1f36;--line:#2a3150;--tx:#e7eaf3;--mut:#9aa3c0;--acc:#6ea8fe;--ok:#3ddc97;--warn:#ffb454;--bad:#ff6b6b}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .wrap{max-width:1100px;margin:0 auto;padding:24px 16px 64px}
  header{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 16px;margin-bottom:20px}
  h1{font-size:20px;margin:0;letter-spacing:-.01em}
  .sub{color:var(--mut);font-size:12px}
  .badge{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:11px;color:var(--mut)}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:28px}
  .kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .kpi .n{font-size:26px;font-weight:700;letter-spacing:-.02em}
  .kpi .l{color:var(--mut);font-size:12px;margin-top:2px}
  section{margin-bottom:32px}
  h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:0 0 10px;font-weight:600}
  .tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;min-width:560px}
  th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
  th{color:var(--mut);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  tr:last-child td{border-bottom:none}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  .mut{color:var(--mut)}
  .pill{font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid var(--line)}
  .pill.ok{color:var(--ok);border-color:#1f5a44}
  .pill.warn{color:var(--warn);border-color:#5a4620}
  .pill.bad{color:var(--bad);border-color:#5a2626}
  .empty{padding:18px 14px;color:var(--mut)}
  code{color:var(--acc);font-size:12px}
  footer{color:var(--mut);font-size:12px;margin-top:24px}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Sirko — Admin Dashboard</h1>
    <span class="badge">lintas-tenant</span>
    <span class="sub">server: <%= fmtDateTime(data.serverTime) %> WIB</span>
  </header>

  <div class="grid">
    <div class="kpi"><div class="n"><%= data.counts.businesses %></div><div class="l">Toko</div></div>
    <div class="kpi"><div class="n"><%= data.counts.accounts %></div><div class="l">Akun</div></div>
    <div class="kpi"><div class="n"><%= data.counts.users %></div><div class="l">User/Staff</div></div>
    <div class="kpi"><div class="n"><%= data.counts.transactions %></div><div class="l">Transaksi</div></div>
    <div class="kpi"><div class="n"><%= data.counts.products %></div><div class="l">Produk Toko</div></div>
    <div class="kpi"><div class="n"><%= data.counts.customers %></div><div class="l">Pelanggan</div></div>
    <div class="kpi"><div class="n"><%= data.counts.catalog %></div><div class="l">Katalog Umum</div></div>
  </div>

  <section>
    <h2>Toko (<%= data.businesses.length %>)</h2>
    <div class="tablewrap">
      <% if (data.businesses.length === 0) { %>
        <div class="empty">Belum ada toko terdaftar.</div>
      <% } else { %>
      <table>
        <thead><tr>
          <th>Nama</th><th>Jenis</th><th class="num">User</th><th class="num">Produk</th>
          <th class="num">Transaksi</th><th>Dibuat</th><th>Backup terakhir</th>
        </tr></thead>
        <tbody>
        <% data.businesses.forEach(function(b){ %>
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
  </section>

  <section>
    <h2>Transaksi terbaru</h2>
    <div class="tablewrap">
      <% if (data.recentTransactions.length === 0) { %>
        <div class="empty">Belum ada transaksi.</div>
      <% } else { %>
      <table>
        <thead><tr><th>Invoice</th><th>Toko</th><th class="num">Total</th><th>Status</th><th>Waktu</th></tr></thead>
        <tbody>
        <% data.recentTransactions.forEach(function(t){ %>
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
  </section>

  <section>
    <h2>Katalog Produk Umum (<%= data.counts.catalog %>) — 20 terbaru</h2>
    <div class="tablewrap">
      <% if (data.catalog.length === 0) { %>
        <div class="empty">Belum ada produk katalog.</div>
      <% } else { %>
      <table>
        <thead><tr><th>Nama</th><th>Barcode</th><th>Brand</th><th>Kategori</th><th>Verified</th><th>Sumber</th><th>Update</th></tr></thead>
        <tbody>
        <% data.catalog.forEach(function(c){ %>
          <tr>
            <td><%= c.name || '—' %></td>
            <td><code><%= c.barcode || '—' %></code></td>
            <td class="mut"><%= c.brand || '—' %></td>
            <td class="mut"><%= c.category || '—' %></td>
            <td><span class="pill <%= c.verified?'ok':'warn' %>"><%= c.verified?'ya':'belum' %></span></td>
            <td class="mut"><%= c.source %></td>
            <td class="mut"><%= fmtDate(c.updatedAt) %></td>
          </tr>
        <% }) %>
        </tbody>
      </table>
      <% } %>
    </div>
  </section>

  <footer>Sirko backend · data langsung dari PostgreSQL · <%= fmtDateTime(data.serverTime) %> WIB</footer>
</div>
</body>
</html>`;

const RP = new Intl.NumberFormat('id-ID');
const DT = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jakarta',
});
const D = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' });

const helpers = {
  fmtRp: (n: number) => 'Rp ' + RP.format(n || 0),
  fmtDateTime: (ms: number) => (ms ? DT.format(new Date(ms)) : '—'),
  fmtDate: (ms: number) => (ms ? D.format(new Date(ms)) : '—'),
};

/** Render halaman dashboard → HTML string. */
export function renderDashboard(data: DashboardData): string {
  return ejs.render(TEMPLATE, { data, ...helpers });
}
