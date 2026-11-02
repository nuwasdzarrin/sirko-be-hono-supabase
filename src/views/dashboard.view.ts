import ejs from 'ejs';
import type {
  Overview,
  Page,
  CatalogPage,
  CatalogFilters,
  BusinessItem,
  TxItem,
  ContribPage,
} from '../services/dashboard.service.js';
import { UNCATEGORIZED } from '../services/dashboard.service.js';

/**
 * View dashboard (EJS di-embed sebagai string → aman di serverless). Terdiri
 * dari layout bersama + halaman: login, ringkasan, katalog (foto + filter + cari
 * + scan), kontribusi, toko, transaksi. CSS inline; tema terang/gelap via token
 * (ikut sistem, bisa di-toggle & diingat di localStorage). Aset eksternal hanya
 * library scanner (dimuat malas saat tombol scan diklik).
 */

const RP = new Intl.NumberFormat('id-ID');
const DT = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
const D = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' });

const helpers = {
  fmtRp: (v: number) => 'Rp ' + RP.format(v || 0),
  fmtDateTime: (ms: number) => (ms ? DT.format(new Date(ms)) : '—'),
  fmtDate: (ms: number) => (ms ? D.format(new Date(ms)) : '—'),
  fmtNum: (v: number) => RP.format(v || 0),
};

const SCANNER_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';

const DARK_TOKENS = `--bg:#0f1220;--card:#1a1f36;--sunk:#121731;--line:#2a3150;--tx:#e7eaf3;--mut:#9aa3c0;
  --acc:#6ea8fe;--acc-tx:#08122b;--acc-soft:rgba(110,168,254,.14);--ok:#3ddc97;--ok-line:#1f5a44;
  --warn:#ffb454;--warn-line:#5a4620;--bad:#ff6b6b;--bad-line:#5a2626;--shadow:0 10px 30px rgba(0,0,0,.35);color-scheme:dark`;

