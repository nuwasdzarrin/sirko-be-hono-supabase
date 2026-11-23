import { createResource, createSignal, For, Show } from 'solid-js';
import type { Row } from '../db/db';
import { createLive } from '../lib/live';
import { activeStore, can, db, sync, user } from '../state';
import { METHOD_LABEL, num, rp, type PaymentMethod } from '../pos/calc';
import { PosError } from '../pos/repo';
import { buildReport, download, employeeSummary, makeRange, toCsv, type DateRange, type Preset, type ReportBundle } from '../finance/report';
import { deleteClosedBill } from '../finance/wallets';
import { fmtDateTime } from '../pos/receipt';
import { Icon } from '../ui/icon';

/** Laporan — isi & rumus sama dengan layar Laporan + Dashboard + Shift aplikasi HP. */

const PRESETS: Array<[Preset, string]> = [['today', 'Hari ini'], ['last7', '7 hari'], ['last30', '30 hari'], ['thisMonth', 'Bulan ini'], ['custom', 'Pilih tanggal']];
const LOG_LABEL: Record<string, string> = { initial: 'Stok awal', in: 'Stok masuk', out: 'Stok keluar', adjustment: 'Penyesuaian', sale: 'Penjualan', void: 'Batal jual' };
const ymd = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dmy = (ms: number) => new Date(ms).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

type Tab = 'ringkas' | 'jual' | 'laba' | 'kas' | 'stok' | 'produk' | 'karyawan';

export function RangeBar(props: { range: DateRange; onChange: (r: DateRange) => void }) {
  const [start, setStart] = createSignal(ymd(props.range.from));
  const [end, setEnd] = createSignal(ymd(props.range.to - 1));
  const custom = () => makeRange('custom', new Date(), { start: new Date(`${start()}T00:00:00`), end: new Date(`${end()}T00:00:00`) });
  return (
    <div class="filters no-print">
      {/* HP: DateRangeBar (ChoiceChip berjajar, bisa digeser) */}
        <div class="m-chiprow m-range">
          <For each={PRESETS}>{([p, l]) => <button class={`chip ${props.range.preset === p ? 'on' : ''}`} onClick={() => props.onChange(p === 'custom' ? custom() : makeRange(p))}>{l}</button>}</For>
        </div>
      <Show when={props.range.preset === 'custom'}>
        <input type="date" class="sel" value={start()} onChange={(e) => { setStart(e.currentTarget.value); props.onChange(custom()); }} aria-label="Dari tanggal" />
        <span class="mut">s/d</span>
        <input type="date" class="sel" value={end()} onChange={(e) => { setEnd(e.currentTarget.value); props.onChange(custom()); }} aria-label="Sampai tanggal" />
      </Show>
    </div>
  );
}

