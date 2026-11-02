import type { BusinessDetail } from '../services/dashboard.service.js';
import { REPORT_PRESETS, type StoreReport, type TransactionDetail } from '../services/store-report.service.js';
import { bizUrl, esc, helpers, renderBusinessShell } from './dashboard.view.js';

/**
 * Halaman detail toko lanjutan: Laporan (laba rugi dll.) & detail satu transaksi.
 * Memakai kerangka `renderBusinessShell` (profil + tab yang bisa digeser).
 */

const rp = (v: unknown) => esc(helpers.fmtRp(Number(v ?? 0)));
const num = (v: unknown) => esc(helpers.fmtNum(Number(v ?? 0)));
const dt = (v: unknown) => (v == null ? '—' : esc(helpers.fmtDateTime(Number(v))));
const dash = '<span class="mut">—</span>';

const METHOD_LABEL: Record<string, string> = {
  cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer', debit: 'Kartu Debit', ewallet: 'E-wallet', other: 'Lainnya',
};
const STATUS: Record<string, { label: string; cls: string }> = {
  paid: { label: 'Lunas', cls: 'ok' },
  partial: { label: 'Bayar sebagian', cls: 'warn' },
  credit: { label: 'Hutang', cls: 'warn' },
  void: { label: 'Dibatalkan', cls: 'bad' },
};
const INST_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Belum bayar', cls: 'warn' },
  paid: { label: 'Lunas', cls: 'ok' },
  overdue: { label: 'Terlambat', cls: 'bad' },
};
const pill = (map: Record<string, { label: string; cls: string }>, v: unknown) => {
  const s = map[String(v)];
  return s ? `<span class="pill ${s.cls}">${s.label}</span>` : `<span class="pill">${esc(v ?? '—')}</span>`;
};

const PAGE_CSS = `<style>
  .rep-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}
  .rep-bar form{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-left:auto}
  .rep-bar input[type=date]{background:var(--card);border:1px solid var(--line);color:var(--tx);border-radius:8px;padding:6px 8px;font:inherit;font-size:13px}
  .rep-range{font-size:13px;color:var(--mut);margin:-4px 0 14px}
  .kpi .sub{font-size:12px;color:var(--mut);margin-top:2px}
  .kpi.good .n{color:var(--ok)} .kpi.badn .n{color:var(--bad)}
  .two{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;margin-top:12px}
  .stmt{width:100%;border-collapse:collapse;min-width:0}
  .stmt td{padding:7px 0;border-bottom:1px dashed var(--line);font-size:14px}
  .stmt td.v{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .stmt tr.sum td{border-bottom:1px solid var(--line);font-weight:700}
  .stmt tr.total td{border-bottom:0;font-weight:800;font-size:16px;padding-top:10px}
  .stmt tr.info td{color:var(--mut);font-size:12px;border-bottom:0;padding:4px 0}
  .stmt .neg{color:var(--bad)}
  .warn-note{margin-top:10px;font-size:12px;color:var(--warn)}
  .tx-grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:12px;align-items:start}
  .tx-info{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px 16px;font-size:13px}
  .tx-info b{display:block;color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  .settle{font-size:15px;font-weight:800;margin-top:8px;padding:10px 12px;border-radius:10px;text-align:center}
  .settle.ok{color:var(--ok);border:1px solid var(--ok-line)} .settle.due{color:var(--warn);border:1px solid var(--warn-line)}
  @media (max-width:860px){.tx-grid{grid-template-columns:1fr}}
</style>`;

// ── Laporan ──────────────────────────────────────────────────────────────────

