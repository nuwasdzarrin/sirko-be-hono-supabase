import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Icon, type IconName } from '../ui/icon';
import { buildReport, makeRange, type Preset, type ReportBundle } from '../finance/report';
import { createLive } from '../lib/live';
import type { Permission } from '../lib/permissions';
import type { Row } from '../db/db';
import { num, rp } from '../pos/calc';
import { can, db, sync, user } from '../state';

/**
 * Beranda tampilan HP — sama dengan DashboardPage aplikasi: Pintasan, Stok menipis,
 * DateRangeBar, kartu metrik 2 kolom, grafik Omzet Harian & Produk Terlaris, Ringkasan Transaksi.
 */

interface Shortcut {
  label: string;
  icon: IconName;
  to: string;
  show: () => boolean;
}

const SHORTCUTS: Shortcut[] = [
  { label: 'Buka Shift', icon: 'playCircle', to: '/kasir', show: () => !user()?.isOwner && can('transactionList') },
  { label: 'Riwayat Transaksi', icon: 'receiptLong', to: '/transaksi', show: () => can('transactionList') },
  { label: 'Stok Masuk', icon: 'moveToInbox', to: '/produk?aksi=stok-masuk', show: () => can('productManagement') },
  { label: 'Tambah Produk', icon: 'addBox', to: '/produk/baru', show: () => can('addProduct') },
  { label: 'Kas Bon', icon: 'requestQuote', to: '/pelanggan?f=hutang', show: () => can('customerManagement') },
  { label: 'Pelanggan', icon: 'peopleAlt', to: '/pelanggan', show: () => can('customerManagement') },
  { label: 'Kas', icon: 'wallet', to: '/kas', show: () => can('walletView') },
  { label: 'Pembelian', icon: 'localShipping', to: '/pembelian', show: () => !!user()?.isOwner },
  { label: 'Riwayat PPOB', icon: 'bolt', to: '/ppob/riwayat', show: () => can('ppobSell') },
];

