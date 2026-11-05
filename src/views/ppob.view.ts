import type { PpobConfig } from '../services/ppob.service.js';
import { esc, helpers, pagerHtml, renderLayout } from './dashboard.view.js';

/** Halaman admin PPOB: order, detail order, produk & harga, pengaturan markup. */

const rp = (v: number | null | undefined) => (v == null ? '—' : esc(helpers.fmtRp(v)));
const dt = (v: number | null | undefined) => (v ? esc(helpers.fmtDateTime(v)) : '—');

const STATUS: Record<string, { label: string; cls: string }> = {
  processing: { label: 'Diproses', cls: 'warn' },
  pending: { label: 'Pending', cls: 'warn' },
  waiting_admin: { label: 'Menunggu admin', cls: 'warn' },
  success: { label: 'Sukses', cls: 'ok' },
  failed: { label: 'Gagal', cls: 'bad' },
};
const pill = (s: string) => {
  const x = STATUS[s] ?? { label: s, cls: '' };
  return `<span class="pill ${x.cls}">${x.label}</span>`;
};
const CAT: Record<string, string> = { pulsa: 'Pulsa', data: 'Paket data', pln: 'Token PLN' };

const CSS = `<style>
  .pp-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
  .pp-tabs a{padding:6px 14px;border-radius:999px;border:1px solid var(--line);color:var(--tx);background:var(--card);font-size:13px;font-weight:600}
  .pp-tabs a.on{background:var(--acc);border-color:var(--acc);color:var(--acc-tx)}
  .pp-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
  .pp-row form{display:flex;gap:6px;flex-wrap:wrap}
  .pp-row input,.pp-row select,.pinline input{background:var(--card);border:1px solid var(--line);color:var(--tx);border-radius:8px;padding:7px 10px;font:inherit;font-size:13px}
  .pinline{display:flex;gap:4px;align-items:center;justify-content:flex-end}
  .pinline input{width:100px;padding:5px 8px}
  .mini.bad{color:var(--bad)} .mini.ok{color:var(--ok)}
  tr.off td{opacity:.5}
  .ev{display:grid;grid-template-columns:150px 1fr;gap:4px 12px;font-size:13px}
  .ev code{font-size:11px;white-space:pre-wrap;word-break:break-all}
  .kv2{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px 16px;font-size:13px}
  .kv2 b{display:block;color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  .sn{font-size:18px;font-weight:800;letter-spacing:.03em}
  .stmt{width:100%;min-width:0;border-collapse:collapse}
  .stmt td{padding:6px 0;border-bottom:1px dashed var(--line);font-size:13px}
  .stmt td.v{text-align:right;font-variant-numeric:tabular-nums}
</style>`;

const tabs = (on: string, attention: number) => `<div class="pp-tabs">
  <a class="${on === 'orders' ? 'on' : ''}" href="/dashboard/ppob">Order${attention ? ` <span class="nb">${attention}</span>` : ''}</a>
  <a class="${on === 'products' ? 'on' : ''}" href="/dashboard/ppob?tab=products">Produk &amp; harga</a>
  <a class="${on === 'settings' ? 'on' : ''}" href="/dashboard/ppob?tab=settings">Pengaturan</a>
</div>`;

function depositCard(dep: { value: number | null; error: string | null }, enabled: boolean): string {
  return `<div class="kpi"><div class="n">${dep.value == null ? '—' : rp(dep.value)}</div>
  <div class="l">Deposit Digiflazz${dep.error ? ` · <span style="color:var(--bad)">${esc(dep.error)}</span>` : ''}</div>
  <div class="l">${enabled ? 'PPOB <b style="color:var(--ok)">aktif</b>' : 'PPOB <b style="color:var(--bad)">nonaktif</b> (PPOB_ENABLED)'}</div></div>`;
}

// ── Order ────────────────────────────────────────────────────────────────────

export interface OrderListData {
  items: Array<{
    id: string; businessId: string; businessName?: string | null; category: string; productName: string;
    customerNo: string; price: number; cost: number; providerPrice: number | null; status: string; refunded: boolean;
    sn: string | null; createdAt: number;
  }>;
  total: number; page: number; pages: number; counts: Record<string, number>;
  totals: { omzet: number; laba: number };
  status: string; category: string; q: string;
}

