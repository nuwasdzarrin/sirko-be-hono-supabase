import { createMemo, createResource, For, Show } from 'solid-js';
import { useLocation, useNavigate } from '@solidjs/router';
import { Icon, type IconName } from './icon';
import { ppobStatus } from '../cloud/ppob';
import { rp } from '../pos/calc';
import type { Permission } from '../lib/permissions';
import { can, online, sync, syncNow } from '../state';

/**
 * Kerangka tampilan HP — sama dengan AppShell aplikasi Flutter: app bar (judul tab + chip Poin),
 * bar halaman turunan (← judul) dan NavigationBar bawah 5 tab. Hanya tampil di layar ≤ 860px.
 */

interface Tab {
  path: string;
  label: string;
  icon: IconName;
  iconOn: IconName;
  perm?: Permission;
}

/** Urutan & ikon = AppConstants.destinations aplikasi HP. "Lainnya" selalu ada & terakhir. */
const TABS: Tab[] = [
  { path: '/', label: 'Beranda', icon: 'home', iconOn: 'homeFilled', perm: 'dashboardAccess' },
  { path: '/kasir', label: 'Kasir', icon: 'pointOfSale', iconOn: 'pointOfSaleFilled', perm: 'transactionList' },
  { path: '/produk', label: 'Produk', icon: 'inventory2', iconOn: 'inventory2Filled', perm: 'productManagement' },
  { path: '/laporan', label: 'Laporan', icon: 'barChart', iconOn: 'barChartFilled', perm: 'transactionExport' },
  { path: '/lainnya', label: 'Lainnya', icon: 'moreHoriz', iconOn: 'moreHoriz' },
];

/** Judul halaman turunan (bar kedua, seperti layar yang di-push di aplikasi HP). */
const SUB_TITLES: Array<[RegExp, string, string]> = [
  [/^\/produk\/baru$/, 'Produk Baru', '/produk'],
  [/^\/produk\/.+/, 'Edit Produk', '/produk'],
  [/^\/transaksi\/.+/, 'Detail Transaksi', '/transaksi'],
  [/^\/transaksi$/, 'Riwayat Transaksi', ''],
  [/^\/pelanggan\/baru$/, 'Pelanggan Baru', '/pelanggan'],
  [/^\/pelanggan\/.+/, 'Detail Pelanggan', '/pelanggan'],
  [/^\/pelanggan$/, 'Pelanggan', ''],
  [/^\/kas\/.+/, 'Detail Kas', '/kas'],
  [/^\/kas$/, 'Kas / Wallet', ''],
  [/^\/karyawan$/, 'Karyawan', ''],
  [/^\/pembelian\/supplier$/, 'Supplier', ''],
  [/^\/pembelian\/opname$/, 'Stok Opname', ''],
  [/^\/pembelian/, 'Pembelian', ''],
  [/^\/ppob\/poin$/, 'Poin Sirko', ''],
  [/^\/ppob/, 'PPOB', ''],
  [/^\/toko/, 'Toko Saya', ''],
  [/^\/langganan$/, 'Paket Juragan', ''],
  [/^\/data$/, 'Sinkronisasi', ''],
  [/^\/pengaturan$/, 'Pengaturan', ''],
];

const tabOf = (p: string) =>
  p === '/' ? '/' : p.startsWith('/kasir') ? '/kasir' : p.startsWith('/produk') ? '/produk' : p.startsWith('/laporan') ? '/laporan' : '/lainnya';

/** Path relatif router (tanpa basis /app). */
function usePath() {
  const loc = useLocation();
  return () => loc.pathname.replace(/^\/app(?=\/|$)/, '') || '/';
}

export const isFocusMode = (path: string) => path.startsWith('/kasir');