const CSS = `
  :root{--bg:#f5f6fa;--card:#ffffff;--sunk:#eef1f7;--line:#e2e6ef;--tx:#151a2d;--mut:#5f6784;
    --acc:#2f6fed;--acc-tx:#ffffff;--acc-soft:rgba(47,111,237,.10);--ok:#138a5b;--ok-line:#b7e4cf;
    --warn:#b26a00;--warn-line:#f1d9ae;--bad:#d03b3b;--bad-line:#f1c0c0;--shadow:0 10px 30px rgba(20,30,60,.08);color-scheme:light}
  @media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${DARK_TOKENS}}}
  :root[data-theme="dark"]{${DARK_TOKENS}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  a{color:var(--acc);text-decoration:none}
  .wrap{max-width:1140px;margin:0 auto;padding:20px 16px 64px}
  nav.top{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:22px;border-bottom:1px solid var(--line);padding-bottom:12px}
  nav.top .brand{font-weight:800;letter-spacing:-.01em;margin-right:10px;display:flex;align-items:center;gap:8px;color:var(--tx)}
  .logo{width:26px;height:26px;border-radius:8px;background:var(--acc);color:var(--acc-tx);display:inline-flex;align-items:center;justify-content:center;font-weight:900;font-size:14px}
  nav.top a.tab{color:var(--mut);padding:6px 12px;border-radius:8px;font-weight:600}
  nav.top a.tab:hover{color:var(--tx)}
  nav.top a.tab.active{background:var(--card);color:var(--tx);box-shadow:inset 0 0 0 1px var(--line)}
  nav.top .spacer{flex:1}
  nav.top .st{color:var(--mut);font-size:12px}
  .icon-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;min-width:32px;padding:0 9px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--tx);cursor:pointer;font:inherit;font-size:13px}
  .icon-btn:hover{border-color:var(--acc)}
  .icon-btn svg{width:16px;height:16px}
  .theme-ico-dark{display:none}
  :root[data-theme="dark"] .theme-ico-dark{display:inline}:root[data-theme="dark"] .theme-ico-light{display:none}
  @media (prefers-color-scheme: dark){:root:not([data-theme]) .theme-ico-dark{display:inline}:root:not([data-theme]) .theme-ico-light{display:none}}
  form.inline-logout{display:inline}
  .badge{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:11px;color:var(--mut)}
  h1{font-size:19px;margin:0 0 16px}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:22px 0 10px;font-weight:700}
  .h2row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:22px 0 10px}
  .h2row h2{margin:0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}
  .kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .kpi .n{font-size:24px;font-weight:800;letter-spacing:-.02em}
  .kpi .l{color:var(--mut);font-size:12px;margin-top:2px}
  .cats{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}
  a.cat{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px;color:var(--tx);transition:border-color .15s,transform .15s}
  a.cat:hover{border-color:var(--acc);transform:translateY(-1px)}
  .cat .bar{flex:1;height:6px;background:var(--sunk);border-radius:999px;overflow:hidden}
  .cat .bar > i{display:block;height:100%;background:var(--acc)}
  .cat .nm{min-width:110px;font-size:13px}
  .cat .ct{color:var(--mut);font-size:12px;font-variant-numeric:tabular-nums}
  .cat .go{color:var(--mut);font-size:12px}
  .quick{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
  .quick a{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;display:block}
  .quick a:hover{border-color:var(--acc)}
  .quick a .big{font-size:20px;font-weight:800}
  .quick a .arw{color:var(--mut);font-size:12px;margin-top:4px}
  .strip{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px}
  .strip .p{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;text-align:center;color:var(--tx)}
  .strip .p:hover{border-color:var(--acc)}
  .strip .p img{width:100%;height:84px;object-fit:contain;background:#fff;display:block}
  .strip .p .cap{font-size:11px;color:var(--mut);padding:4px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .btn-link{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--tx);font-weight:600;font-size:13px}
  .btn-link:hover{border-color:var(--acc);color:var(--acc)}
  .btn-link.primary{background:var(--acc);border-color:var(--acc);color:var(--acc-tx)}
  form.search{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 12px}
  .search-box{flex:1 1 280px;max-width:460px;display:flex;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:8px;padding-left:10px}
  .search-box:focus-within{border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-soft)}
  .search-box svg{width:16px;height:16px;color:var(--mut);flex:0 0 auto}
  .search-box input{flex:1;min-width:0;background:transparent;border:0;outline:0;color:var(--tx);padding:9px 10px;font-size:14px}
  .btn{border:0;border-radius:8px;padding:8px 16px;font-weight:700;cursor:pointer;font-size:13px;font-family:inherit;display:inline-flex;align-items:center;gap:6px}
  .btn svg{width:16px;height:16px}
  .btn.primary{background:var(--acc);color:var(--acc-tx)}
  .btn.ghost{background:var(--card);color:var(--tx);border:1px solid var(--line)}
  .btn.ghost:hover{border-color:var(--acc)}
  .btn.ok{background:var(--ok);color:#fff}
  .btn.bad{background:var(--bad);color:#fff}
  .filters{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin-bottom:14px}
  .frow{display:flex;gap:12px;align-items:flex-start;padding:6px 0}
  .frow + .frow{border-top:1px dashed var(--line)}
  .flabel{flex:0 0 72px;color:var(--mut);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding-top:5px}
  .chips{display:flex;flex-wrap:wrap;gap:6px;flex:1;min-width:0}
  a.chip{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:999px;border:1px solid var(--line);color:var(--tx);font-size:13px;background:var(--bg)}
  a.chip:hover{border-color:var(--acc)}
  a.chip .c{color:var(--mut);font-size:11px;font-variant-numeric:tabular-nums}
  a.chip.on{background:var(--acc);border-color:var(--acc);color:var(--acc-tx)}
  a.chip.on .c{color:var(--acc-tx);opacity:.8}
  .active-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:-4px 0 12px;font-size:13px;color:var(--mut)}
  .active-filters a{font-weight:600}
  .tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;min-width:640px}
  th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);vertical-align:middle}
  th{color:var(--mut);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
  tr:last-child td{border-bottom:none}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  td a.catlink{color:var(--tx)}
  td a.catlink:hover{color:var(--acc)}
  .mut{color:var(--mut)}
  code{color:var(--acc);font-size:12px}
  .thumb{width:44px;height:44px;border-radius:8px;object-fit:contain;background:#fff;border:1px solid var(--line)}
  .thumb.ph{display:flex;align-items:center;justify-content:center;color:var(--mut);font-size:10px;background:var(--sunk)}
  .pill{font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid var(--line);white-space:nowrap}
  .pill.ok{color:var(--ok);border-color:var(--ok-line)}.pill.warn{color:var(--warn);border-color:var(--warn-line)}.pill.bad{color:var(--bad);border-color:var(--bad-line)}
  .empty{padding:18px 14px;color:var(--mut)}
  .pager{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:14px}
  .pager a,.pager span{padding:6px 11px;border-radius:8px;border:1px solid var(--line);font-size:13px;font-variant-numeric:tabular-nums}
  .pager a{background:var(--card);color:var(--tx)}
  .pager .cur{background:var(--acc);color:var(--acc-tx);border-color:var(--acc);font-weight:700}
  .pager .dis{color:var(--mut);opacity:.5}
  .pager .info{border:0;color:var(--mut);margin-left:auto}
  nav.top a.tab .nb{background:var(--warn);color:#fff;border-radius:999px;padding:0 6px;font-size:11px;font-weight:800;margin-left:4px}
  .subnav{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}
  .subnav a{padding:5px 12px;border-radius:999px;border:1px solid var(--line);color:var(--mut);font-size:13px}
  .subnav a.on{background:var(--card);color:var(--tx);border-color:var(--acc)}
  .clist{display:grid;grid-template-columns:1fr;gap:12px}
  .cc{display:flex;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
  .cc .ph{width:96px;height:96px;flex:0 0 96px;border-radius:10px;object-fit:contain;background:#fff;border:1px solid var(--line)}
  .cc .ph.none{display:flex;align-items:center;justify-content:center;color:var(--mut);background:var(--sunk);font-size:11px}
  .cc .body{flex:1;min-width:0}
  .cc .nm{font-weight:700;font-size:15px}
  .cc .meta{color:var(--mut);font-size:12px;margin-top:2px}
  .cc .kv{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:8px;font-size:13px}
  .cc .kv b{color:var(--mut);font-weight:600}
  .cc .note{margin-top:8px;font-size:13px;background:var(--sunk);border:1px solid var(--line);border-radius:8px;padding:6px 10px;color:var(--tx)}
  .cc .acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;align-items:center}
  .cc .acts input[type=text]{flex:1;min-width:160px;background:var(--sunk);border:1px solid var(--line);color:var(--tx);border-radius:8px;padding:7px 10px;font-size:13px}
  form.inline{display:contents}
  dialog.scan{border:1px solid var(--line);border-radius:16px;background:var(--card);color:var(--tx);padding:0;width:min(440px,calc(100vw - 32px));box-shadow:var(--shadow)}
  dialog.scan::backdrop{background:rgba(5,8,20,.6)}
  .scan-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--line)}
  .scan-hd b{font-size:15px}
  .scan-bd{padding:14px 16px}
  #scan-reader{width:100%;min-height:220px;display:block;border-radius:10px;overflow:hidden;background:#000}
  #scan-reader video{width:100%!important;display:block}
  .scan-msg{font-size:13px;color:var(--mut);margin:10px 0 0;min-height:20px}
  .scan-msg.err{color:var(--bad)}
  #scan-reader.off{display:none}
  .scan-ft{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;padding:0 16px 16px}
  .scan-ft label{cursor:pointer}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  @media (max-width:640px){
    .frow{flex-direction:column;gap:6px}
    .flabel{flex:none;padding:0}
    nav.top .st,nav.top .badge{display:none}
    nav.top .icon-btn span{display:none}
  }
`;