export function LaporanPage() {
  const [range, setRange] = createSignal<DateRange>(makeRange('today'));
  const [tab, setTab] = createSignal<Tab>('ringkas');
  const [report] = createResource(() => { const d = db(); return d ? { d, r: range(), at: sync.lastAt, dirty: sync.dirty } : null; }, ({ d, r }) => buildReport(d, r));
  const seeProfit = () => can('viewCostProfit');
  const tabs = (): Array<[Tab, string]> => [
    ['ringkas', 'Ringkasan'], ['jual', 'Penjualan'], ...(seeProfit() ? [['laba', 'Laba'] as [Tab, string]] : []), ['kas', 'Kas masuk'], ['stok', 'Mutasi stok'], ['produk', 'Produk terjual'],
    ...(can('employeeSummary') ? [['karyawan', 'Karyawan & shift'] as [Tab, string]] : []),
  ];
  const period = () => `${dmy(range().from)}${range().days > 1 ? ` – ${dmy(range().to - 1)}` : ''}`;

  const exportCsv = () => {
    const b = report();
    if (!b) return;
    const rows: Array<Array<string | number>> = [
      [`Laporan ${activeStore()?.name ?? ''}`], ['Periode', period()], [],
      ['Ringkasan'], ['Jumlah transaksi', b.sales.transactionCount], ['Unit terjual', b.sales.itemCount], ['Omzet', b.sales.grossRevenue], ['Rata-rata / transaksi', b.sales.averageTicket],
      ['Lunas', b.status.paidCount, b.status.paidTotal], ['Sebagian', b.status.partialCount, b.status.partialTotal], ['Kredit', b.status.creditCount, b.status.creditTotal], ['Belum tertagih', b.status.outstanding],
      ...(seeProfit() ? [[], ['Laba'], ['Pendapatan (setelah diskon)', b.profit.revenue], ['HPP', b.profit.cost], ['Laba kotor', b.profit.grossProfit], ['Margin %', b.profit.marginPercent.toFixed(1)]] : []),
      [], ['Kas masuk'], ...Object.entries(b.cashFlow.salesByMethod).map(([m, v]) => [`Penjualan ${METHOD_LABEL[m as PaymentMethod] ?? m}`, v ?? 0]), ['Pelunasan hutang', b.cashFlow.debtPaymentsReceived], ['Total kas masuk', b.cashFlow.totalIn],
      [], ['Omzet harian'], ['Tanggal', 'Transaksi', 'Omzet'], ...b.daily.map((d) => [ymd(d.day), d.count, d.revenue]),
      [], ['Produk terjual'], ['Produk', 'Qty', 'Omzet', ...(seeProfit() ? ['Laba'] : [])], ...b.productsSold.map((p) => [p.name, p.qty, p.revenue, ...(seeProfit() ? [p.profit] : [])]),
    ];
    download(`laporan-${ymd(range().from)}_${ymd(range().to - 1)}.csv`, toCsv(rows));
  };
  const exportTx = async () => {
    const d = db();
    if (!d) return;
    const txs = (await d.t('transactions').where('datetime').between(range().from, range().to, true, false).toArray()).sort((a, b) => Number(a.datetime) - Number(b.datetime));
    const people = new Map([...(await d.t('customers').toArray()), ...(await d.t('users').toArray())].map((r) => [r.id, String(r.name)]));
    const rows: Array<Array<string | number>> = [['No. nota', 'Waktu', 'Kasir', 'Pelanggan', 'Status', 'Subtotal', 'Diskon', 'Pajak', 'Total', 'Dibayar', 'Kembalian', 'Catatan']];
    for (const t of txs) rows.push([String(t.invoiceNo), fmtDateTime(Number(t.datetime)), people.get(String(t.cashierId)) ?? '', t.customerId ? people.get(String(t.customerId)) ?? '' : 'Umum', String(t.status), Number(t.subtotal ?? 0), Number(t.discountTotal ?? 0), Number(t.taxTotal ?? 0), Number(t.grandTotal ?? 0), Number(t.paidTotal ?? 0), Number(t.changeTotal ?? 0), String(t.note ?? '')]);
    download(`transaksi-${ymd(range().from)}_${ymd(range().to - 1)}.csv`, toCsv(rows));
  };

  return (
    <div class="report">
      <div class="row-btns">
        <h1 style={{ margin: 0 }}>Laporan</h1>
        <span class="spacer" />
        <button class="btn sm no-print" onClick={exportCsv} disabled={!report()}>Ekspor laporan (Excel/CSV)</button>
        <button class="btn sm no-print" onClick={() => void exportTx()}>Ekspor daftar transaksi</button>
        <button class="btn sm no-print" onClick={() => window.print()}>Cetak / PDF</button>
      </div>
      <p class="mut small print-only">{activeStore()?.name} · Periode {period()} · dicetak {fmtDateTime(Date.now())} oleh {user()?.name}</p>
      <RangeBar range={range()} onChange={setRange} />
      <p class="m-period no-print">Periode: {period()}</p>
        <div class="m-export no-print">
          <button class="btn" onClick={exportCsv} disabled={!report()}><Icon name="tableView" size={18} />Export XLSX</button>
          <button class="btn" onClick={() => window.print()}><Icon name="pictureAsPdf" size={18} />Export PDF</button>
        </div>
        <button class="btn text sm m-export-tx no-print" onClick={() => void exportTx()}>Ekspor daftar transaksi (CSV)</button>
      <div class="seg tabs no-print">
        <For each={tabs()}>{([k, l]) => <button class={tab() === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>}</For>
      </div>
      <Show when={report()} fallback={<p class="mut">Menghitung…</p>}>
        {(b) => (
          <>
            <Show when={tab() === 'ringkas'}><Summary b={b()} seeProfit={seeProfit()} /></Show>
            <Show when={tab() === 'jual'}><SalesTab b={b()} /></Show>
            <Show when={tab() === 'laba' && seeProfit()}><ProfitTab b={b()} /></Show>
            <Show when={tab() === 'kas'}><CashTab b={b()} /></Show>
            <Show when={tab() === 'stok'}><StockTab b={b()} /></Show>
            <Show when={tab() === 'produk'}><ProductsTab b={b()} seeProfit={seeProfit()} /></Show>
          </>
        )}
      </Show>
      <Show when={tab() === 'karyawan'}><EmployeeTab range={range()} seeProfit={seeProfit()} /></Show>
    </div>
  );
}

const KV = (p: { k: string; v: string; b?: boolean }) => <tr class={p.b ? 'strong' : ''}><td>{p.k}</td><td class="num">{p.v}</td></tr>;

function Summary(props: { b: ReportBundle; seeProfit: boolean }) {
  const b = () => props.b;
  const max = () => Math.max(1, ...b().daily.map((d) => d.revenue));
  return (
    <>
      <div class="cards">
        <div class="card kpi"><div class="mut small">Omzet</div><div class="n">{rp(b().sales.grossRevenue)}</div><div class="small mut">{b().sales.transactionCount} transaksi</div></div>
        <Show when={props.seeProfit}><div class="card kpi"><div class="mut small">Laba</div><div class="n">{rp(b().profit.grossProfit)}</div><div class="small mut">Margin {b().profit.marginPercent.toFixed(1)}%</div></div></Show>
        <div class="card kpi"><div class="mut small">Item terjual</div><div class="n">{num(b().sales.itemCount)}</div><div class="small mut">Rata-rata {rp(b().sales.averageTicket)}/nota</div></div>
        <div class="card kpi"><div class="mut small">Piutang (kredit)</div><div class={`n ${b().status.outstanding ? 'bad-t' : ''}`}>{rp(b().status.outstanding)}</div><div class="small mut">{b().status.partialCount + b().status.creditCount} nota belum lunas</div></div>
      </div>
      <Show when={b().daily.length > 1}>
        <div class="card" style={{ 'margin-top': '14px' }}>
          <h2>Omzet harian</h2>
          <div class="bars" role="img" aria-label="Grafik omzet harian">
            <For each={b().daily}>
              {(d) => (
                <div class="bar-col" title={`${dmy(d.day)}: ${rp(d.revenue)} (${d.count} nota)`}>
                  <div class="bar" style={{ height: `${(d.revenue / max()) * 100}%` }} />
                  <span class="bar-l">{new Date(d.day).getDate()}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
      <div class="card" style={{ 'margin-top': '14px' }}>
        <h2>Produk terlaris</h2>
        <table class="list"><tbody>
          <For each={b().productsSold.slice(0, 10)} fallback={<tr><td class="mut">Belum ada produk terjual.</td></tr>}>
            {(p, i) => <tr><td>{i() + 1}. {p.name}</td><td class="num">{num(p.qty)} terjual</td><td class="num">{rp(p.revenue)}</td></tr>}
          </For>
        </tbody></table>
      </div>
    </>
  );
}

function SalesTab(props: { b: ReportBundle }) {
  const s = () => props.b.sales;
  const st = () => props.b.status;
  return (
    <div class="card"><table class="list"><tbody>
      <KV k="Jumlah transaksi" v={num(s().transactionCount)} />
      <KV k="Unit terjual" v={num(s().itemCount)} />
      <KV k="Omzet" v={rp(s().grossRevenue)} b />
      <KV k="Rata-rata / transaksi" v={rp(s().averageTicket)} />
      <KV k={`Lunas (${st().paidCount})`} v={rp(st().paidTotal)} />
      <KV k={`Sebagian (${st().partialCount})`} v={rp(st().partialTotal)} />
      <KV k={`Kredit (${st().creditCount})`} v={rp(st().creditTotal)} />
      <KV k="Belum tertagih (piutang)" v={rp(st().outstanding)} b />
    </tbody></table></div>
  );
}

function ProfitTab(props: { b: ReportBundle }) {
  const p = () => props.b.profit;
  return (
    <div class="card">
      <p class="small mut">Laba = pendapatan setelah diskon item & transaksi − modal tersimpan per item.</p>
      <table class="list"><tbody>
        <KV k="Pendapatan (setelah diskon)" v={rp(p().revenue)} />
        <KV k="HPP (Σ modal · qty)" v={rp(p().cost)} />
        <KV k="Laba kotor" v={rp(p().grossProfit)} b />
        <KV k="Margin" v={`${p().marginPercent.toFixed(1)}%`} />
      </tbody></table>
    </div>
  );
}

function CashTab(props: { b: ReportBundle }) {
  const c = () => props.b.cashFlow;
  return (
    <div class="card">
      <p class="small mut">Kas masuk: pembayaran penjualan (tunai sudah dikurangi kembalian) + pelunasan hutang. Saldo & kas keluar per dompet: menu Kas & dompet.</p>
      <table class="list"><tbody>
        <For each={Object.entries(c().salesByMethod)} fallback={<KV k="Penjualan" v={rp(0)} />}>{([m, v]) => <KV k={`Penjualan — ${METHOD_LABEL[m as PaymentMethod] ?? m}`} v={rp(v ?? 0)} />}</For>
        <KV k="Pelunasan hutang" v={rp(c().debtPaymentsReceived)} />
        <KV k="Total kas masuk" v={rp(c().totalIn)} b />
      </tbody></table>
    </div>
  );
}

function StockTab(props: { b: ReportBundle }) {
  const s = () => props.b.stockFlow;
  return (
    <div class="card">
      <Show when={s().entryCount} fallback={<p class="mut">Belum ada mutasi stok pada periode ini.</p>}>
        <table class="list"><tbody>
          <For each={Object.entries(s().qtyByType)}>{([t, q]) => <KV k={LOG_LABEL[t] ?? t} v={`${q > 0 ? '+' : ''}${num(q)}`} />}</For>
          <KV k="Jumlah catatan" v={num(s().entryCount)} b />
        </tbody></table>
      </Show>
    </div>
  );
}

function ProductsTab(props: { b: ReportBundle; seeProfit: boolean }) {
  return (
    <div class="card flush">
      <table class="list">
        <thead><tr><th>#</th><th>Produk</th><th class="num">Terjual</th><th class="num">Omzet</th><Show when={props.seeProfit}><th class="num">Laba</th></Show></tr></thead>
        <tbody>
          <For each={props.b.productsSold} fallback={<tr><td colspan="5" class="mut">Belum ada produk terjual.</td></tr>}>
            {(p, i) => <tr><td>{i() + 1}</td><td>{p.name}</td><td class="num">{num(p.qty)}</td><td class="num">{rp(p.revenue)}</td><Show when={props.seeProfit}><td class="num">{rp(p.profit)}</td></Show></tr>}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function EmployeeTab(props: { range: DateRange; seeProfit: boolean }) {
  const [rows] = createResource(() => { const d = db(); return d ? { d, r: props.range, at: sync.lastAt, dirty: sync.dirty } : null; }, ({ d, r }) => employeeSummary(d, r));
  const bills = createLive(db, async (d) => (await d.t('bills').toArray()).filter((b) => b.deletedAt == null).sort((a, b) => Number(b.openedAt) - Number(a.openedAt)).slice(0, 100), [] as Row[]);
  const names = createLive(db, async (d) => new Map((await d.t('users').toArray()).map((u) => [u.id, String(u.name)])), new Map<string, string>());
  const [err, setErr] = createSignal('');
  return (
    <>
      <div class="card flush">
        <table class="list">
          <thead><tr><th>Kasir</th><th class="num">Transaksi</th><th class="num">Omzet</th><Show when={props.seeProfit}><th class="num">Laba</th></Show></tr></thead>
          <tbody>
            <For each={rows()} fallback={<tr><td colspan="4" class="mut">Belum ada transaksi.</td></tr>}>
              {(r) => <tr><td>{r.name}</td><td class="num">{r.count}</td><td class="num">{rp(r.revenue)}</td><Show when={props.seeProfit}><td class="num">{rp(r.profit)}</td></Show></tr>}
            </For>
          </tbody>
        </table>
      </div>
      <h2 style={{ 'margin-top': '18px' }}>Riwayat shift</h2>
      <Show when={err()}><div class="alert err">{err()}</div></Show>
      <div class="card flush">
        <table class="list">
          <thead><tr><th>Kasir</th><th>Buka</th><th>Tutup</th><th class="num">Kas awal</th><th class="num">Seharusnya</th><th class="num">Fisik</th><th class="num">Selisih</th><th /></tr></thead>
          <tbody>
            <For each={bills()} fallback={<tr><td colspan="8" class="mut">Belum ada shift.</td></tr>}>
              {(b) => {
                const v = () => Number(b.variance ?? 0);
                return (
                  <tr>
                    <td>{names().get(String(b.employeeId)) ?? '—'}</td>
                    <td>{fmtDateTime(Number(b.openedAt))}</td>
                    <td>{b.closedAt ? fmtDateTime(Number(b.closedAt)) : <span class="badge">Terbuka</span>}</td>
                    <td class="num">{rp(Number(b.openingCash ?? 0))}</td>
                    <td class="num">{b.status === 'closed' ? rp(Number(b.expectedCash ?? 0)) : '—'}</td>
                    <td class="num">{b.status === 'closed' ? rp(Number(b.closingCash ?? 0)) : '—'}</td>
                    <td class={`num ${v() ? 'bad-t' : ''}`}>{b.status === 'closed' ? (v() === 0 ? 'pas' : `${v() > 0 ? '+' : ''}${rp(v())}`) : '—'}</td>
                    <td class="num">
                      <Show when={b.status === 'closed' && can('deleteClosedBill')}>
                        <button class="btn sm bad no-print" onClick={async () => { if (!confirm('Hapus catatan shift ini?')) return; try { await deleteClosedBill(db()!, b.id); } catch (e) { setErr(e instanceof PosError ? e.message : String(e)); } }}>Hapus</button>
                      </Show>
                    </td>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </div>
    </>
  );
}
