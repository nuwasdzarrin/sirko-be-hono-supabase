import { render } from 'solid-js/web';
import { Router, Route, Navigate } from '@solidjs/router';
import { Show, type ParentProps } from 'solid-js';
import './styles.css';
import { boot, ready, session, user } from './state';
import { CreateStorePage, LoginPage, UserPickerPage } from './pages/auth';
import { DataPage, HomePage, Shell } from './pages/shell';
import { KasirPage } from './pages/kasir';
import { TransaksiPage } from './pages/transaksi';
import { can } from './state';
import type { Permission } from './lib/permissions';
import type { Component } from 'solid-js';

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
      <Route path="/" component={Gate}>
        <Route path="/" component={HomePage} />
        <Route path="/data" component={DataPage} />
        <Route path="/kasir" component={guard('transactionList', KasirPage)} />
        <Route path="/transaksi/:id?" component={guard('transactionList', TransaksiPage)} />
        <Route path="*" component={() => <Navigate href="/" />} />
      </Route>
    </Router>
  );
}

void boot();
render(() => <App />, document.getElementById('root')!);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('/app/sw.js', { scope: '/app' });
}