/** Pasang tema tersimpan SEBELUM render (cegah kedip). */
const THEME_BOOT = `(function(){try{var t=localStorage.getItem('sirko-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}})();`;

const THEME_TOGGLE_JS = `
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-theme-toggle]'); if(!b) return;
  var root=document.documentElement, cur=root.getAttribute('data-theme');
  if(!cur){cur=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}
  var nx=cur==='dark'?'light':'dark'; root.setAttribute('data-theme',nx);
  try{localStorage.setItem('sirko-theme',nx)}catch(e){}
});`;

const ICONS = {
  sun: `<svg class="theme-ico-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  moon: `<svg class="theme-ico-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
  scan: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10 8v8M13 8v8M17 8v8"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
};

const THEME_BTN = `<button type="button" class="icon-btn" data-theme-toggle title="Ganti tema terang/gelap" aria-label="Ganti tema terang/gelap">${ICONS.sun}${ICONS.moon}</button>`;

const LAYOUT = `<!doctype html><html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title><%= title %> · Sirko Admin</title>
<script><%- themeBoot %></script>
<style><%- css %></style></head>
<body><div class="wrap">
  <nav class="top">
    <a class="brand" href="/dashboard"><span class="logo">S</span>Sirko Admin</a>
    <a class="tab <%= active==='overview'?'active':'' %>" href="/dashboard">Ringkasan</a>
    <a class="tab <%= active==='catalog'?'active':'' %>" href="/dashboard/catalog">Katalog</a>
    <a class="tab <%= active==='contributions'?'active':'' %>" href="/dashboard/contributions">Kontribusi<% if (pendingContrib>0){ %> <span class="nb"><%= pendingContrib %></span><% } %></a>
    <a class="tab <%= active==='businesses'?'active':'' %>" href="/dashboard/businesses">Toko</a>
    <a class="tab <%= active==='transactions'?'active':'' %>" href="/dashboard/transactions">Transaksi</a>
    <span class="spacer"></span>
    <span class="badge">lintas-tenant</span>
    <span class="st"><%= fmtDateTime(serverTime) %> WIB</span>
    <%- themeBtn %>
    <form class="inline-logout" method="post" action="/dashboard/logout">
      <button class="icon-btn" type="submit" title="Keluar" aria-label="Keluar"><%- icons.logout %><span>Keluar</span></button>
    </form>
  </nav>
  <%- body %>
</div>
<script><%- themeJs %></script>
<%- extraJs %>
</body></html>`;