const PRESETS: Array<[Preset, string]> = [['today', 'Hari ini'], ['last7', '7 hari'], ['last30', '30 hari'], ['thisMonth', 'Bulan ini']];
const dmy = (ms: number) => new Date(ms).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
const toInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Label sumbu ringkas seperti grafik HP: 1,2jt · 500rb · 900. */
const compact = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })}jt` : v >= 1000 ? `${Math.round(v / 1000)}rb` : String(Math.round(v));

function Pintasan() {
  const nav = useNavigate();
  const items = () => SHORTCUTS.filter((s) => s.show()).slice(0, 8);
  return (
    <div class="m-card m-pintasan">
      <div class="m-card-head"><Icon name="bolt" size={18} /><span>Pintasan</span></div>
      <div class="m-shortcuts">
        <For each={items()}>
          {(s) => (
            <button class="m-shortcut" onClick={() => nav(s.to)}>
              <span class="m-shortcut-ic"><Icon name={s.icon} size={22} /></span>
              <span>{s.label}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

function LowStock() {
  const nav = useNavigate();
  const low = createLive(
    db,
    async (d) => {
      const live = (r: Row) => r.deletedAt == null;
      const products = (await d.t('products').toArray()).filter((p) => live(p) && p.minStock != null);
      const variants = (await d.t('product_variants').toArray()).filter(live);
      const out: Array<{ id: string; name: string; stock: number; min: number }> = [];
      for (const p of products) {
        const min = Number(p.minStock);
        if (p.hasVariants === true) {
          for (const v of variants.filter((v) => v.productId === p.id && Number(v.stock ?? 0) <= min)) out.push({ id: p.id, name: `${p.name} ${v.name}`, stock: Number(v.stock ?? 0), min });
        } else if (Number(p.stock ?? 0) <= min) out.push({ id: p.id, name: String(p.name), stock: Number(p.stock ?? 0), min });
      }
      return out.sort((a, b) => a.stock - b.stock);
    },
    [] as Array<{ id: string; name: string; stock: number; min: number }>,
  );
  return (
    <Show when={can('productManagement') && low().length}>
      <div class="m-card m-lowstock">
        <div class="m-card-head">
          <Icon name="warningAmber" size={18} style={{ color: 'var(--m-error)' }} />
          <span>Stok menipis · {low().length} produk</span>
          <span class="spacer" />
          <button class="btn text sm" onClick={() => nav('/produk?f=menipis')}>Lihat semua</button>
        </div>
        <div class="m-chiprow flush">
          <For each={low().slice(0, 12)}>
            {(x) => (
              <button class={`chip ${x.stock <= 0 ? 'm-chip-bad' : ''}`} onClick={() => nav(`/produk/${x.id}`)}>
                {x.name} · sisa {num(x.stock)}/{num(x.min)}
              </button>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}

function Metric(props: { icon: IconName; label: string; value: string; sub: string; color: string }) {
  return (
    <div class="m-card m-metric">
      <div class="m-metric-head" style={{ color: props.color }}><Icon name={props.icon} size={18} /><span>{props.label}</span></div>
      <div class="m-metric-val" style={{ color: props.color }}>{props.value}</div>
      <div class="m-metric-sub">{props.sub}</div>
    </div>
  );
}

/** Grafik garis omzet harian (setara RevenueLineChart fl_chart): garis lengkung primary + area 12%. */
function RevenueChart(props: { daily: ReportBundle['daily'] }) {
  const W = 360, H = 200, L = 44, B = 24, T = 8, R = 8;
  const pts = createMemo(() => {
    const d = props.daily;
    const max = Math.max(...d.map((x) => x.revenue), 0);
    const top = max > 0 ? max * 1.15 : 1;
    const step = d.length > 1 ? (W - L - R) / (d.length - 1) : 0;
    return {
      max: top,
      list: d.map((x, i) => ({ x: d.length > 1 ? L + i * step : (L + W - R) / 2, y: T + (H - T - B) * (1 - x.revenue / top), day: x.day })),
    };
  });
  const path = createMemo(() => {
    const p = pts().list;
    if (!p.length) return '';
    let s = `M${p[0]!.x},${p[0]!.y}`;
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1]!, b = p[i]!, cx = (a.x + b.x) / 2;
      s += ` C${cx},${a.y} ${cx},${b.y} ${b.x},${b.y}`;
    }
    return s;
  });
  const grid = () => [0, 0.25, 0.5, 0.75, 1].map((f) => ({ y: T + (H - T - B) * (1 - f), v: pts().max * f }));
  const xLabels = () => {
    const p = pts().list;
    const every = Math.max(1, Math.ceil(p.length / 6));
    return p.filter((_, i) => i % every === 0 || i === p.length - 1);
  };
  const empty = () => props.daily.every((x) => x.revenue === 0);
  return (
    <Show when={!empty()} fallback={<div class="m-chart-empty">Belum ada data omzet.</div>}>
      <svg class="m-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Grafik omzet harian">
        <For each={grid()}>
          {(g) => (
            <>
              <line x1={L} x2={W - R} y1={g.y} y2={g.y} class="m-chart-grid" />
              <text x={L - 6} y={g.y + 4} class="m-chart-label" text-anchor="end">{compact(g.v)}</text>
            </>
          )}
        </For>
        <path d={`${path()} L${pts().list.at(-1)!.x},${H - B} L${pts().list[0]!.x},${H - B} Z`} class="m-chart-area" />
        <path d={path()} class="m-chart-line" />
        <Show when={pts().list.length <= 14}>
          <For each={pts().list}>{(p) => <circle cx={p.x} cy={p.y} r="3.5" class="m-chart-dot" />}</For>
        </Show>
        <For each={xLabels()}>
          {(p) => <text x={p.x} y={H - 6} class="m-chart-label" text-anchor="middle">{`${new Date(p.day).getDate()}/${new Date(p.day).getMonth() + 1}`}</text>}
        </For>
      </svg>
    </Show>
  );
}

/** Grafik batang produk terlaris (setara TopProductsBarChart): batang primary 18px, nama ≤ 8 huruf. */
function TopProducts(props: { items: ReportBundle['productsSold'] }) {
  const W = 360, H = 220, B = 34, T = 18, L = 8, R = 8;
  const top = () => [...props.items].sort((a, b) => b.qty - a.qty).slice(0, 6);
  const max = () => Math.max(...top().map((x) => x.qty), 1);
  const slot = () => (W - L - R) / Math.max(top().length, 1);
  return (
    <Show when={top().length} fallback={<div class="m-chart-empty">Belum ada produk terjual.</div>}>
      <svg class="m-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Produk terlaris">
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} class="m-chart-grid" />
        <For each={top()}>
          {(p, i) => {
            const h = () => ((H - B - T) * p.qty) / max();
            const cx = () => L + slot() * i() + slot() / 2;
            return (
              <>
                <rect x={cx() - 9} y={H - B - h()} width="18" height={h()} rx="4" class="m-chart-bar" />
                <text x={cx()} y={H - B - h() - 5} class="m-chart-label" text-anchor="middle">{num(p.qty)}</text>
                <text x={cx()} y={H - B + 16} class="m-chart-label" text-anchor="middle">{p.name.length > 8 ? `${p.name.slice(0, 8)}…` : p.name}</text>
              </>
            );
          }}
        </For>
      </svg>
    </Show>
  );
}

export function MobileHome() {
  const [preset, setPreset] = createSignal<Preset>('today');
  const [custom, setCustom] = createSignal({ start: new Date(), end: new Date() });
  const range = () => (preset() === 'custom' ? makeRange('custom', new Date(), custom()) : makeRange(preset()));
  const [rep] = createResource(
    () => [db(), sync.lastAt, sync.dirty, preset(), custom()] as const,
    async ([d]) => (d && can('dashboardAccess') ? buildReport(d, range()) : null),
  );
  const period = () => {
    const r = range();
    return r.days <= 1 ? dmy(r.from) : `${dmy(r.from)} – ${dmy(r.to - 86_400_000)}`;
  };
  const seeProfit = () => can('viewCostProfit');
  return (
    <div class="m-home">
      <Pintasan />
      <LowStock />
      <Show when={can('dashboardAccess')}>
        <div class="m-chiprow" style={{ 'padding-top': '8px' }}>
          <For each={PRESETS}>{([k, l]) => <button class={`chip ${preset() === k ? 'on' : ''}`} onClick={() => setPreset(k)}>{l}</button>}</For>
          <button class={`chip ${preset() === 'custom' ? 'on' : ''}`} onClick={() => setPreset('custom')}>
            <Show when={preset() !== 'custom'}><Icon name="dateRange" size={18} style={{ color: 'var(--m-primary)', 'margin-right': '8px' }} /></Show>
            Kustom
          </button>
        </div>
        <Show when={preset() === 'custom'}>
          <div class="m-daterow">
            <input type="date" value={toInput(custom().start.getTime())} onChange={(e) => e.currentTarget.value && setCustom({ ...custom(), start: new Date(`${e.currentTarget.value}T00:00`) })} />
            <span>–</span>
            <input type="date" value={toInput(custom().end.getTime())} onChange={(e) => e.currentTarget.value && setCustom({ ...custom(), end: new Date(`${e.currentTarget.value}T00:00`) })} />
          </div>
        </Show>
        <p class="m-period">Periode: {period()}</p>
        <Show when={rep()}>
          {(r) => (
            <>
              <div class="m-metrics">
                <Metric icon="payments" label="Omzet" value={rp(r().sales.grossRevenue)} sub={`${r().sales.transactionCount} transaksi`} color="var(--m-primary)" />
                <Show when={seeProfit()}>
                  <Metric icon="trendingUp" label="Laba" value={rp(r().profit.grossProfit)} sub={`Margin ${r().profit.marginPercent.toLocaleString('id-ID', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`} color="var(--m-green)" />
                </Show>
                <Metric icon="inventory2" label="Item terjual" value={num(r().sales.itemCount)} sub={`Rata-rata ${rp(r().sales.averageTicket)}/nota`} color="var(--m-primary)" />
                <Metric icon="schedule" label="Piutang (kredit)" value={rp(r().status.outstanding)} sub={`${r().status.creditCount + r().status.partialCount} nota`} color="var(--m-error)" />
              </div>
              <h2 class="m-section">Omzet Harian</h2>
              <div class="m-chart-wrap"><RevenueChart daily={r().daily} /></div>
              <h2 class="m-section">Produk Terlaris</h2>
              <div class="m-chart-wrap"><TopProducts items={r().productsSold} /></div>
              <h2 class="m-section">Ringkasan Transaksi</h2>
              <div class="m-card m-summary">
                <div class="m-kv"><span class="m-dot" style={{ background: '#43a047' }} />Lunas ({r().status.paidCount})<b>{rp(r().status.paidTotal)}</b></div>
                <div class="m-kv"><span class="m-dot" style={{ background: '#f57c00' }} />Sebagian ({r().status.partialCount})<b>{rp(r().status.partialTotal)}</b></div>
                <div class="m-kv"><span class="m-dot" style={{ background: 'var(--m-error)' }} />Kredit ({r().status.creditCount})<b>{rp(r().status.creditTotal)}</b></div>
                <div class="m-kv total">Total<b>{rp(r().status.paidTotal + r().status.partialTotal + r().status.creditTotal)}</b></div>
              </div>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