export function renderStoreReport(d: BusinessDetail, r: StoreReport): string {
  const id = String(d.business.id);
  const R = r.range;
  const p = r.profit;
  const s = r.status;
  const presets = REPORT_PRESETS.map(
    (x) => `<a class="chip ${R.preset === x.key ? 'on' : ''}" href="${bizUrl(id, { tab: 'report', preset: x.key })}">${x.label}</a>`,
  ).join('');
  const fmtDay = (ymd: string) => esc(helpers.fmtDate(Date.parse(`${ymd}T12:00:00+07:00`)));
  const neg = (v: number) => (v ? `<span class="neg">− ${rp(v)}</span>` : rp(0));

  const statusRow = (label: string, x: { count: number; total: number }) =>
    `<tr><td>${label} <span class="mut">(${num(x.count)})</span></td><td class="v">${rp(x.total)}</td></tr>`;

  const main = `${PAGE_CSS}
<div class="h2row"><h2>Laporan toko</h2></div>
<div class="rep-bar">
  <div class="chips">${presets}</div>
  <form method="get" action="/dashboard/businesses/${esc(id)}">
    <input type="hidden" name="tab" value="report">
    <label class="sr" for="rf">Dari</label><input type="date" id="rf" name="from" value="${esc(R.from)}" required>
    <span class="mut">s/d</span>
    <label class="sr" for="rt">Sampai</label><input type="date" id="rt" name="to" value="${esc(R.to)}" required>
    <button class="btn ghost" type="submit">Terapkan</button>
  </form>
</div>
<div class="rep-range">Periode: <b>${fmtDay(R.from)}</b> – <b>${fmtDay(R.to)}</b> (WIB) · dari data yang sudah dibackup toko</div>

<div class="grid">
  <div class="kpi"><div class="n">${rp(r.sales.omzet)}</div><div class="l">Omzet (total nota)</div></div>
  <div class="kpi"><div class="n">${num(r.sales.txCount)}</div><div class="l">Transaksi</div><div class="sub">rata-rata ${rp(r.sales.avgTicket)}</div></div>
  <div class="kpi"><div class="n">${num(r.sales.itemCount)}</div><div class="l">Item terjual</div></div>
  <div class="kpi ${p.grossProfit >= 0 ? 'good' : 'badn'}"><div class="n">${rp(p.grossProfit)}</div><div class="l">Laba kotor</div><div class="sub">${p.marginPct == null ? '—' : `margin ${String(p.marginPct).replace('.', ',')}%`}</div></div>
  <div class="kpi"><div class="n">${rp(s.outstanding)}</div><div class="l">Piutang (belum dibayar)</div></div>
</div>

<div class="two">
  <div class="panel">
    <h3>Laba rugi</h3>
    <table class="stmt">
      <tr><td>Penjualan kotor <span class="mut">(Σ subtotal item)</span></td><td class="v">${rp(p.grossSales)}</td></tr>
      <tr><td>Diskon transaksi</td><td class="v">${neg(p.txDiscount)}</td></tr>
      <tr class="sum"><td>Pendapatan bersih</td><td class="v">${rp(p.revenue)}</td></tr>
      <tr><td>Harga pokok penjualan (HPP)</td><td class="v">${neg(p.cogs)}</td></tr>
      <tr class="total"><td>Laba kotor</td><td class="v" style="color:var(${p.grossProfit >= 0 ? '--ok' : '--bad'})">${rp(p.grossProfit)}</td></tr>
      <tr class="info"><td>Pajak dipungut (di luar pendapatan)</td><td class="v">${rp(p.tax)}</td></tr>
      <tr class="info"><td>Pembulatan</td><td class="v">${rp(p.rounding)}</td></tr>
    </table>
    ${p.itemsWithoutCost ? `<div class="warn-note">⚠ ${num(p.itemsWithoutCost)} item terjual tanpa harga modal — HPP dianggap 0, laba bisa terlalu tinggi.</div>` : ''}
    <div class="mut" style="font-size:12px;margin-top:10px">Rumus sama dengan laporan di aplikasi: HPP memakai harga modal saat transaksi; transaksi dibatalkan tidak dihitung. Belum termasuk biaya operasional.</div>
  </div>
  <div>
    <div class="panel">
      <h3>Status pembayaran</h3>
      <table class="stmt">
        ${statusRow('Lunas', s.paid)}
        ${statusRow('Bayar sebagian', s.partial)}
        ${statusRow('Hutang', s.credit)}
        <tr class="sum"><td>Sisa piutang dari periode ini</td><td class="v">${rp(s.outstanding)}</td></tr>
        <tr class="info"><td>Dibatalkan (tidak dihitung) · ${num(s.voidCount)} nota</td><td class="v">${rp(s.voidTotal)}</td></tr>
      </table>
    </div>
    <div class="panel" style="margin-top:12px">
      <h3>Uang masuk</h3>
      <table class="stmt">
        ${r.cashIn.byMethod.map((m) => `<tr><td>${esc(METHOD_LABEL[m.method] ?? m.method)}${m.method === 'cash' ? ' <span class="mut">(bersih kembalian)</span>' : ''}</td><td class="v">${rp(m.total)}</td></tr>`).join('') || `<tr class="info"><td>Belum ada pembayaran</td><td></td></tr>`}
        <tr><td>Pelunasan hutang pelanggan</td><td class="v">${rp(r.cashIn.debtPayments)}</td></tr>
        <tr class="total"><td>Total uang masuk</td><td class="v">${rp(r.cashIn.total)}</td></tr>
      </table>
    </div>
  </div>
</div>

<div class="two">
  <div>
    <h2>Produk terlaris</h2>
    <div class="tablewrap"><table style="min-width:420px">
      <thead><tr><th>Produk</th><th class="num">Qty</th><th class="num">Penjualan</th><th class="num">Laba</th></tr></thead>
      <tbody>${r.topProducts.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${num(x.qty)}</td><td class="num">${rp(x.revenue)}</td><td class="num">${rp(x.profit)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Belum ada penjualan.</td></tr>'}</tbody>
    </table></div>
  </div>
  <div>
    <h2>Per hari</h2>
    <div class="tablewrap"><table style="min-width:380px">
      <thead><tr><th>Tanggal</th><th class="num">Nota</th><th class="num">Omzet</th><th class="num">Laba</th></tr></thead>
      <tbody>${r.daily.map((x) => `<tr><td>${fmtDay(x.day)}</td><td class="num">${num(x.txCount)}</td><td class="num">${rp(x.omzet)}</td><td class="num">${rp(x.profit)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Belum ada transaksi.</td></tr>'}</tbody>
    </table></div>
  </div>
</div>`;
  return renderBusinessShell(d, 'report', main, `Laporan · ${String(d.business.name ?? 'Toko')}`);
}

// ── Detail transaksi ─────────────────────────────────────────────────────────

export function renderTransactionDetail(d: BusinessDetail, x: TransactionDetail): string {
  const id = String(d.business.id);
  const t = x.tx;
  const deleted = (r: Record<string, unknown>) => r.deleted_at != null;
  const delTag = (r: Record<string, unknown>) => (deleted(r) ? ' <span class="pill bad">dihapus</span>' : '');
  const S = x.summary;
  const isVoid = t.status === 'void';
  const back = bizUrl(id, { tab: 'transactions' });

  const items = x.items
    .map((r) => {
      const profit = (Number(r.unit_price ?? 0) - Number(r.cost_price_snapshot ?? 0)) * Number(r.qty ?? 0) - Number(r.discount ?? 0);
      return `<tr${deleted(r) ? ' style="opacity:.55"' : ''}>
        <td>${esc(r.name_snapshot ?? '—')}${r.variantName ? ` <span class="mut">· ${esc(r.variantName)}</span>` : ''}${delTag(r)}</td>
        <td class="num">${num(r.qty)}</td><td class="num">${rp(r.unit_price)}</td>
        <td class="num">${Number(r.discount ?? 0) ? `− ${rp(r.discount)}` : dash}</td>
        <td class="num"><b>${rp(r.line_total)}</b></td>
        <td class="num mut">${r.cost_price_snapshot == null ? '<span class="pill warn">tanpa modal</span>' : rp(r.cost_price_snapshot)}</td>
        <td class="num">${rp(profit)}</td></tr>`;
    })
    .join('');

  const payments = x.payments
    .map(
      (r) => `<tr><td>${esc(METHOD_LABEL[String(r.method)] ?? r.method ?? '—')}${delTag(r)}</td><td class="num">${rp(r.amount)}</td>
        <td>${r.ref_note ? esc(r.ref_note) : dash}</td><td class="mut">${dt(r.created_at)}</td></tr>`,
    )
    .join('');

  const installments = x.installments
    .map(
      (r) => `<tr><td>${dt(r.due_date)}${delTag(r)}</td><td class="num">${rp(r.amount_due)}</td><td class="num">${rp(r.amount_paid)}</td>
        <td>${pill(INST_STATUS, r.status)}</td></tr>`,
    )
    .join('');

  const credits = x.creditPayments
    .map(
      (r) => `<tr><td>${dt(r.datetime)}${delTag(r)}</td><td class="num"><b>${rp(r.amount)}</b></td>
        <td>${esc(METHOD_LABEL[String(r.method)] ?? r.method ?? '—')}</td><td>${r.note ? esc(r.note) : dash}</td></tr>`,
    )
    .join('');

  const section = (title: string, head: string, body: string, empty: string) =>
    `<h2>${title}</h2><div class="tablewrap"><table style="min-width:480px"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="7" class="empty">${empty}</td></tr>`}</tbody></table></div>`;

  const main = `${PAGE_CSS}
<a class="crumb" href="${back}">← Semua transaksi toko ini</a>
<div class="titlebar"><h1 style="font-size:17px">Nota <code style="font-size:16px">${esc(t.invoice_no ?? String(t.id).slice(0, 8))}</code></h1>${pill(STATUS, t.status)}</div>
${isVoid ? '<div class="notice"><b>Transaksi dibatalkan (void).</b> Tidak dihitung di omzet maupun laba.</div>' : ''}
${t.deleted_at ? `<div class="notice"><b>Transaksi dihapus</b> di aplikasi pada ${dt(t.deleted_at)}.</div>` : ''}
<div class="tx-grid">
  <div>
    <div class="panel"><div class="tx-info">
      <div><b>Waktu</b>${dt(t.datetime)}</div>
      <div><b>Kasir</b>${esc(x.cashierName ?? '—')}</div>
      <div><b>Pelanggan</b>${x.customer ? `${esc(x.customer.name ?? '—')}${x.customer.phone ? ` <span class="mut">· ${esc(x.customer.phone)}</span>` : ''}` : 'Umum'}</div>
      <div><b>Jenis</b>${t.is_credit ? 'Kredit / hutang' : 'Tunai / langsung'}</div>
      <div><b>Shift</b>${t.bill_id ? `<code>${esc(String(t.bill_id).slice(0, 8))}</code>` : '—'}</div>
      <div><b>ID</b><code>${esc(t.id)}</code></div>
      ${t.note ? `<div style="grid-column:1/-1"><b>Catatan</b>${esc(t.note)}</div>` : ''}
    </div></div>
    ${section('Item dibeli', '<th>Produk</th><th class="num">Qty</th><th class="num">Harga</th><th class="num">Diskon</th><th class="num">Subtotal</th><th class="num">Modal/unit</th><th class="num">Laba</th>', items, 'Tidak ada item.')}
    ${section('Pembayaran saat transaksi', '<th>Metode</th><th class="num">Jumlah</th><th>Referensi</th><th>Waktu</th>', payments, 'Tidak ada pembayaran saat transaksi (hutang penuh).')}
    ${x.installments.length || t.is_credit ? section('Jadwal cicilan', '<th>Jatuh tempo</th><th class="num">Tagihan</th><th class="num">Terbayar</th><th>Status</th>', installments, 'Tidak ada jadwal cicilan.') : ''}
    ${x.creditPayments.length || t.is_credit || S.outstanding > 0 ? section('Pelunasan hutang', '<th>Waktu</th><th class="num">Jumlah</th><th>Metode</th><th>Catatan</th>', credits, 'Belum ada pelunasan.') : ''}
  </div>
  <div class="panel">
    <h3>Rincian nota</h3>
    <table class="stmt">
      <tr><td>Subtotal</td><td class="v">${rp(t.subtotal)}</td></tr>
      <tr><td>Diskon transaksi</td><td class="v">${Number(t.discount_total ?? 0) ? `<span class="neg">− ${rp(t.discount_total)}</span>` : rp(0)}</td></tr>
      <tr><td>Pajak</td><td class="v">${rp(t.tax_total)}</td></tr>
      ${Number(t.rounding_adjustment ?? 0) ? `<tr><td>Pembulatan</td><td class="v">${rp(t.rounding_adjustment)}</td></tr>` : ''}
      <tr class="total"><td>Total</td><td class="v">${rp(t.grand_total)}</td></tr>
      <tr><td>Uang diterima</td><td class="v">${rp(t.paid_total)}</td></tr>
      <tr><td>Kembalian</td><td class="v">${rp(t.change_total)}</td></tr>
      <tr class="sum"><td>Dibayar saat transaksi</td><td class="v">${rp(S.paidAtCheckout)}</td></tr>
      <tr><td>Pelunasan setelahnya</td><td class="v">${rp(S.settled)}</td></tr>
    </table>
    ${isVoid ? '' : S.outstanding > 0 ? `<div class="settle due">Sisa tagihan ${rp(S.outstanding)}</div>` : '<div class="settle ok">✓ Lunas</div>'}
    <table class="stmt" style="margin-top:12px">
      <tr class="info"><td>Laba transaksi (§9)</td><td class="v">${rp(S.profit)}</td></tr>
      <tr class="info"><td>Dicatat</td><td class="v">${dt(t.created_at)}</td></tr>
      <tr class="info"><td>Terakhir diubah</td><td class="v">${dt(t.updated_at)}</td></tr>
    </table>
  </div>
</div>`;
  return renderBusinessShell(d, 'transactions', main, `Nota ${String(t.invoice_no ?? '')} · ${String(d.business.name ?? '')}`);
}