function renderLayout(opts: {
  title: string;
  active: string;
  body: string;
  serverTime: number;
  pendingContrib?: number;
  extraJs?: string;
}): string {
  return ejs.render(LAYOUT, {
    pendingContrib: 0,
    extraJs: '',
    ...opts,
    css: CSS,
    themeBoot: THEME_BOOT,
    themeJs: THEME_TOGGLE_JS,
    themeBtn: THEME_BTN,
    icons: ICONS,
    ...helpers,
  });
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

// ── Login ─────────────────────────────────────────────────────────────────────

const LOGIN_CSS = `
  body{min-height:100vh;display:flex;flex-direction:column}
  .login-top{display:flex;justify-content:flex-end;padding:16px}
  .login-main{flex:1;display:flex;align-items:center;justify-content:center;padding:16px 16px 64px}
  .login-card{width:100%;max-width:380px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px 24px;box-shadow:var(--shadow)}
  .login-brand{display:flex;align-items:center;gap:10px;margin-bottom:18px}
  .login-brand .logo{width:38px;height:38px;border-radius:11px;font-size:19px}
  .login-brand b{font-size:17px;display:block}
  .login-brand div span{font-size:12px;color:var(--mut)}
  .login-card h1{font-size:20px;margin:0 0 4px}
  .login-card p.sub{margin:0 0 20px;color:var(--mut);font-size:13px}
  .field{margin-bottom:14px}
  .field label{display:block;font-size:12px;font-weight:700;margin-bottom:6px}
  .input{display:flex;align-items:center;background:var(--bg);border:1px solid var(--line);border-radius:10px}
  .input:focus-within{border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-soft)}
  .input input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--tx);padding:11px 12px;font-size:14px;font-family:inherit}
  .input button{border:0;background:transparent;color:var(--mut);padding:0 10px;cursor:pointer;display:flex;align-items:center}
  .input button svg{width:18px;height:18px}
  .row{display:flex;align-items:center;justify-content:space-between;margin:4px 0 18px;font-size:13px}
  .row label{display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--mut)}
  .row input{accent-color:var(--acc);width:16px;height:16px}
  .submit{width:100%;justify-content:center;padding:11px 16px;font-size:14px;border-radius:10px}
  .submit[disabled]{opacity:.7;cursor:progress}
  .alert{display:flex;gap:8px;align-items:flex-start;background:var(--sunk);border:1px solid var(--bad-line);color:var(--bad);border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:16px}
  .login-foot{margin-top:18px;text-align:center;font-size:12px;color:var(--mut)}
`;

const LOGIN_TPL = `<!doctype html><html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Masuk · Sirko Admin</title>
<script><%- themeBoot %></script>
<style><%- css %><%- loginCss %></style></head>
<body>
  <div class="login-top"><%- themeBtn %></div>
  <main class="login-main">
    <div class="login-card">
      <div class="login-brand"><span class="logo">S</span><div><b>Sirko Admin</b><span>Panel pengelola Sirko</span></div></div>
      <h1>Masuk</h1>
      <p class="sub">Gunakan akun admin untuk mengelola katalog &amp; memantau toko.</p>
      <% if (error) { %><div class="alert" role="alert"><span>⚠</span><span><%= error %></span></div><% } %>
      <form method="post" action="/dashboard/login" id="login-form">
        <input type="hidden" name="next" value="<%= next %>">
        <div class="field">
          <label for="user">Username</label>
          <div class="input"><input id="user" name="user" type="text" autocomplete="username" required value="<%= user %>" <%= user ? '' : 'autofocus' %>></div>
        </div>
        <div class="field">
          <label for="password">Password</label>
          <div class="input">
            <input id="password" name="password" type="password" autocomplete="current-password" required <%= user ? 'autofocus' : '' %>>
            <button type="button" id="toggle-pw" aria-label="Tampilkan password" title="Tampilkan password"><%- icons.eye %></button>
          </div>
        </div>
        <div class="row"><label><input type="checkbox" name="remember"> Ingat saya 30 hari</label></div>
        <button class="btn primary submit" type="submit">Masuk</button>
      </form>
      <div class="login-foot">Sirko · Kasir Warung</div>
    </div>
  </main>
<script><%- themeJs %>
document.getElementById('toggle-pw').addEventListener('click',function(){
  var i=document.getElementById('password'), show=i.type==='password'; i.type=show?'text':'password';
  this.setAttribute('aria-label', show?'Sembunyikan password':'Tampilkan password');
});
document.getElementById('login-form').addEventListener('submit',function(){
  var b=this.querySelector('.submit'); b.disabled=true; b.textContent='Memeriksa…';
});
</script>
</body></html>`;

export function renderLogin(opts: { next: string; error: string | null; user: string }): string {
  return ejs.render(LOGIN_TPL, {
    ...opts,
    css: CSS,
    loginCss: LOGIN_CSS,
    themeBoot: THEME_BOOT,
    themeJs: THEME_TOGGLE_JS,
    themeBtn: THEME_BTN,
    icons: ICONS,
  });
}

// ── URL katalog ber-filter ───────────────────────────────────────────────────

/** URL /dashboard/catalog dengan filter (param kosong dibuang). Ganti filter → page reset. */
export function catalogUrl(f: Partial<CatalogFilters>, page?: number): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.category) p.set('category', f.category);
  if (f.source) p.set('source', f.source);
  if (f.verified !== undefined) p.set('verified', f.verified ? '1' : '0');
  if (page && page > 1) p.set('page', String(page));
  const qs = p.toString();
  return '/dashboard/catalog' + (qs ? `?${qs}` : '');
}