export function renderPpobOrders(d: OrderListData, extra: { deposit: { value: number | null; error: string | null }; enabled: boolean; attention: number; serverTime: number }): string {
  const url = (o: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const v = { status: d.status, category: d.category, q: d.q, ...o };
    for (const [k, x] of Object.entries(v)) if (x !== undefined && x !== '' && !(k === 'page' && String(x) === '1') && !(k === 'status' && x === 'semua')) p.set(k, String(x));
    const s = p.toString();
    return '/dashboard/ppob' + (s ? `?${s}` : '');
  };
  const sub = ['semua', 'success', 'pending', 'processing', 'waiting_admin', 'failed']
    .map((s) => `<a class="${d.status === s ? 'on' : ''}" href="${esc(url({ status: s, page: undefined }))}">${s === 'semua' ? 'Semua' : STATUS[s]!.label} (${helpers.fmtNum(d.counts[s] ?? 0)})</a>`)
    .join('');
  const cats = ['', 'pulsa', 'data', 'pln']
    .map((c) => `<a class="chip ${d.category === c ? 'on' : ''}" href="${esc(url({ category: c || undefined, page: undefined }))}">${c ? CAT[c] : 'Semua jenis'}</a>`)
    .join('');
  const rows = d.items
    .map((o) => {
      const href = `/dashboard/ppob/orders/${esc(o.id)}`;
      const margin = o.status === 'success' ? o.price - (o.providerPrice ?? o.cost) : null;
      return `<tr class="rowlink" onclick="location.href='${href}'">
        <td class="mut">${dt(o.createdAt)}</td>
        <td><a href="/dashboard/businesses/${esc(o.businessId)}?tab=points" onclick="event.stopPropagation()" style="color:var(--tx)">${esc(o.businessName ?? '—')}</a></td>
        <td>${esc(o.productName)}<br><span class="mut" style="font-size:11px">${esc(CAT[o.category] ?? o.category)}</span></td>
        <td><code>${esc(o.customerNo)}</code></td>
        <td class="num">${rp(o.price)}</td>
        <td class="num">${margin == null ? '<span class="mut">—</span>' : rp(margin)}</td>
        <td>${pill(o.status)}${o.refunded ? ' <span class="pill">refund</span>' : ''}</td>
        <td><a class="mini" href="${href}">Detail →</a></td></tr>`;
    })
    .join('');
  const body = `${CSS}<div class="titlebar"><h1>PPOB</h1></div>${tabs('orders', extra.attention)}
<div class="grid" style="margin-bottom:14px">
  <div class="kpi"><div class="n">${rp(d.totals.omzet)}</div><div class="l">Penjualan sukses (Poin)</div></div>
  <div class="kpi"><div class="n">${rp(d.totals.laba)}</div><div class="l">Laba Sirko (jual − modal)</div></div>
  ${depositCard(extra.deposit, extra.enabled)}
</div>
<div class="subnav">${sub}</div>
<div class="pp-row"><div class="chips">${cats}</div>
  <form method="get" action="/dashboard/ppob" style="margin-left:auto">
    <input type="hidden" name="status" value="${esc(d.status)}"><input type="hidden" name="category" value="${esc(d.category)}">
    <input type="search" name="q" value="${esc(d.q)}" placeholder="No tujuan / toko / produk / ID order"><button class="btn ghost" type="submit">Cari</button>
  </form></div>
<div class="tablewrap"><table>
<thead><tr><th>Waktu</th><th>Toko</th><th>Produk</th><th>Tujuan</th><th class="num">Harga</th><th class="num">Laba</th><th>Status</th><th></th></tr></thead>
<tbody>${rows || '<tr><td colspan="8" class="empty">Belum ada order pada filter ini.</td></tr>'}</tbody></table></div>
${pagerHtml(d.page, d.pages, d.total, (p) => esc(url({ page: p })))}`;
  return renderLayout({ title: 'PPOB', active: 'ppob', body, serverTime: extra.serverTime });
}

export interface OrderDetailData {
  order: {
    id: string; clientRef: string; businessId: string; businessName?: string | null; category: string; brand: string | null;
    productName: string; sku: string; customerNo: string; price: number; cost: number; providerPrice: number | null;
    status: string; refunded: boolean; sn: string | null; rc: string | null; rawMessage: string | null;
    createdAt: number; completedAt: number | null; lastCheckedAt: number | null;
  };
  events: Array<{ event: string; detail: unknown; createdAt: number }>;
  ledger: Array<{ type: string; amount: number; balanceAfter: number; createdAt: number }>;
}