/** Chip saldo Poin (PointsBalanceChip): ⚡ Rp… · "…" saat memuat · "–" saat offline. */
function PointsChip() {
  const nav = useNavigate();
  const [st] = createResource(
    () => (online() && (can('ppobSell') || can('pointTopup')) ? sync.lastAt || 1 : false),
    async () => (await ppobStatus()).points.balance,
  );
  const label = () => (!online() ? '–' : st.loading && st() === undefined ? '…' : st.error ? '–' : rp(st() ?? 0));
  return (
    <button class="m-chip" onClick={() => nav('/ppob/poin')} title="Poin Sirko">
      <Icon name="bolt" size={18} />
      {label()}
    </button>
  );
}

/** Ikon status sinkron — hanya muncul bila ada yang perlu perhatian (offline / belum terkirim / ditolak). */
function SyncIcon() {
  const nav = useNavigate();
  // Seperti aplikasi HP (tanpa indikator saat normal): hanya saat offline / sesi habis / ditolak server.
  const state = () => (!online() ? 'off' : sync.needsLogin || sync.rejected ? 'bad' : '');
  return (
    <Show when={state()}>
      <button
        class={`m-icon-btn sync-${state()}`}
        title={!online() ? `Offline — ${sync.dirty} perubahan menunggu dikirim` : sync.needsLogin ? 'Perlu masuk lagi' : `${sync.rejected} ditolak server`}
        onClick={() => (online() ? void syncNow({ full: true }) : nav('/data'))}
      >
        <Icon name={online() ? 'cloudSync' : 'cloudOff'} />
      </button>
    </Show>
  );
}

export function MobileAppBar() {
  const nav = useNavigate();
  const path = usePath();
  const tab = createMemo(() => TABS.find((t) => t.path === tabOf(path())) ?? TABS[0]!);
  const firstTab = () => TABS.find((t) => !t.perm || can(t.perm))?.path ?? '/';
  return (
    <header class="m-appbar">
      <Show when={isFocusMode(path())}>
        <button class="m-icon-btn" title="Beranda" onClick={() => nav(firstTab())}><Icon name="home" /></button>
      </Show>
      <span class="m-title">{tab().label}</span>
      <span class="spacer" />
      <SyncIcon />
      <Show when={can('ppobSell') || can('pointTopup')}><PointsChip /></Show>
    </header>
  );
}

/** Bar kedua "← Judul" untuk halaman di bawah tab (Riwayat, Pelanggan, detail, …). */
export function MobileSubBar() {
  const nav = useNavigate();
  const path = usePath();
  const sub = createMemo(() => {
    const p = path();
    const hit = SUB_TITLES.find(([re]) => re.test(p));
    return hit ? { title: hit[1], parent: hit[2] } : null;
  });
  const back = () => {
    const parent = sub()?.parent;
    if (parent) nav(parent);
    else if (history.length > 1) history.back();
    else nav('/lainnya');
  };
  return (
    <Show when={sub()}>
      {(s) => (
        <div class="m-subbar">
          <button class="m-icon-btn" title="Kembali" onClick={back}><Icon name="arrowBack" /></button>
          <span class="m-title">{s().title}</span>
        </div>
      )}
    </Show>
  );
}

export function MobileNav() {
  const nav = useNavigate();
  const path = usePath();
  const tabs = () => TABS.filter((t) => !t.perm || can(t.perm));
  return (
    <Show when={!isFocusMode(path())}>
      <nav class="m-nav" style={{ 'grid-template-columns': `repeat(${tabs().length}, 1fr)` }}>
        <For each={tabs()}>
          {(t) => {
            const on = () => tabOf(path()) === t.path;
            return (
              <button class={`m-nav-item ${on() ? 'on' : ''}`} aria-current={on() ? 'page' : undefined} onClick={() => nav(t.path)}>
                <span class="m-nav-pill"><Icon name={on() ? t.iconOn : t.icon} /></span>
                <span class="m-nav-label">{t.label}</span>
              </button>
            );
          }}
        </For>
      </nav>
    </Show>
  );
}

/** Kelas `m-focus` di shell saat Kasir (navigasi bawah disembunyikan, seperti mode fokus HP). */
export function useFocusClass() {
  const path = usePath();
  return () => isFocusMode(path());
}