// ── Ringkasan ─────────────────────────────────────────────────────────────────

const OVERVIEW_TPL = `
<h1>Ringkasan</h1>
<div class="grid">
  <div class="kpi"><div class="n"><%= fmtNum(d.counts.businesses) %></div><div class="l">Toko</div></div>
  <div class="kpi"><div class="n"><%= fmtNum(d.counts.accounts) %></div><div class="l">Akun</div></div>
  <div class="kpi"><div class="n"><%= fmtNum(d.counts.users) %></div><div class="l">User/Staff</div></div>
  <div class="kpi"><div class="n"><%= fmtNum(d.counts.transactions) %></div><div class="l">Transaksi</div></div>
  <div class="kpi"><div class="n"><%= fmtNum(d.counts.products) %></div><div class="l">Produk Toko</div></div>
  <div class="kpi"><div class="n"><%= fmtNum(d.counts.customers) %></div><div class="l">Pelanggan</div></div>
  <div class="kpi"><div class="n"><%= fmtNum(d.counts.catalog) %></div><div class="l">Katalog Umum</div></div>
</div>

<h2>Lihat data lengkap</h2>
<div class="quick">
  <a href="/dashboard/catalog"><div class="big"><%= fmtNum(d.counts.catalog) %></div><div>Katalog Produk Umum</div><div class="arw">Buka daftar + cari →</div></a>
  <a href="/dashboard/businesses"><div class="big"><%= fmtNum(d.counts.businesses) %></div><div>Toko Terdaftar</div><div class="arw">Buka daftar →</div></a>
  <a href="/dashboard/transactions"><div class="big"><%= fmtNum(d.counts.transactions) %></div><div>Transaksi</div><div class="arw">Buka daftar →</div></a>
</div>

<% if (d.categories.length) { %>
<div class="h2row"><h2>Kategori Katalog</h2><a class="btn-link" href="/dashboard/catalog">Semua kategori →</a></div>
<div class="cats">
  <% const max = d.categories[0].n || 1; d.categories.forEach(function(c){ %>
    <a class="cat" href="<%= catUrl({ category: c.category }) %>" title="Lihat produk kategori <%= c.category %>">
      <span class="nm"><%= c.category %></span>
      <span class="bar"><i style="width:<%= Math.max(4, Math.round(100*c.n/max)) %>%"></i></span>
      <span class="ct"><%= fmtNum(c.n) %></span>
      <span class="go">›</span>
    </a>
  <% }) %>
</div>
<% } %>

<% if (d.recentCatalog.length) { %>
<div class="h2row"><h2>Katalog terbaru</h2><a class="btn-link primary" href="/dashboard/catalog">Lihat semua produk →</a></div>
<div class="strip">
  <% d.recentCatalog.forEach(function(p){ %>
    <a class="p" href="<%= catUrl({ q: p.barcode || p.name || '' }) %>" title="<%= p.name || '' %>">
      <img src="<%= p.photoUrl %>" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="cap"><%= p.name || '—' %></div>
    </a>
  <% }) %>
</div>
<% } %>
`;

