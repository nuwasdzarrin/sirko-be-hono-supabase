import { render } from 'solid-js/web';
import { Router, Route, Navigate } from '@solidjs/router';
import { Show, type ParentProps } from 'solid-js';
import './styles.css';
import './theme.css';
import './mobile.css';
import { boot, ready, session, user } from './state';
import { CreateStorePage, LoginPage, UserPickerPage } from './pages/auth';
import { DataPage, HomePage, Shell } from './pages/shell';
import { LainnyaPage } from './pages/lainnya';
import { can } from './state';
import type { Permission } from './lib/permissions';
import { lazy, type Component } from 'solid-js';

declare const __BUILD_ID__: string;

// Halaman dimuat terpisah (unduhan awal kecil). Semuanya dipanaskan saat idle → tersimpan service
// worker → tetap bisa dibuka tanpa internet walau belum pernah dikunjungi.
const pages = {
  kasir: () => import('./pages/kasir'),
  transaksi: () => import('./pages/transaksi'),
  produk: () => import('./pages/produk'),
  pelanggan: () => import('./pages/pelanggan'),
  karyawan: () => import('./pages/karyawan'),
  pengaturan: () => import('./pages/pengaturan'),
  account: () => import('./pages/account'),
  laporan: () => import('./pages/laporan'),
  kas: () => import('./pages/kas'),
  pembelian: () => import('./pages/pembelian'),
  ppob: () => import('./pages/ppob'),
  toko: () => import('./pages/toko'),
};
const KasirPage = lazy(() => pages.kasir().then((m) => ({ default: m.KasirPage })));
const TransaksiPage = lazy(() => pages.transaksi().then((m) => ({ default: m.TransaksiPage })));
const ProdukPage = lazy(() => pages.produk().then((m) => ({ default: m.ProdukPage })));
const PelangganPage = lazy(() => pages.pelanggan().then((m) => ({ default: m.PelangganPage })));
const KaryawanPage = lazy(() => pages.karyawan().then((m) => ({ default: m.KaryawanPage })));
const PengaturanPage = lazy(() => pages.pengaturan().then((m) => ({ default: m.PengaturanPage })));
const LaporanPage = lazy(() => pages.laporan().then((m) => ({ default: m.LaporanPage })));
const PembelianPage = lazy(() => pages.pembelian().then((m) => ({ default: m.PembelianPage })));
const PpobPage = lazy(() => pages.ppob().then((m) => ({ default: m.PpobPage })));
const TokoPage = lazy(() => pages.toko().then((m) => ({ default: m.TokoPage })));
const LanggananPage = lazy(() => pages.toko().then((m) => ({ default: m.LanggananPage })));
const KasPage = lazy(() => pages.kas().then((m) => ({ default: m.KasPage })));
const RegisterPage = lazy(() => pages.account().then((m) => ({ default: m.RegisterPage })));
const ForgotPasswordPage = lazy(() => pages.account().then((m) => ({ default: m.ForgotPasswordPage })));

/** Gerbang izin per halaman (sama dengan router aplikasi HP). */
const guard = (perm: Permission, Page: Component) => () => (
  <Show when={can(perm)} fallback={<p class="mut">Anda tidak punya akses ke halaman ini. Minta pemilik toko mengaturnya.</p>}>
    <Page />
  </Show>
);

/**
 * Gerbang alur (sama dengan aplikasi HP): belum masuk → /masuk · akun tanpa toko → /buat-toko ·
 * mode karyawan tanpa pengguna aktif → /pengguna · selain itu aplikasi.
 */
const guardAny = (perms: Permission[], Page: Component) => () => (
  <Show when={perms.some(can)} fallback={<p class="mut">Anda tidak punya akses ke halaman ini. Minta pemilik toko mengaturnya.</p>}>
    <Page />
  </Show>
);
const ownerOnly = (Page: Component) => () => (
  <Show when={user()?.isOwner} fallback={<p class="mut">Halaman ini khusus pemilik toko.</p>}>
    <Page />
  </Show>
);

function Gate(props: ParentProps) {
  return (
    <Show when={ready()}>
      <Show when={session()} fallback={<Navigate href="/masuk" />}>
        <Show when={session()!.activeBusinessId} fallback={<Navigate href="/buat-toko" />}>
          <Show when={user()} fallback={<Navigate href="/pengguna" />}>
            <Shell>{props.children}</Shell>
          </Show>
        </Show>
      </Show>
    </Show>
  );
}

function App() {
  return (
    <Router base="/app">
      <Route path="/masuk" component={LoginPage} />
      <Route path="/buat-toko" component={CreateStorePage} />
      <Route path="/pengguna" component={UserPickerPage} />
      <Route path="/daftar" component={RegisterPage} />
      <Route path="/lupa-password" component={ForgotPasswordPage} />
      <Route path="/" component={Gate}>
        <Route path="/" component={HomePage} />
        <Route path="/data" component={DataPage} />
        <Route path="/lainnya" component={LainnyaPage} />
        <Route path="/kasir" component={guard('transactionList', KasirPage)} />
        <Route path="/transaksi/:id?" component={guard('transactionList', TransaksiPage)} />
        <Route path="/produk/:id?" component={guard('productManagement', ProdukPage)} />
        <Route path="/pelanggan/:id?" component={guard('customerManagement', PelangganPage)} />
        <Route path="/karyawan" component={guard('userService', KaryawanPage)} />
        <Route path="/pengaturan" component={guard('settingCompany', PengaturanPage)} />
        <Route path="/laporan" component={guard('transactionExport', LaporanPage)} />
        <Route path="/kas/:id?" component={guard('walletView', KasPage)} />
        <Route path="/pembelian/:tab?" component={guard('productManagement', PembelianPage)} />
        <Route path="/ppob/:tab?" component={guardAny(['ppobSell', 'pointTopup'], PpobPage)} />
        <Route path="/toko/:tab?" component={ownerOnly(TokoPage)} />
        <Route path="/langganan" component={ownerOnly(LanggananPage)} />
        <Route path="*" component={() => <Navigate href="/" />} />
      </Route>
    </Router>
  );
}

void boot();
render(() => <App />, document.getElementById('root')!);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register(`/app/sw.js?v=${__BUILD_ID__}`, { scope: '/app' });
}
const warm = () => Object.values(pages).forEach((load) => void load().catch(() => undefined));
if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 5000 });
else setTimeout(warm, 3000);