export function renderPpobOrderDetail(d: OrderDetailData, extra: { attention: number; serverTime: number }): string {
  const o = d.order;
  const canCheck = (o.status === 'pending' || o.status === 'processing') && o.category !== 'pln';
  const body = `${CSS}<a class="crumb" href="/dashboard/ppob">← Semua order PPOB</a>
<div class="titlebar"><h1 style="font-size:17px">${esc(o.productName)} → <code>${esc(o.customerNo)}</code></h1>${pill(o.status)}</div>
<div class="tx-grid" style="display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:12px;align-items:start">
  <div>
    <div class="panel"><div class="kv2">
      <div><b>Toko</b><a href="/dashboard/businesses/${esc(o.businessId)}?tab=points">${esc(o.businessName ?? '—')}</a></div>
      <div><b>Jenis</b>${esc(CAT[o.category] ?? o.category)} · ${esc(o.brand ?? '')}</div>
      <div><b>SKU</b><code>${esc(o.sku)}</code></div>
      <div><b>Dibuat</b>${dt(o.createdAt)}</div>
      <div><b>Selesai</b>${dt(o.completedAt)}</div>
      <div><b>Cek terakhir</b>${dt(o.lastCheckedAt)}</div>
      <div><b>ID order (ref_id)</b><code>${esc(o.id)}</code></div>
      <div><b>clientRef</b><code>${esc(o.clientRef)}</code></div>
      ${o.rc || o.rawMessage ? `<div style="grid-column:1/-1"><b>Balasan penyedia</b>RC ${esc(o.rc ?? '—')} · ${esc(o.rawMessage ?? '')}</div>` : ''}
    </div></div>
    ${o.sn ? `<div class="panel" style="margin-top:12px"><h3>${o.category === 'pln' ? 'Token listrik' : 'Serial number (SN)'}</h3><div class="sn">${esc(o.sn)}</div></div>` : ''}
    <h2>Jejak kejadian</h2>
    <div class="panel"><div class="ev">${d.events.map((e) => `<span class="mut">${dt(e.createdAt)}</span><span><b>${esc(e.event)}</b>${e.detail ? `<br><code>${esc(JSON.stringify(e.detail))}</code>` : ''}</span>`).join('') || '<span class="mut">—</span>'}</div></div>
  </div>
  <div class="panel">
    <h3>Nilai</h3>
    <table class="stmt">
      <tr><td>Harga Poin (dibayar toko)</td><td class="v">${rp(o.price)}</td></tr>
      <tr><td>Modal saat order</td><td class="v">${rp(o.cost)}</td></tr>
      <tr><td>Harga riil penyedia</td><td class="v">${rp(o.providerPrice)}</td></tr>
      <tr><td>Laba Sirko</td><td class="v">${o.status === 'success' ? rp(o.price - (o.providerPrice ?? o.cost)) : '—'}</td></tr>
    </table>
    <h3 style="margin-top:14px">Mutasi Poin</h3>
    <table class="stmt">${d.ledger.map((l) => `<tr><td>${esc(l.type)} · ${dt(l.createdAt)}</td><td class="v">${l.amount > 0 ? '+' : ''}${rp(l.amount)}</td></tr>`).join('') || '<tr><td class="mut">—</td></tr>'}</table>
    ${canCheck ? `<form method="post" action="/dashboard/ppob/orders/${esc(o.id)}/check" style="margin-top:14px"><button class="btn primary" type="submit">↻ Cek status ke Digiflazz</button><div class="mut" style="font-size:11px;margin-top:6px">Maks 1× per menit per order (aturan Digiflazz).</div></form>` : ''}
  </div>
</div>`;
  return renderLayout({ title: `Order PPOB`, active: 'ppob', body, serverTime: extra.serverTime });
}

// ── Produk ───────────────────────────────────────────────────────────────────

export interface ProductListData {
  items: Array<{ id: string; sku: string; category: string; brand: string; name: string; cost: number; price: number; locked: boolean; active: boolean; providerActive: boolean; cutoff: string | null }>;
  total: number; page: number; pages: number; brands: Array<{ brand: string; c: number }>; lastSyncAt: number | null;
  category: string; brand: string; q: string;
}