export function renderOverview(d: Overview): string {
  const body = ejs.render(OVERVIEW_TPL, { d, catUrl: catalogUrl, ...helpers });
  return renderLayout({
    title: 'Ringkasan',
    active: 'overview',
    body,
    serverTime: d.serverTime,
    pendingContrib: d.pendingContributions,
  });
}

// ── Kontribusi (moderasi) ─────────────────────────────────────────────────────

const CONTRIB_TPL = `
<h1>Kontribusi Katalog</h1>
<div class="subnav">
  <a class="<%= pg.status==='pending'?'on':'' %>"  href="/dashboard/contributions?status=pending">Menunggu (<%= pg.counts.pending %>)</a>
  <a class="<%= pg.status==='approved'?'on':'' %>" href="/dashboard/contributions?status=approved">Disetujui (<%= pg.counts.approved %>)</a>
  <a class="<%= pg.status==='rejected'?'on':'' %>" href="/dashboard/contributions?status=rejected">Ditolak (<%= pg.counts.rejected %>)</a>
</div>
<% if (pg.items.length === 0) { %>
  <div class="empty">Tidak ada usulan pada status ini.</div>
<% } else { %>
<div class="clist">
  <% pg.items.forEach(function(it){ %>
    <div class="cc">
      <% if (it.photoUrl) { %><img class="ph" src="<%= it.photoUrl %>" alt="" loading="lazy" onerror="this.style.display='none'"><% } else { %><div class="ph none">tanpa foto</div><% } %>
      <div class="body">
        <div class="nm"><%= it.name || '—' %> <% if (it.targetId){ %><span class="pill warn">usul EDIT</span><% } else { %><span class="pill ok">produk baru</span><% } %></div>
        <div class="meta">dari <b><%= it.businessName || '—' %></b> · <%= fmtDateTime(it.createdAt) %></div>
        <div class="kv">
          <span><b>Barcode:</b> <code><%= it.barcode || '—' %></code></span>
          <span><b>Brand:</b> <%= it.brand || '—' %></span>
          <span><b>Kategori:</b> <%= it.category || '—' %></span>
          <span><b>Ukuran:</b> <%= it.netSize ? (it.netSize+' '+(it.netUnit||'')) : '—' %></span>
        </div>
        <% if (it.keywords && it.keywords.length){ %><div class="kv"><span><b>Kata kunci:</b> <%= it.keywords.join(', ') %></span></div><% } %>
        <% if (it.note){ %><div class="note">📝 <%= it.note %></div><% } %>
        <% if (it.status==='pending'){ %>
          <div class="acts">
            <form class="inline" method="post" action="/dashboard/contributions/<%= it.id %>/approve">
              <button class="btn ok" type="submit">✓ Setujui</button>
            </form>
            <form class="inline" method="post" action="/dashboard/contributions/<%= it.id %>/reject">
              <input type="text" name="note" placeholder="Alasan tolak (opsional)">
              <button class="btn bad" type="submit">✕ Tolak</button>
            </form>
          </div>
        <% } else { %>
          <div class="meta" style="margin-top:10px">
            <span class="pill <%= it.status==='approved'?'ok':'bad' %>"><%= it.status==='approved'?'disetujui':'ditolak' %></span>
            oleh <%= it.reviewedBy || '—' %> · <%= it.reviewedAt ? fmtDateTime(it.reviewedAt) : '—' %>
            <% if (it.reviewNote){ %> · alasan: <%= it.reviewNote %><% } %>
          </div>
        <% } %>
      </div>
    </div>
  <% }) %>
</div>
<% } %>
<%- pager %>
`;

