import ejs from 'ejs';
import type {
  Overview,
  Page,
  CatalogPage,
  CatalogFilters,
  BusinessItem,
  TxItem,
  ContribPage,
  BusinessDetail,
  BusinessTablePage,
} from '../services/dashboard.service.js';
import { UNCATEGORIZED, BUSINESS_TABS } from '../services/dashboard.service.js';
import type { CatalogDetail } from '../services/catalog-admin.service.js';
import type { Col } from '../db/backup-tables.js';
import { detectBarcodeType } from '../lib/barcode.js';

/** Pesan sekali-tampil setelah redirect (disisipkan route di marker `<!--flash-->`). */
export interface Flash {
  type: 'ok' | 'error';
  msg: string;
}

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

export const helpers = {
  fmtRp: (v: number) => (v < 0 ? '−Rp ' : 'Rp ') + RP.format(Math.abs(v || 0)),
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
  nav.top{display:flex;gap:6px;align-items:center;margin-bottom:22px;border-bottom:1px solid var(--line);padding-bottom:12px;position:relative}
  nav.top .menu{display:flex;align-items:center;gap:2px}
  nav.top .grp{position:relative}
  nav.top .grp>summary{list-style:none;cursor:pointer;color:var(--mut);padding:6px 11px;border-radius:8px;font-weight:600;display:flex;align-items:center;gap:5px;white-space:nowrap;user-select:none}
  nav.top .grp>summary::-webkit-details-marker{display:none}
  nav.top .grp>summary:hover{color:var(--tx)}
  nav.top .grp>summary .chev{width:7px;height:7px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg) translateY(-2px);opacity:.7}
  nav.top .grp[open]>summary .chev{transform:rotate(-135deg) translateY(-1px)}
  nav.top .grp.active>summary,nav.top .grp[open]>summary{background:var(--card);color:var(--tx);box-shadow:inset 0 0 0 1px var(--line)}
  nav.top .grp .gdot{display:none;width:7px;height:7px;border-radius:50%;background:var(--warn)}
  nav.top .grp:has(.dd .nb) .gdot{display:inline-block}
  nav.top .dd{position:absolute;top:calc(100% + 6px);left:0;min-width:230px;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:6px;z-index:50;display:flex;flex-direction:column;gap:2px}
  nav.top .dd a{display:block;padding:8px 10px;border-radius:8px;color:var(--tx);font-weight:600;font-size:14px}
  nav.top .dd button.dd-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:8px;color:var(--tx);font-weight:600;font-size:14px;text-align:left;background:none;border:0;cursor:pointer;font-family:inherit;width:100%}
  nav.top .dd button.dd-item svg{width:16px;height:16px}
  nav.top .dd a small{display:block;font-weight:400;color:var(--mut);font-size:11px;margin-top:1px}
  nav.top .dd a:hover,nav.top .dd button.dd-item:hover{background:var(--sunk)}
  nav.top .dd a.active{background:var(--acc-soft);color:var(--acc)}
  nav.top .dd .nb{background:var(--warn);color:#fff;border-radius:999px;padding:0 6px;font-size:11px;font-weight:800}
  nav.top .dd hr{border:0;border-top:1px solid var(--line);margin:4px 2px}
  nav.top .grp.me>summary{padding:3px 8px 3px 3px;border:1px solid var(--line);background:var(--card);color:var(--tx)}
  nav.top .grp.me .ava{width:24px;height:24px;border-radius:50%;background:var(--acc-soft);color:var(--acc);display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:800}
  nav.top .grp.me .dd{left:auto;right:0}
  nav.top .grp.me .who{padding:6px 10px 8px;font-size:12px;color:var(--mut);border-bottom:1px solid var(--line);margin-bottom:4px;word-break:break-all}
  nav.top .grp.me .who b{display:block;color:var(--tx);font-size:13px}
  nav.top .burger{display:none;font-size:16px}
  @media (max-width:1180px){nav.top .st{display:none} nav.top .grp.me .me-name{display:none}}
  @media (max-width:900px){
    nav.top .burger{display:inline-flex}
    nav.top .menu{display:none;position:absolute;top:100%;left:0;right:0;margin-top:6px;flex-direction:column;align-items:stretch;gap:2px;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:8px;z-index:60;max-height:75vh;overflow:auto}
    nav.top #navtoggle:checked~.menu{display:flex}
    nav.top .menu>a.tab,nav.top .menu .grp>summary{padding:10px 12px}
    nav.top .menu .grp>summary .chev{margin-left:auto}
    nav.top .menu .dd{position:static;box-shadow:none;border:0;border-left:2px solid var(--line);border-radius:0;margin:2px 0 6px 14px;padding:0 0 0 6px;min-width:0}
  }
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
  .flash{margin:0 0 16px;padding:10px 14px;border-radius:10px;font-size:13px;font-weight:600;border:1px solid var(--ok-line);color:var(--ok);background:var(--card)}
  .flash.err{border-color:var(--bad-line);color:var(--bad)}
  .titlebar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
  .titlebar h1{margin:0}
  .titlebar .acts{display:flex;flex-wrap:wrap;gap:8px}
  .btn-link.danger{color:var(--bad);border-color:var(--bad-line)}
  .notice{background:var(--card);border:1px solid var(--warn-line);color:var(--tx);border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:14px}
  .notice b{color:var(--warn)}
  td.chk,th.chk{width:36px;padding-right:0}
  td.chk input,th.chk input{width:16px;height:16px;accent-color:var(--acc);cursor:pointer}
  tr.sel td{background:var(--acc-soft)}
  td.acts-col{white-space:nowrap;text-align:right}
  .mini{display:inline-flex;align-items:center;padding:4px 10px;border-radius:7px;border:1px solid var(--line);color:var(--tx);font-size:12px;font-weight:600;background:var(--bg)}
  .mini:hover{border-color:var(--acc);color:var(--acc)}
  .bulkbar{position:sticky;bottom:12px;z-index:5;display:none;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px;padding:10px 14px;background:var(--card);border:1px solid var(--acc);border-radius:12px;box-shadow:var(--shadow)}
  .bulkbar.on{display:flex}
  .bulkbar .cnt{font-weight:700;margin-right:auto}
  .form-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;align-items:start}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
  .panel h3{margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut)}
  .fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 14px}
  .fields .full{grid-column:1/-1}
  .f label{display:block;font-size:12px;font-weight:700;margin-bottom:5px}
  .f label .req{color:var(--bad)}
  .f input[type=text],.f input[type=url],.f input[type=number],.f select,.f textarea{width:100%;background:var(--bg);border:1px solid var(--line);color:var(--tx);border-radius:8px;padding:8px 10px;font:inherit;font-size:14px}
  .f textarea{min-height:72px;resize:vertical}
  .f input:focus,.f select:focus,.f textarea:focus{outline:0;border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-soft)}
  .f .hint{font-size:11px;color:var(--mut);margin-top:4px}
  .check{display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer}
  .check input{width:16px;height:16px;accent-color:var(--acc)}
  .bc-row{display:flex;gap:8px;align-items:stretch}
  .bc-row input{flex:1;min-width:0}
  .bc-row .btn{white-space:nowrap}
  .photo-box{width:100%;aspect-ratio:1;border-radius:10px;border:1px solid var(--line);background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:10px}
  .photo-box img{width:100%;height:100%;object-fit:contain}
  .photo-box .none{color:var(--mut);font-size:12px}
  .photo-box:has(.none){background:var(--sunk)}
  .meta-list{font-size:12px;color:var(--mut);display:grid;gap:4px;margin-top:12px}
  .meta-list code{font-size:11px}
  .form-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:16px}
  .form-actions .spacer{flex:1}
  .crumb{font-size:13px;margin-bottom:10px;display:inline-block}
  .biz-head{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 18px;font-size:13px}
  .biz-head b{display:block;color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.04em;font-weight:700}
  .tabs-wrap{position:relative;display:flex;align-items:center;gap:6px;margin:16px 0 12px}
  .tabs{display:flex;flex-wrap:nowrap;gap:6px;overflow-x:auto;scroll-behavior:smooth;scrollbar-width:none;flex:1;min-width:0;padding:2px;
    -webkit-mask-image:linear-gradient(90deg,transparent 0,#000 var(--fl,0px),#000 calc(100% - var(--fr,0px)),transparent 100%);
    mask-image:linear-gradient(90deg,transparent 0,#000 var(--fl,0px),#000 calc(100% - var(--fr,0px)),transparent 100%)}
  .tabs::-webkit-scrollbar{display:none}
  .tabs a{flex:0 0 auto;white-space:nowrap;display:inline-flex;gap:6px;align-items:center;padding:5px 11px;border-radius:999px;border:1px solid var(--line);color:var(--tx);font-size:13px;background:var(--card)}
  .tabs a.special{border-color:var(--acc);color:var(--acc);font-weight:600}
  .tabs-arrow{flex:0 0 auto;width:30px;height:30px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--tx);cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center}
  .tabs-arrow:hover{border-color:var(--acc);color:var(--acc)}
  .tabs-arrow[hidden]{display:none}
  .tabs a .c{color:var(--mut);font-size:11px}
  .tabs a.on{background:var(--acc);border-color:var(--acc);color:var(--acc-tx)}
  .tabs a.on .c{color:var(--acc-tx)}
  .tabs a.zero{opacity:.55}
  .counts{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
  .counts a{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;color:var(--tx)}
  .counts a:hover{border-color:var(--acc)}
  .counts a .n{font-size:20px;font-weight:800}
  .counts a .l{font-size:12px;color:var(--mut)}
  .counts a.zero{opacity:.55}
  tr.rowlink{cursor:pointer}
  .biztable td{white-space:nowrap}
  tr.rowlink:hover td{background:var(--acc-soft)}
  @media (max-width:860px){.form-grid{grid-template-columns:1fr}}
  @media (max-width:640px){
    .fields{grid-template-columns:1fr}
    .frow{flex-direction:column;gap:6px}
    .flabel{flex:none;padding:0}
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

export const ICONS = {
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
    <input type="checkbox" id="navtoggle" hidden>
    <div class="menu">
      <a class="tab <%= active==='overview'?'active':'' %>" href="/dashboard">Ringkasan</a>
      <details class="grp <%= ['users','businesses','subscriptions'].includes(active)?'active':'' %>">
        <summary>Pengguna <span class="gdot"></span><span class="chev"></span></summary>
        <div class="dd">
          <a class="<%= active==='users'?'active':'' %>" href="/dashboard/users">Pengguna terdaftar<small>Akun pemilik, verifikasi, Poin</small></a>
          <a class="<%= active==='businesses'?'active':'' %>" href="/dashboard/businesses">Toko<small>Semua toko &amp; laporannya</small></a>
          <a class="<%= active==='subscriptions'?'active':'' %>" href="/dashboard/subscriptions">Langganan<!--sub-badge--><small>Paket Juragan &amp; pembayaran</small></a>
        </div>
      </details>
      <a class="tab <%= active==='transactions'?'active':'' %>" href="/dashboard/transactions">Transaksi</a>
      <details class="grp <%= ['ppob','points'].includes(active)?'active':'' %>">
        <summary>PPOB &amp; Poin <span class="gdot"></span><span class="chev"></span></summary>
        <div class="dd">
          <a class="<%= active==='ppob'?'active':'' %>" href="/dashboard/ppob">PPOB<!--pp-badge--><small>Order pulsa, data, token listrik</small></a>
          <a class="<%= active==='points'?'active':'' %>" href="/dashboard/points">Poin<!--pt-badge--><small>Top-up, saldo akun, rekening</small></a>
        </div>
      </details>
      <details class="grp <%= ['catalog','contributions'].includes(active)?'active':'' %>">
        <summary>Katalog <span class="gdot"></span><span class="chev"></span></summary>
        <div class="dd">
          <a class="<%= active==='catalog'?'active':'' %>" href="/dashboard/catalog">Katalog produk<small>Produk umum &amp; foto</small></a>
          <a class="<%= active==='contributions'?'active':'' %>" href="/dashboard/contributions">Kontribusi<% if (pendingContrib>0){ %> <span class="nb"><%= pendingContrib %></span><% } %><small>Usulan produk dari toko</small></a>
        </div>
      </details>
      <details class="grp <%= active==='site'?'active':'' %>">
        <summary>Website <span class="chev"></span></summary>
        <div class="dd">
          <a class="<%= active==='site'?'active':'' %>" href="/dashboard/site/posts">Artikel blog<small>Tulis &amp; jadwalkan artikel SEO</small></a>
          <a href="/dashboard/site/pages">Halaman<small>Halaman fitur, privasi, ketentuan</small></a>
          <a href="/dashboard/site/leads">Pesan masuk<!--lead-badge--><small>Daftar tunggu, kontak, hapus akun</small></a>
          <a href="/" target="_blank" rel="noopener">Lihat situs ↗<small>sirkopos.com</small></a>
        </div>
      </details>
      <a class="tab <%= active==='feedback'?'active':'' %>" href="/dashboard/feedback">Saran<!--fb-badge--></a>
    </div>
    <span class="spacer"></span>
    <span class="st"><%= fmtDateTime(serverTime) %> WIB</span>
    <%- themeBtn %>
    <details class="grp me <%= active==='profile'?'active':'' %>">
      <summary aria-label="Akun admin"><span class="ava"><!--admin-initial-->A</span><span class="me-name"><!--admin-name-->Akun</span><span class="chev"></span></summary>
      <div class="dd">
        <div class="who"><!--admin-who--><b>Admin</b></div>
        <a class="<%= active==='profile'?'active':'' %>" href="/dashboard/profile"><span>Profil &amp; keamanan<small>Password, notifikasi Telegram</small></span></a>
        <hr>
        <form method="post" action="/dashboard/logout"><button class="dd-item" type="submit"><span>Keluar</span><%- icons.logout %></button></form>
      </div>
    </details>
    <label for="navtoggle" class="icon-btn burger" aria-label="Menu" title="Menu">☰</label>
  </nav>
  <script>(function(){
    var ds=[].slice.call(document.querySelectorAll('nav.top details.grp'));
    ds.forEach(function(d){d.addEventListener('toggle',function(){if(d.open)ds.forEach(function(o){if(o!==d&&!o.contains(d))o.open=false})})});
    document.addEventListener('click',function(e){ds.forEach(function(d){if(d.open&&!d.contains(e.target))d.open=false})});
    document.addEventListener('keydown',function(e){if(e.key==='Escape')ds.forEach(function(d){d.open=false})});
  })();</script>
  <!--flash-->
  <%- body %>
</div>
<script><%- themeJs %></script>
<%- extraJs %>
</body></html>`;

export function renderLayout(opts: {
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
export function pagerHtml(page: number, pages: number, total: number, mkUrl: (p: number) => string): string {
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
  .notice{background:var(--sunk);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:16px}
  .otp-input input{font-size:24px;letter-spacing:.35em;text-align:center;font-family:ui-monospace,Consolas,monospace}
`;

const AUTH_TPL = `<!doctype html><html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title><%= title %> · Sirko Admin</title>
<script><%- themeBoot %></script>
<style><%- css %><%- loginCss %></style></head>
<body>
  <div class="login-top"><%- themeBtn %></div>
  <main class="login-main">
    <div class="login-card">
      <div class="login-brand"><span class="logo">S</span><div><b>Sirko Admin</b><span>Panel pengelola Sirko</span></div></div>
      <h1><%= title %></h1>
      <p class="sub"><%= sub %></p>
      <% if (error) { %><div class="alert" role="alert"><span>⚠</span><span><%= error %></span></div><% } %>
      <% if (notice) { %><div class="notice" role="status"><%= notice %></div><% } %>
      <%- body %>
      <div class="login-foot"><a href="/dashboard/login">← Kembali ke halaman masuk</a></div>
    </div>
  </main>
<script><%- themeJs %></script>
</body></html>`;

/** Kartu halaman tanpa sesi (lupa/reset password) dengan gaya halaman login. */
export function renderAuthCard(opts: { title: string; sub: string; body: string; error?: string | null; notice?: string | null }): string {
  return ejs.render(AUTH_TPL, {
    error: null,
    notice: null,
    ...opts,
    css: CSS,
    loginCss: LOGIN_CSS,
    themeBoot: THEME_BOOT,
    themeJs: THEME_TOGGLE_JS,
    themeBtn: THEME_BTN,
  });
}

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
          <label for="user">Email</label>
          <div class="input"><input id="user" name="user" type="text" autocomplete="username" required value="<%= user %>" <%= user ? '' : 'autofocus' %>></div>
        </div>
        <div class="field">
          <label for="password">Password</label>
          <div class="input">
            <input id="password" name="password" type="password" autocomplete="current-password" required <%= user ? 'autofocus' : '' %>>
            <button type="button" id="toggle-pw" aria-label="Tampilkan password" title="Tampilkan password"><%- icons.eye %></button>
          </div>
        </div>
        <div class="row"><label><input type="checkbox" name="remember"> Ingat saya 30 hari</label><a href="/dashboard/forgot">Lupa password?</a></div>
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
  if (f.trash) p.set('trash', '1');
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
<div class="titlebar">
  <h1><%= f.trash ? 'Sampah Katalog' : 'Katalog Produk Umum' %></h1>
  <div class="acts">
    <% if (f.trash) { %>
      <a class="btn-link" href="<%= url({ ...f, trash: undefined }) %>">← Kembali ke katalog</a>
    <% } else { %>
      <a class="btn-link" href="<%= url({ ...f, trash: true }) %>">🗑 Sampah (<%= fmtNum(pg.trashCount) %>)</a>
      <a class="btn-link primary" href="/dashboard/catalog/new?back=<%= encodeURIComponent(self) %>">+ Tambah produk</a>
    <% } %>
  </div>
</div>
<% if (f.trash) { %>
<div class="notice"><b>Sampah:</b> produk di sini tidak muncul di aplikasi (pencarian &amp; scan). Centang lalu <b>Pulihkan</b> bila terhapus tidak sengaja.</div>
<% } %>
<form class="search" method="get" action="/dashboard/catalog" id="cat-search">
  <div class="search-box">
    <%- icons.search %>
    <label class="sr" for="q">Cari produk</label>
    <input type="search" id="q" name="q" value="<%= f.q %>" placeholder="Cari nama / brand / barcode…" autocomplete="off">
  </div>
  <% if (f.category) { %><input type="hidden" name="category" value="<%= f.category %>"><% } %>
  <% if (f.source) { %><input type="hidden" name="source" value="<%= f.source %>"><% } %>
  <% if (f.verified !== undefined) { %><input type="hidden" name="verified" value="<%= f.verified ? '1' : '0' %>"><% } %>
  <% if (f.trash) { %><input type="hidden" name="trash" value="1"><% } %>
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
  <a href="<%= f.trash ? '/dashboard/catalog?trash=1' : '/dashboard/catalog' %>">✕ Reset semua filter</a>
</div>
<% } %>

<form method="post" action="/dashboard/catalog/bulk" id="bulk-form">
<input type="hidden" name="back" value="<%= self %>">
<div class="tablewrap">
  <% if (pg.items.length === 0) { %>
    <div class="empty"><%= f.trash ? 'Sampah kosong' : 'Tidak ada produk' %><%= f.q ? ' untuk "'+f.q+'"' : '' %> dengan filter ini.</div>
  <% } else { %>
  <table>
    <thead><tr><th class="chk"><input type="checkbox" id="chk-all" aria-label="Pilih semua di halaman ini"></th><th>Foto</th><th>Nama</th><th>Brand</th><th>Kategori</th><th>Ukuran</th><th>Verified</th><th>Sumber</th><th></th></tr></thead>
    <tbody>
    <% pg.items.forEach(function(it){ var edit = '/dashboard/catalog/' + it.id + '?back=' + encodeURIComponent(self); %>
      <tr>
        <td class="chk"><input type="checkbox" name="ids" value="<%= it.id %>" class="chk-row" aria-label="Pilih <%= it.name || 'produk' %>"></td>
        <td><% if (it.photoUrl) { %><img class="thumb" src="<%= it.photoUrl %>" alt="" loading="lazy" onerror="this.style.display='none'"><% } else { %><div class="thumb ph">?</div><% } %></td>
        <td><a href="<%= edit %>" style="color:var(--tx)"><%= it.name || '—' %></a><br><span class="mut" style="font-size:11px"><code><%= it.barcode || '—' %></code></span></td>
        <td class="mut"><%= it.brand || '—' %></td>
        <td><a class="catlink" href="<%= url({ ...f, category: it.category || uncategorized }) %>"><%= it.category || '—' %></a></td>
        <td class="mut"><%= it.netSize ? (it.netSize + ' ' + (it.netUnit||'')) : '—' %></td>
        <td><span class="pill <%= it.verified?'ok':'warn' %>"><%= it.verified?'ya':'belum' %></span></td>
        <td class="mut"><%= it.source %></td>
        <td class="acts-col"><a class="mini" href="<%= edit %>"><%= f.trash ? 'Lihat' : 'Edit' %></a></td>
      </tr>
    <% }) %>
    </tbody>
  </table>
  <% } %>
</div>
<div class="bulkbar" id="bulkbar">
  <span class="cnt"><span id="bulk-n">0</span> dipilih</span>
  <% if (f.trash) { %>
    <button class="btn primary" name="action" value="restore">↺ Pulihkan</button>
  <% } else { %>
    <button class="btn ghost" name="action" value="verify">✓ Tandai terverifikasi</button>
    <button class="btn ghost" name="action" value="unverify">Tandai belum</button>
    <button class="btn bad" name="action" value="delete" data-confirm="Pindahkan produk terpilih ke Sampah? Produk tak akan muncul di aplikasi (bisa dipulihkan).">🗑 Hapus</button>
  <% } %>
</div>
</form>
<%- pager %>

<%- scanDialog %>
`;

/** Pilih-semua, hitung terpilih, & konfirmasi aksi berbahaya (hapus). */
const BULK_JS = `<script>
(function(){
  var form=document.getElementById('bulk-form'); if(!form) return;
  var all=document.getElementById('chk-all'), bar=document.getElementById('bulkbar'), n=document.getElementById('bulk-n');
  function rows(){return Array.prototype.slice.call(form.querySelectorAll('.chk-row'))}
  function sync(){
    var on=rows().filter(function(c){c.closest('tr').classList.toggle('sel',c.checked);return c.checked}).length;
    n.textContent=on; bar.classList.toggle('on',on>0);
    if(all){all.checked=on>0&&on===rows().length;all.indeterminate=on>0&&on<rows().length}
  }
  if(all) all.addEventListener('change',function(){rows().forEach(function(c){c.checked=all.checked});sync()});
  form.addEventListener('change',function(e){if(e.target.classList.contains('chk-row'))sync()});
  form.addEventListener('submit',function(e){
    var b=e.submitter; var msg=b&&b.getAttribute('data-confirm');
    if(msg&&!confirm(msg)) e.preventDefault();
  });
  sync();
})();
</script>`;

/** Dialog pemindai kamera (dipakai halaman katalog & form tambah/edit produk). */
const SCAN_DIALOG = `<dialog class="scan" id="scan-dlg" aria-labelledby="scan-title">
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
</dialog>`;

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
  const self = catalogUrl(f, pg.page);
  const body = ejs.render(CATALOG_TPL, {
    scanDialog: SCAN_DIALOG,
    pg,
    f,
    url: (x: Partial<CatalogFilters>) => catalogUrl(x),
    hasFilter,
    self,
    pager,
    uncategorized: UNCATEGORIZED,
    icons: ICONS,
    ...helpers,
  });
  return renderLayout({ title: 'Katalog', active: 'catalog', body, serverTime: pg.serverTime, extraJs: SCAN_JS + BULK_JS });
}

// ── Toko ──────────────────────────────────────────────────────────────────────

const BUSINESSES_TPL = `
<h1>Toko Terdaftar</h1>
<div class="tablewrap">
  <% if (pg.items.length === 0) { %>
    <div class="empty">Belum ada toko terdaftar.</div>
  <% } else { %>
  <table>
    <thead><tr><th>Nama</th><th>Jenis</th><th class="num">User</th><th class="num">Produk</th><th class="num">Transaksi</th><th>Dibuat</th><th>Transaksi terakhir masuk</th></tr></thead>
    <tbody>
    <% pg.items.forEach(function(b){ %>
      <tr class="rowlink" onclick="location.href='/dashboard/businesses/<%= b.id %>'">
        <td><a href="/dashboard/businesses/<%= b.id %>" style="color:var(--tx);font-weight:600"><%= b.name %></a><br><span class="mut" style="font-size:11px"><code><%= b.id.slice(0,8) %></code></span></td>
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
      <tr class="rowlink" onclick="location.href='/dashboard/businesses/<%= t.businessId %>/transactions/<%= t.id %>'">
        <td><a href="/dashboard/businesses/<%= t.businessId %>/transactions/<%= t.id %>"><code><%= t.invoiceNo || t.id.slice(0,8) %></code></a></td>
        <td><a href="/dashboard/businesses/<%= t.businessId %>" style="color:var(--tx)" onclick="event.stopPropagation()"><%= t.businessName || '—' %></a></td>
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

// ── Tidak ditemukan ──────────────────────────────────────────────────────────

export function renderNotFound(message: string, back: string): string {
  const body = `<h1>Tidak ditemukan</h1><div class="empty">${esc(message)}</div><p><a class="btn-link" href="${esc(back)}">← Kembali</a></p>`;
  return renderLayout({ title: 'Tidak ditemukan', active: '', body, serverTime: Date.now() });
}

// ── Form produk katalog (tambah / edit) ──────────────────────────────────────

const CATALOG_FORM_TPL = `
<a class="crumb" href="<%= back %>">← Kembali ke katalog</a>
<div class="titlebar">
  <h1><%= mode === 'new' ? 'Tambah produk katalog' : (p.name || 'Edit produk') %></h1>
  <% if (mode === 'edit' && !p.deletedAt) { %><span class="pill <%= p.verified ? 'ok' : 'warn' %>"><%= p.verified ? 'terverifikasi' : 'belum verifikasi' %></span><% } %>
</div>
<% if (error) { %><div class="flash err" role="alert"><%= error %></div><% } %>
<% if (p.deletedAt) { %>
<div class="notice"><b>Produk ini di Sampah</b> sejak <%= fmtDateTime(p.deletedAt) %> — tidak muncul di aplikasi. Pulihkan dulu untuk mengedit.
  <form method="post" action="/dashboard/catalog/<%= p.id %>/restore" style="display:inline;margin-left:8px">
    <input type="hidden" name="back" value="<%= back %>"><button class="btn primary" type="submit">↺ Pulihkan</button>
  </form>
</div>
<% } %>
<form method="post" enctype="multipart/form-data" action="<%= mode === 'new' ? '/dashboard/catalog/new' : '/dashboard/catalog/' + p.id %>" id="prod-form">
<input type="hidden" name="back" value="<%= back %>">
<fieldset style="border:0;padding:0;margin:0" <%= p.deletedAt ? 'disabled' : '' %>>
<div class="form-grid">
  <div class="panel">
    <h3>Data produk</h3>
    <div class="fields">
      <div class="f full"><label for="name">Nama produk <span class="req">*</span></label><input type="text" id="name" name="name" required maxlength="200" value="<%= p.name || '' %>"></div>
      <div class="f"><label for="barcode">Barcode</label>
        <div class="bc-row"><input type="text" id="barcode" name="barcode" maxlength="64" inputmode="numeric" autocomplete="off" value="<%= p.barcode || '' %>"><button type="button" class="btn ghost" id="scan-open" title="Scan barcode dengan kamera">📷 Scan</button></div>
        <div class="hint" id="barcode-hint">Ketik atau scan. Jenis barcode terisi otomatis. Unik di antara produk aktif.</div></div>
      <div class="f"><label for="barcodeType">Jenis barcode</label>
        <select id="barcodeType" name="barcodeType"><option value="">—</option>
          <% ['EAN13','EAN8','UPC','QR','other'].forEach(function(t){ %><option value="<%= t %>" <%= p.barcodeType === t ? 'selected' : '' %>><%= t %></option><% }) %>
        </select></div>
      <div class="f"><label for="brand">Brand</label><input type="text" id="brand" name="brand" maxlength="120" value="<%= p.brand || '' %>"></div>
      <div class="f"><label for="category">Kategori</label><input type="text" id="category" name="category" maxlength="120" list="cat-list" value="<%= p.category || '' %>" placeholder="Pilih atau ketik baru">
        <datalist id="cat-list"><% categories.forEach(function(c){ if (c.category !== uncategorized) { %><option value="<%= c.category %>"><% } }) %></datalist></div>
      <div class="f"><label for="manufacturer">Produsen</label><input type="text" id="manufacturer" name="manufacturer" maxlength="120" value="<%= p.manufacturer || '' %>"></div>
      <div class="f"><label for="variant">Varian / rasa</label><input type="text" id="variant" name="variant" maxlength="120" value="<%= p.variant || '' %>"></div>
      <div class="f"><label for="netSize">Ukuran bersih</label><input type="number" step="any" min="0" id="netSize" name="netSize" value="<%= p.netSize == null ? '' : p.netSize %>"></div>
      <div class="f"><label for="netUnit">Satuan ukuran</label><input type="text" id="netUnit" name="netUnit" maxlength="40" list="unit-list" value="<%= p.netUnit || '' %>" placeholder="g, ml, kg, l, pcs">
        <datalist id="unit-list"><option value="g"><option value="kg"><option value="ml"><option value="l"><option value="pcs"></datalist></div>
      <div class="f"><label for="defaultUnit">Satuan jual default</label><input type="text" id="defaultUnit" name="defaultUnit" maxlength="40" value="<%= p.defaultUnit || '' %>" placeholder="pcs, bungkus, botol"></div>
      <div class="f"><label for="packaging">Kemasan</label><input type="text" id="packaging" name="packaging" maxlength="80" value="<%= p.packaging || '' %>"></div>
      <div class="f"><label for="countryOfOrigin">Negara asal</label><input type="text" id="countryOfOrigin" name="countryOfOrigin" maxlength="80" value="<%= p.countryOfOrigin || '' %>"></div>
      <div class="f full"><label for="shortDescription">Deskripsi singkat</label><textarea id="shortDescription" name="shortDescription" maxlength="500"><%= p.shortDescription || '' %></textarea></div>
      <div class="f full"><label for="keywords">Kata kunci pencarian</label><input type="text" id="keywords" name="keywords" value="<%= (p.keywords || []).join(', ') %>"><div class="hint">Pisahkan dengan koma. Membantu pencarian di aplikasi.</div></div>
    </div>
  </div>
  <div>
    <div class="panel">
      <h3>Foto</h3>
      <div class="photo-box" id="photo-box"><% if (p.photoUrl) { %><img src="<%= p.photoUrl %>" alt="" id="photo-img"><% } else { %><span class="none" id="photo-none">Belum ada foto</span><% } %></div>
      <div class="f"><label for="photo">Unggah foto baru</label><input type="file" id="photo" name="photo" accept="image/jpeg,image/png,image/webp"><div class="hint" id="photo-hint">JPG/PNG/WebP. Otomatis dikompres ≤ 200 KB sebelum diunggah. Menggantikan foto lama saat disimpan.</div></div>
      <div class="f" style="margin-top:10px"><label for="photoUrl">atau URL foto</label><input type="url" id="photoUrl" name="photoUrl" maxlength="1000" value="<%= p.photoUrl || '' %>"></div>
    </div>
    <div class="panel" style="margin-top:12px">
      <h3>Status</h3>
      <label class="check"><input type="checkbox" name="verified" <%= p.verified ? 'checked' : '' %>> Terverifikasi</label>
      <div class="f" style="margin-top:12px"><label for="source">Sumber data</label>
        <select id="source" name="source"><option value="admin" <%= p.source === 'admin' ? 'selected' : '' %>>admin</option><option value="crowdsource" <%= p.source === 'crowdsource' ? 'selected' : '' %>>crowdsource</option></select></div>
      <% if (mode === 'edit') { %>
      <div class="meta-list">
        <span>ID: <code><%= p.id %></code></span>
        <span>Dibuat: <%= fmtDateTime(p.createdAt) %></span>
        <span>Diubah: <%= fmtDateTime(p.updatedAt) %></span>
      </div>
      <% } %>
    </div>
  </div>
</div>
<div class="form-actions">
  <button class="btn primary" type="submit"><%= mode === 'new' ? 'Tambah produk' : 'Simpan perubahan' %></button>
  <a class="btn-link" href="<%= back %>">Batal</a>
  <span class="spacer"></span>
  <% if (mode === 'edit') { %><button class="btn-link danger" type="submit" form="del-form">🗑 Hapus produk</button><% } %>
</div>
</fieldset>
</form>
<% if (mode === 'edit' && !p.deletedAt) { %>
<form method="post" action="/dashboard/catalog/<%= p.id %>/delete" id="del-form" onsubmit="return confirm('Pindahkan produk ini ke Sampah? Produk tak akan muncul di aplikasi (bisa dipulihkan).')">
  <input type="hidden" name="back" value="<%= back %>">
</form>
<% } %>
<%- scanDialog %>
`;

const IMG_COMPRESS_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/browser-image-compression/2.0.2/browser-image-compression.js';
const IMG_COMPRESS_SRI = 'sha512-AqNGerESFmfQYTtyWZDQv8WSi4ICG16z/O+8JyAD5Iaafp+fnAU4xbJipYZ0bU9DrhXAsx1Vylli0oebd9l55g==';

/**
 * Foto katalog: hanya JPG/PNG/WebP (tampil di app Flutter), dikompres di browser dengan
 * browser-image-compression sampai ≤ 200 KB (JPG tetap JPG; PNG/WebP → WebP agar transparansi
 * aman), lalu dinamai `<nama-asli>-<6 acak a-z0-9>.<ext>`. Server memvalidasi ulang semuanya.
 */
const CATALOG_FORM_JS = `<script src="${IMG_COMPRESS_LIB}" integrity="${IMG_COMPRESS_SRI}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script>
(function(){
  var MAX=200*1024, OK={'image/jpeg':1,'image/png':1,'image/webp':1};
  var f=document.getElementById('photo'), box=document.getElementById('photo-box'), hint=document.getElementById('photo-hint'); if(!f) return;
  var form=document.getElementById('prod-form'), save=form.querySelector('.btn.primary'), busy=false, hintText=hint?hint.textContent:'';
  function kb(n){return (n/1024).toLocaleString('id-ID',{maximumFractionDigits:0})+' KB'}
  function slug(s){return (s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'produk'}
  function rand6(){var c='abcdefghijklmnopqrstuvwxyz0123456789',a=new Uint8Array(6),o='';crypto.getRandomValues(a);for(var i=0;i<6;i++)o+=c[a[i]%36];return o}
  function say(t,bad){if(hint){hint.textContent=t;hint.style.color=bad?'var(--bad)':''}}
  function preview(file){var img=document.getElementById('photo-img');if(!img){box.innerHTML='';img=document.createElement('img');img.id='photo-img';box.appendChild(img)}img.src=URL.createObjectURL(file)}
  function reset(msg){f.value='';say(msg||hintText,!!msg);busy=false;save.disabled=false}
  async function compress(file,type){
    var opt={maxSizeMB:0.19,maxWidthOrHeight:1200,useWebWorker:true,fileType:type,initialQuality:0.85,libURL:'${IMG_COMPRESS_LIB}'};
    var out=await window.imageCompression(file,opt);
    if(out.size>MAX){opt.maxWidthOrHeight=800;opt.initialQuality=0.7;out=await window.imageCompression(file,opt)}
    if(out.size>MAX){opt.maxWidthOrHeight=600;opt.initialQuality=0.6;out=await window.imageCompression(file,opt)}
    return out;
  }
  f.addEventListener('change',async function(){
    if(busy) return;
    var file=f.files&&f.files[0]; if(!file) return reset();
    if(!OK[file.type]) return reset('Format '+(file.type||file.name.split('.').pop())+' tidak bisa ditampilkan di aplikasi. Pakai JPG, PNG, atau WebP.');
    var type=file.type==='image/jpeg'?'image/jpeg':'image/webp', ext=type==='image/jpeg'?'jpg':'webp';
    var name=slug(file.name.replace(/\\.[^.]*$/,''))+'-'+rand6()+'.'+ext;
    busy=true; save.disabled=true; say('Mengompres foto…');
    try{
      var out;
      if(window.imageCompression) out=await compress(file,type);
      else if(file.size<=MAX){out=file;type=file.type;name=name.replace(/\\.[a-z]+$/,'.'+(type==='image/png'?'png':type==='image/webp'?'webp':'jpg'))}
      else return reset('Pustaka kompres gagal dimuat (cek koneksi) dan foto lebih dari 200 KB. Muat ulang halaman lalu coba lagi.');
      if(out.size>MAX) return reset('Foto masih '+kb(out.size)+' setelah dikompres. Pilih foto lain (maks 200 KB).');
      var nf=new File([out],name,{type:type,lastModified:Date.now()}), dt=new DataTransfer(); dt.items.add(nf); f.files=dt.files;
      preview(nf);
      say('✓ '+name+' · '+kb(file.size)+' → '+kb(nf.size)+' (siap diunggah)');
      busy=false; save.disabled=false;
    }catch(e){reset('Gagal mengompres foto: '+(e&&e.message?e.message:e))}
  });
  form.addEventListener('submit',function(e){
    if(e.submitter&&e.submitter.getAttribute('form')==='del-form') return;
    if(busy){e.preventDefault();return}
    var b=form.querySelector('.btn.primary'); b.disabled=true; b.textContent='Menyimpan…';
  });
})();
</script>`;

/**
 * Form produk: tombol "Scan" mengisi kolom barcode dari kamera / foto barcode, dan jenis barcode
 * dikenali otomatis (format pemindai, atau check digit untuk barcode yang diketik). Pilihan jenis
 * yang diubah manual oleh admin tidak ditimpa saat mengetik.
 */
const FORM_SCAN_JS = `<script>
(function(){
  ${detectBarcodeType.toString()}
  var LIB=${JSON.stringify(SCANNER_LIB)};
  var input=document.getElementById('barcode'), sel=document.getElementById('barcodeType'), hint=document.getElementById('barcode-hint');
  var dlg=document.getElementById('scan-dlg'), msg=document.getElementById('scan-msg'), reader=document.getElementById('scan-reader');
  if(!input||!sel||!dlg) return;
  var hintText=hint.textContent, manual=false, scanner=null, done=false;
  var LABEL={EAN13:'EAN-13',EAN8:'EAN-8',UPC:'UPC',QR:'QR code',other:'lainnya'};
  function setType(t,from){
    if(!t) return;
    sel.value=t;
    hint.textContent='Jenis: '+(LABEL[t]||t)+' ('+from+'). Unik di antara produk aktif.';
  }
  sel.addEventListener('change',function(){manual=true;hint.textContent=sel.value?'Jenis dipilih manual. Unik di antara produk aktif.':hintText});
  input.addEventListener('input',function(){
    if(manual) return;
    var t=detectBarcodeType(input.value,null);
    if(t) setType(t,'dari angka yang diketik'); else {sel.value='';hint.textContent=hintText}
  });
  function say(t,err){msg.textContent=t;msg.className='scan-msg'+(err?' err':'');reader.classList.toggle('off',!!err)}
  function loadLib(){return new Promise(function(ok,fail){
    if(window.Html5Qrcode) return ok();
    var s=document.createElement('script');s.src=LIB;s.onload=ok;s.onerror=function(){fail(new Error('Gagal memuat pemindai'))};document.head.appendChild(s);
  })}
  function stop(){
    var s=scanner; scanner=null;
    if(s && s.isScanning) return s.stop().then(function(){s.clear()}).catch(function(){});
    return Promise.resolve();
  }
  function found(text,result){
    if(done) return; done=true;
    var code=String(text||'').trim();
    var fmt=result&&result.result&&result.result.format&&result.result.format.formatName;
    input.value=code; manual=false;
    setType(detectBarcodeType(code,fmt),'hasil scan'+(fmt?' '+fmt:''));
    say('Terbaca: '+code);
    stop().then(function(){dlg.close();input.focus()});
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
    say('Membaca gambar…'); done=false;
    loadLib().then(stop).then(function(){return new Html5Qrcode('scan-reader').scanFileV2(f,false)})
      .then(function(r){found(r.decodedText,r)}).catch(function(){say('Barcode tidak terbaca dari gambar itu. Coba foto yang lebih jelas.',true)});
    e.target.value='';
  });
  function close(){stop().then(function(){dlg.close()})}
  document.getElementById('scan-close').addEventListener('click',close);
  document.getElementById('scan-cancel').addEventListener('click',close);
  dlg.addEventListener('cancel',function(e){e.preventDefault();close()});
})();
</script>`;

export function renderCatalogForm(opts: {
  mode: 'new' | 'edit';
  product: Partial<CatalogDetail>;
  back: string;
  categories: Array<{ category: string; n: number }>;
  error: string | null;
}): string {
  const body = ejs.render(CATALOG_FORM_TPL, {
    scanDialog: SCAN_DIALOG,
    mode: opts.mode,
    p: opts.product,
    back: opts.back,
    categories: opts.categories,
    error: opts.error,
    uncategorized: UNCATEGORIZED,
    ...helpers,
  });
  return renderLayout({
    title: opts.mode === 'new' ? 'Tambah produk' : opts.product.name || 'Edit produk',
    active: 'catalog',
    body,
    serverTime: Date.now(),
    extraJs: CATALOG_FORM_JS + FORM_SCAN_JS,
  });
}

// ── Detail toko ──────────────────────────────────────────────────────────────

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** Nama tabel backup → label Indonesia. */
export const TABLE_LABELS: Record<string, string> = {
  users: 'User/Staff', categories: 'Kategori', units: 'Satuan', customers: 'Pelanggan',
  products: 'Produk', product_variants: 'Varian', wholesale_prices: 'Harga Grosir',
  suppliers: 'Supplier', wallets: 'Dompet/Kas', receipt_presets: 'Template Struk',
  discounts: 'Diskon', app_settings: 'Pengaturan', bills: 'Shift Kasir',
  transactions: 'Transaksi', installments: 'Cicilan', purchases: 'Pembelian',
  stock_opnames: 'Stok Opname', transaction_items: 'Item Transaksi', payments: 'Pembayaran',
  stock_logs: 'Riwayat Stok', wallet_transactions: 'Mutasi Kas', credit_payments: 'Bayar Hutang',
  purchase_items: 'Item Pembelian', stock_opname_items: 'Item Opname',
};

/** Label kolom umum; sisanya camelCase → kata. */
const COL_LABELS: Record<string, string> = {
  name: 'Nama', barcode: 'Barcode', phone: 'Telepon', address: 'Alamat', note: 'Catatan',
  costPrice: 'Harga Modal', sellingPrice: 'Harga Jual', stock: 'Stok', minStock: 'Stok Min',
  expiryDate: 'Kedaluwarsa', isActive: 'Aktif', hasVariants: 'Ada Varian', needsPrice: 'Perlu Harga',
  categoryId: 'Kategori', unitId: 'Satuan', productId: 'Produk', variantId: 'Varian',
  customerId: 'Pelanggan', cashierId: 'Kasir', supplierId: 'Supplier', transactionId: 'Transaksi',
  billId: 'Shift', walletId: 'Dompet', employeeId: 'Karyawan', invoiceNo: 'Invoice',
  datetime: 'Waktu', subtotal: 'Subtotal', discountTotal: 'Diskon', taxTotal: 'Pajak',
  grandTotal: 'Total', paidTotal: 'Dibayar', changeTotal: 'Kembalian', status: 'Status',
  isCredit: 'Kredit', debtBalance: 'Saldo Hutang', balance: 'Saldo', type: 'Jenis',
  amount: 'Jumlah', method: 'Metode', qty: 'Qty', unitPrice: 'Harga Satuan',
  lineTotal: 'Total Baris', nameSnapshot: 'Nama (saat itu)', role: 'Peran', username: 'Username',
  birthdate: 'Tgl Lahir', minQty: 'Min Qty', price: 'Harga', value: 'Nilai', key: 'Kunci',
  dueDate: 'Jatuh Tempo', amountDue: 'Tagihan', amountPaid: 'Terbayar', openedAt: 'Dibuka',
  closedAt: 'Ditutup', openingCash: 'Kas Awal', closingCash: 'Kas Akhir',
  expectedCash: 'Kas Seharusnya', variance: 'Selisih', cashSalesTotal: 'Penjualan Tunai',
  roundingAdjustment: 'Pembulatan', refNo: 'No. Ref', systemQty: 'Stok Sistem',
  physicalQty: 'Stok Fisik', diff: 'Selisih', reason: 'Alasan', permissions: 'Izin',
};

const HIDDEN_COLS = new Set(['pinHash']);

const label = (wire: string) =>
  COL_LABELS[wire] ?? wire.replace(/([A-Z])/g, ' $1').replace(/^./, (ch) => ch.toUpperCase());

const isTimeCol = (wire: string) => /(At|Date|datetime|birthdate)$/.test(wire);

function cell(col: Col, v: unknown, refs?: Record<string, string>): string {
  if (v === null || v === undefined || v === '') return '<span class="mut">—</span>';
  const ref = refs?.[String(v)];
  if (ref) return `<span title="${esc(v)}">${esc(ref)}</span>`;
  switch (col.type) {
    case 'money':
      return `<span style="font-variant-numeric:tabular-nums">${esc(helpers.fmtRp(Number(v)))}</span>`;
    case 'int':
      return isTimeCol(col.wire) ? esc(helpers.fmtDateTime(Number(v))) : esc(helpers.fmtNum(Number(v)));
    case 'bool':
      return v ? '<span class="pill ok">ya</span>' : '<span class="pill">tidak</span>';
    case 'uuid':
      return `<code title="${esc(v)}">${esc(String(v).slice(0, 8))}</code>`;
    case 'json': {
      const t = JSON.stringify(v);
      return `<code>${esc(t.length > 60 ? t.slice(0, 60) + '…' : t)}</code>`;
    }
    case 'enum':
      return `<span class="pill">${esc(v)}</span>`;
    default: {
      const t = String(v);
      return t.length > 80 ? `<span title="${esc(t)}">${esc(t.slice(0, 80))}…</span>` : esc(t);
    }
  }
}

export function bizUrl(id: string, q: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === '' || (k === 'page' && v === 1)) continue;
    p.set(k, String(v));
  }
  const qs = p.toString();
  return `/dashboard/businesses/${id}` + (qs ? `?${qs}` : '');
}

const TABS_JS = `<script>
(function(){
  var t=document.getElementById('biz-tabs'); if(!t) return;
  var l=document.getElementById('tabs-l'), r=document.getElementById('tabs-r');
  function upd(){
    var max=t.scrollWidth-t.clientWidth-1;
    l.hidden=t.scrollLeft<=0; r.hidden=t.scrollLeft>=max;
    t.style.setProperty('--fl', t.scrollLeft>0?'28px':'0px');
    t.style.setProperty('--fr', t.scrollLeft<max?'28px':'0px');
  }
  function by(d){t.scrollBy({left:d*t.clientWidth*0.7,behavior:'smooth'})}
  l.addEventListener('click',function(){by(-1)}); r.addEventListener('click',function(){by(1)});
  t.addEventListener('scroll',upd,{passive:true}); window.addEventListener('resize',upd);
  t.addEventListener('wheel',function(e){ if(Math.abs(e.deltaY)>Math.abs(e.deltaX)&&t.scrollWidth>t.clientWidth){t.scrollLeft+=e.deltaY;e.preventDefault()} },{passive:false});
  var on=t.querySelector('a.on');
  if(on){t.scrollTo({left:on.offsetLeft-(t.clientWidth-on.offsetWidth)/2,behavior:'instant'})}
  upd(); requestAnimationFrame(upd);
})();
</script>`;

/**
 * Kerangka halaman detail toko: profil + tab (sebaris, bisa digeser) + isi.
 * `active` = '' (ringkasan) | 'report' | wire tabel backup.
 */
export function renderBusinessShell(d: BusinessDetail, active: string, main: string, title?: string, extraJs = ''): string {
  const b = d.business;
  const id = String(b.id);
  const total = BUSINESS_TABS.reduce((s, x) => s + (d.counts[x.wire] ?? 0), 0);
  const tax = b.tax_enabled ? `${esc(b.tax_percent)}%${b.tax_inclusive ? ' (termasuk harga)' : ''}` : 'tidak';
  const head = `
<a class="crumb" href="/dashboard/businesses">← Semua toko</a>
<div class="titlebar"><h1>${esc(b.name)}</h1>${b.deleted_at ? '<span class="pill bad">dihapus</span>' : ''}</div>
<div class="panel">
  <div class="biz-head">
    <div><b>ID toko</b><code>${esc(id)}</code></div>
    <div><b>Pemilik</b>${esc(d.owner?.name ?? '—')}</div>
    <div><b>Login pemilik</b>${esc(d.owner?.email ?? d.owner?.phone ?? '—')}</div>
    <div><b>Jenis usaha</b>${esc(b.business_type ?? '—')}</div>
    <div><b>Telepon</b>${esc(b.phone ?? '—')}</div>
    <div><b>Alamat</b>${esc(b.address ?? '—')}</div>
    <div><b>Pajak</b>${tax}</div>
    <div><b>Pembulatan</b>${esc(b.rounding_mode ?? '—')}</div>
    <div><b>Terdaftar</b>${esc(helpers.fmtDateTime(Number(b.created_at)))}</div>
    <div><b>Data terakhir masuk</b>${esc(d.lastBackupAt ? helpers.fmtDateTime(d.lastBackupAt) : 'belum pernah backup')}</div>
    <div><b>Saran dari toko ini</b><a href="/dashboard/feedback?status=semua&amp;business=${esc(id)}">${helpers.fmtNum(d.feedbackCount)} saran →</a></div>
  </div>
</div>`;

  const tabs = `<div class="tabs-wrap">
<button type="button" class="tabs-arrow" id="tabs-l" aria-label="Geser menu ke kiri" hidden>‹</button>
<nav class="tabs" id="biz-tabs" aria-label="Data toko">
  <a class="${active === '' ? 'on' : ''}" href="${bizUrl(id, {})}">Ringkasan <span class="c">${helpers.fmtNum(total)}</span></a>
  <a class="special ${active === 'report' ? 'on' : ''}" href="${bizUrl(id, { tab: 'report' })}">📊 Laporan</a>
  <a class="special ${active === 'points' ? 'on' : ''}" href="${bizUrl(id, { tab: 'points' })}">🪙 Poin</a>
  ${BUSINESS_TABS.map((x) => {
    const n = d.counts[x.wire] ?? 0;
    const cls = [active === x.wire ? 'on' : '', n === 0 ? 'zero' : ''].join(' ').trim();
    return `<a class="${cls}" href="${bizUrl(id, { tab: x.wire })}">${esc(TABLE_LABELS[x.wire] ?? x.wire)} <span class="c">${helpers.fmtNum(n)}</span></a>`;
  }).join('')}
</nav>
<button type="button" class="tabs-arrow" id="tabs-r" aria-label="Geser menu ke kanan">›</button>
</div>`;

  return renderLayout({
    title: title ?? String(b.name ?? 'Toko'),
    active: 'businesses',
    body: head + tabs + main,
    serverTime: d.serverTime,
    extraJs: TABS_JS + extraJs,
  });
}

export function renderBusinessDetail(d: BusinessDetail, t: BusinessTablePage | null): string {
  const id = String(d.business.id);
  let main: string;
  if (!t) {
    main = `<h2>Data tersimpan di server</h2>
<div class="counts">${BUSINESS_TABS.map((x) => {
      const n = d.counts[x.wire] ?? 0;
      return `<a class="${n === 0 ? 'zero' : ''}" href="${bizUrl(id, { tab: x.wire })}"><div class="n">${helpers.fmtNum(n)}</div><div class="l">${esc(TABLE_LABELS[x.wire] ?? x.wire)}</div></a>`;
    }).join('')}</div>
<p class="mut" style="font-size:12px;margin-top:14px">Hitungan = baris aktif (tidak termasuk yang dihapus di aplikasi). Data ini cermin cadangan dari aplikasi toko — hanya-baca.</p>`;
  } else {
    const cols = t.table.cols.filter((c) => !HIDDEN_COLS.has(c.wire));
    const timeCol: Col = { wire: 'updatedAt', db: 'updated_at', type: 'int' };
    const delCol: Col = { wire: 'deletedAt', db: 'deleted_at', type: 'int' };
    const shown = [...cols, t.deleted ? delCol : timeCol];
    const isTx = t.table.wire === 'transactions';
    const txUrl = (r: Record<string, unknown>) => `/dashboard/businesses/${id}/transactions/${esc(r.id)}`;
    const rows = t.items
      .map((r) => {
        const idCell = cell({ wire: 'id', db: 'id', type: 'uuid' }, r.id);
        const tds = shown.map((c) => `<td>${cell(c, r[c.db], t.refs[c.wire])}</td>`).join('');
        return isTx
          ? `<tr class="rowlink" onclick="location.href='${txUrl(r)}'"><td><a class="mini" href="${txUrl(r)}">Detail →</a></td><td><a href="${txUrl(r)}">${idCell}</a></td>${tds}</tr>`
          : `<tr><td>${idCell}</td>${tds}</tr>`;
      })
      .join('');
    const name = TABLE_LABELS[t.table.wire] ?? t.table.wire;
    const toggle = t.deleted
      ? `<a class="btn-link" href="${bizUrl(id, { tab: t.table.wire })}">← Data aktif</a>`
      : `<a class="btn-link" href="${bizUrl(id, { tab: t.table.wire, deleted: 1 })}">🗑 Lihat yang dihapus</a>`;
    main = `<div class="h2row"><h2>${esc(name)}${t.deleted ? ' — dihapus' : ''}</h2>${toggle}</div>
<div class="tablewrap biztable">${
      t.items.length === 0
        ? `<div class="empty">${t.deleted ? 'Tidak ada data terhapus.' : 'Belum ada data.'}</div>`
        : `<table><thead><tr>${isTx ? '<th></th>' : ''}<th>ID</th>${shown.map((c) => `<th>${esc(c === delCol ? 'Dihapus' : c === timeCol ? 'Diubah' : label(c.wire))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`
    }</div>
${pagerHtml(t.page, t.pages, t.total, (pg) => bizUrl(id, { tab: t.table.wire, deleted: t.deleted ? 1 : undefined, page: pg }))}`;
  }

  return renderBusinessShell(d, t ? t.table.wire : '', main);
}