export function renderPpobProducts(d: ProductListData, extra: { attention: number; serverTime: number; configured: boolean }): string {
  const url = (o: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams({ tab: 'products' });
    const v = { category: d.category, brand: d.brand, q: d.q, ...o };
    for (const [k, x] of Object.entries(v)) if (x !== undefined && x !== '' && !(k === 'page' && String(x) === '1')) p.set(k, String(x));
    return '/dashboard/ppob?' + p.toString();
  };
  const self = url({ page: d.page });
  const rows = d.items
    .map(
      (p) => `<tr class="${p.active && p.providerActive ? '' : 'off'}">
      <td>${esc(p.name)}<br><code style="font-size:11px">${esc(p.sku)}</code>${p.cutoff ? ` <span class="mut" style="font-size:11px">cut-off ${esc(p.cutoff)}</span>` : ''}</td>
      <td>${esc(CAT[p.category] ?? p.category)}</td><td>${esc(p.brand)}</td>
      <td class="num">${rp(p.cost)}</td>
      <td class="num"><b>${rp(p.price)}</b>${p.locked ? ' <span class="pill warn" title="Harga dikunci admin">kunci</span>' : ''}<br><span class="mut" style="font-size:11px">laba ${rp(p.price - p.cost)}</span></td>
      <td>${p.providerActive ? '' : '<span class="pill bad">kosong di penyedia</span> '}${p.active ? '<span class="pill ok">dijual</span>' : '<span class="pill">disembunyikan</span>'}</td>
      <td><form class="pinline" method="post" action="/dashboard/ppob/products/${esc(p.id)}">
        <input type="hidden" name="back" value="${esc(self)}">
        <input name="price" type="number" min="${p.cost}" step="1" placeholder="harga" aria-label="Harga jual baru">
        <button class="mini" name="op" value="price" type="submit">Set</button>
        ${p.locked ? '<button class="mini" name="op" value="unlock" type="submit" title="Kembali ke harga otomatis">Auto</button>' : ''}
        <button class="mini ${p.active ? 'bad' : 'ok'}" name="op" value="${p.active ? 'hide' : 'show'}" type="submit">${p.active ? 'Sembunyikan' : 'Jual'}</button>
      </form></td></tr>`,
    )
    .join('');
  const brandOpts = ['', ...d.brands.map((b) => b.brand)]
    .map((b) => `<option value="${esc(b)}" ${d.brand === b ? 'selected' : ''}>${b ? esc(b) : 'Semua operator'}</option>`)
    .join('');
  const body = `${CSS}<div class="titlebar"><h1>PPOB</h1></div>${tabs('products', extra.attention)}
<div class="pp-row">
  <form method="post" action="/dashboard/ppob/sync" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Menyinkron…'">
    <button class="btn primary" type="submit" ${extra.configured ? '' : 'disabled title="Digiflazz belum dikonfigurasi"'}>⟳ Sinkron harga Digiflazz</button>
  </form>
  <span class="mut" style="font-size:12px">Terakhir: ${dt(d.lastSyncAt)} · maks 1× per 5 menit · harga terkunci tak ditimpa</span>
</div>
<div class="pp-row"><form method="get" action="/dashboard/ppob">
  <input type="hidden" name="tab" value="products">
  <select name="category"><option value="">Semua jenis</option><option value="pulsa" ${d.category === 'pulsa' ? 'selected' : ''}>Pulsa</option><option value="data" ${d.category === 'data' ? 'selected' : ''}>Paket data</option></select>
  <select name="brand">${brandOpts}</select>
  <input type="search" name="q" value="${esc(d.q)}" placeholder="Nama / SKU">
  <button class="btn ghost" type="submit">Terapkan</button></form></div>
<div class="tablewrap"><table>
<thead><tr><th>Produk</th><th>Jenis</th><th>Operator</th><th class="num">Modal</th><th class="num">Harga Poin</th><th>Status</th><th></th></tr></thead>
<tbody>${rows || '<tr><td colspan="7" class="empty">Belum ada produk. Klik "Sinkron harga Digiflazz".</td></tr>'}</tbody></table></div>
${pagerHtml(d.page, d.pages, d.total, (p) => esc(url({ page: p })))}`;
  return renderLayout({ title: 'Produk PPOB', active: 'ppob', body, serverTime: extra.serverTime });
}

export function renderPpobSettings(cfg: PpobConfig, extra: { attention: number; serverTime: number; error: string | null }): string {
  const f = (name: keyof PpobConfig, label: string, hint = '') =>
    `<div class="f"><label for="${name}">${label}</label><input type="number" min="0" step="1" id="${name}" name="${name}" value="${esc(cfg[name])}">${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  const body = `${CSS}<div class="titlebar"><h1>PPOB</h1></div>${tabs('settings', extra.attention)}
${extra.error ? `<div class="flash err" role="alert">${esc(extra.error)}</div>` : ''}
<form method="post" action="/dashboard/ppob/settings" class="panel" style="max-width:760px">
  <h3>Markup harga jual (Poin = modal + markup, dibulatkan ke atas)</h3>
  <div class="fields">
    ${f('markupPulsa', 'Markup pulsa (Rp)')}
    ${f('markupData', 'Markup paket data (Rp)')}
    ${f('markupPln', 'Markup token PLN (Rp)', 'Dipakai tahap token manual.')}
    ${f('roundTo', 'Bulatkan ke kelipatan (Rp)', 'mis. 100 → 10.650 jadi 10.700')}
    ${f('lowDepositAlert', 'Alarm deposit Digiflazz di bawah (Rp)')}
  </div>
  <div class="form-actions"><button class="btn primary" type="submit">Simpan &amp; hitung ulang harga</button></div>
  <div class="mut" style="font-size:12px;margin-top:8px">Menyimpan akan menghitung ulang harga semua produk yang <b>tidak</b> dikunci.</div>
</form>`;
  return renderLayout({ title: 'Pengaturan PPOB', active: 'ppob', body, serverTime: extra.serverTime });
}