export function renderContributions(pg: ContribPage): string {
  const mkUrl = (p: number) => `/dashboard/contributions?status=${pg.status}&page=${p}`;
  const pager = pagerHtml(pg.page, pg.pages, pg.total, mkUrl);
  const body = ejs.render(CONTRIB_TPL, { pg, pager, ...helpers });
  return renderLayout({
    title: 'Kontribusi',
    active: 'contributions',
    body,
    serverTime: pg.serverTime,
    pendingContrib: pg.counts.pending,
  });
}

// ── Katalog (foto + filter + cari + scan) ────────────────────────────────────

const CATALOG_TPL = `
<h1>Katalog Produk Umum</h1>
<form class="search" method="get" action="/dashboard/catalog" id="cat-search">
  <div class="search-box">
    <%- icons.search %>
    <label class="sr" for="q">Cari produk</label>
    <input type="search" id="q" name="q" value="<%= f.q %>" placeholder="Cari nama / brand / barcode…" autocomplete="off">
  </div>
  <% if (f.category) { %><input type="hidden" name="category" value="<%= f.category %>"><% } %>
  <% if (f.source) { %><input type="hidden" name="source" value="<%= f.source %>"><% } %>
  <% if (f.verified !== undefined) { %><input type="hidden" name="verified" value="<%= f.verified ? '1' : '0' %>"><% } %>
  <button type="button" class="btn ghost" id="scan-open" title="Scan barcode / QR code dengan kamera"><%- icons.scan %>Scan</button>
  <button type="submit" class="btn primary">Cari</button>
</form>

<div class="filters">
  <div class="frow">
    <span class="flabel">Kategori</span>
    <div class="chips">
      <a class="chip <%= !f.category ? 'on' : '' %>" href="<%= url({ ...f, category: undefined }) %>">Semua</a>
      <% pg.categories.forEach(function(c){ %>
        <a class="chip <%= f.category === c.category ? 'on' : '' %>" href="<%= url({ ...f, category: c.category }) %>"><%= c.category %> <span class="c"><%= fmtNum(c.n) %></span></a>
      <% }) %>
    </div>
  </div>
  <div class="frow">
    <span class="flabel">Sumber</span>
    <div class="chips">
      <a class="chip <%= !f.source ? 'on' : '' %>" href="<%= url({ ...f, source: undefined }) %>">Semua</a>
      <a class="chip <%= f.source === 'crowdsource' ? 'on' : '' %>" href="<%= url({ ...f, source: 'crowdsource' }) %>">Crowdsource</a>
      <a class="chip <%= f.source === 'admin' ? 'on' : '' %>" href="<%= url({ ...f, source: 'admin' }) %>">Admin</a>
    </div>
  </div>
  <div class="frow">
    <span class="flabel">Status</span>
    <div class="chips">
      <a class="chip <%= f.verified === undefined ? 'on' : '' %>" href="<%= url({ ...f, verified: undefined }) %>">Semua</a>
      <a class="chip <%= f.verified === true ? 'on' : '' %>" href="<%= url({ ...f, verified: true }) %>">Terverifikasi</a>
      <a class="chip <%= f.verified === false ? 'on' : '' %>" href="<%= url({ ...f, verified: false }) %>">Belum verifikasi</a>
    </div>
  </div>
</div>

<% if (hasFilter) { %>
<div class="active-filters">
  <span><b><%= fmtNum(pg.total) %></b> produk cocok</span>
  <a href="/dashboard/catalog">✕ Reset semua filter</a>
</div>
<% } %>

<div class="tablewrap">
  <% if (pg.items.length === 0) { %>
    <div class="empty">Tidak ada produk<%= f.q ? ' untuk "'+f.q+'"' : '' %> dengan filter ini.</div>
  <% } else { %>
  <table>
    <thead><tr><th>Foto</th><th>Nama</th><th>Brand</th><th>Kategori</th><th>Ukuran</th><th>Verified</th><th>Sumber</th></tr></thead>
    <tbody>
    <% pg.items.forEach(function(it){ %>
      <tr>
        <td><% if (it.photoUrl) { %><img class="thumb" src="<%= it.photoUrl %>" alt="" loading="lazy" onerror="this.style.display='none'"><% } else { %><div class="thumb ph">?</div><% } %></td>
        <td><%= it.name || '—' %><br><span class="mut" style="font-size:11px"><code><%= it.barcode || '—' %></code></span></td>
        <td class="mut"><%= it.brand || '—' %></td>
        <td><a class="catlink" href="<%= url({ ...f, category: it.category || uncategorized }) %>"><%= it.category || '—' %></a></td>
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

<dialog class="scan" id="scan-dlg" aria-labelledby="scan-title">
  <div class="scan-hd"><b id="scan-title">Scan barcode / QR</b><button type="button" class="icon-btn" id="scan-close" aria-label="Tutup">✕</button></div>
  <div class="scan-bd">
    <div id="scan-reader"></div>
    <p class="scan-msg" id="scan-msg" aria-live="polite">Arahkan kamera ke barcode produk…</p>
  </div>
  <div class="scan-ft">
    <label class="btn ghost" for="scan-file">Pilih foto barcode</label>
    <input type="file" id="scan-file" accept="image/*" class="sr">
    <button type="button" class="btn ghost" id="scan-cancel">Batal</button>
  </div>
</dialog>
`;

/** Scanner kamera (html5-qrcode, dimuat malas). Hasil → isi kotak cari & submit (filter tetap). */
const SCAN_JS = `<script>
(function(){
  var LIB=${JSON.stringify(SCANNER_LIB)};
  var dlg=document.getElementById('scan-dlg'), msg=document.getElementById('scan-msg');
  var form=document.getElementById('cat-search'), input=document.getElementById('q');
  var scanner=null, done=false;
  var reader=document.getElementById('scan-reader');
  function say(t,err){msg.textContent=t;msg.className='scan-msg'+(err?' err':'');reader.classList.toggle('off',!!err)}
  function loadLib(){return new Promise(function(ok,fail){
    if(window.Html5Qrcode) return ok();
    var s=document.createElement('script');s.src=LIB;s.onload=ok;s.onerror=function(){fail(new Error('Gagal memuat pemindai'))};document.head.appendChild(s);
  })}
  function found(text){
    if(done) return; done=true;
    say('Terbaca: '+text);
    input.value=text.trim();
    stop().then(function(){dlg.close();form.submit()});
  }
  function stop(){
    var s=scanner; scanner=null;
    if(s && s.isScanning) return s.stop().then(function(){s.clear()}).catch(function(){});
    return Promise.resolve();
  }
  document.getElementById('scan-open').addEventListener('click',function(){
    done=false; say('Menyiapkan kamera…'); dlg.showModal();
    loadLib().then(function(){
      scanner=new Html5Qrcode('scan-reader');
      return scanner.start({facingMode:'environment'},{fps:10,qrbox:function(w,h){var m=Math.min(w,h);return{width:Math.floor(m*.9),height:Math.floor(m*.55)}}},found,function(){});
    }).then(function(){say('Arahkan kamera ke barcode atau QR code…')})
    .catch(function(e){say((e&&e.message?e.message:String(e)).indexOf('Permission')>=0?'Izin kamera ditolak. Izinkan kamera atau pilih foto barcode.':'Kamera tidak tersedia. Pilih foto barcode sebagai gantinya.',true)});
  });
  document.getElementById('scan-file').addEventListener('change',function(e){
    var f=e.target.files&&e.target.files[0]; if(!f) return;
    say('Membaca gambar…');
    loadLib().then(stop).then(function(){return new Html5Qrcode('scan-reader').scanFile(f,false)})
      .then(found).catch(function(){say('Barcode tidak terbaca dari gambar itu. Coba foto yang lebih jelas.',true)});
    e.target.value='';
  });
  function close(){stop().then(function(){dlg.close()})}
  document.getElementById('scan-close').addEventListener('click',close);
  document.getElementById('scan-cancel').addEventListener('click',close);
  dlg.addEventListener('cancel',function(e){e.preventDefault();close()});
})();
</script>`;

export function renderCatalog(pg: CatalogPage): string {
  const f = pg.filters;
  const pager = pagerHtml(pg.page, pg.pages, pg.total, (p) => catalogUrl(f, p));
  const hasFilter = Boolean(f.q || f.category || f.source || f.verified !== undefined);
  const body = ejs.render(CATALOG_TPL, {
    pg,
    f,
    url: (x: Partial<CatalogFilters>) => catalogUrl(x),
    hasFilter,
    pager,
    uncategorized: UNCATEGORIZED,
    icons: ICONS,
    ...helpers,
  });
  return renderLayout({ title: 'Katalog', active: 'catalog', body, serverTime: pg.serverTime, extraJs: SCAN_JS });
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
