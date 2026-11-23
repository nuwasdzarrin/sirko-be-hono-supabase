import { createResource, For, Show, type ParentProps } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { SYNC_TABLES } from '../db/db';
import { DesktopSidebar, DesktopTopBar, MobileAppBar, MobileNav, MobileSubBar, useFocusClass } from '../ui/app-shell';
import { Beranda } from './beranda';
import { db, online, signOut, sync, syncNow, unsyncedEverywhere, user } from '../state';

const fmtTime = (ms: number) => (ms ? new Date(ms).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'belum pernah');

/** Keluar akun: peringatkan perubahan yang belum tersinkron, lalu hapus data toko dari browser. */
export async function confirmLogout(nav: (to: string, o?: { replace?: boolean }) => void): Promise<void> {
  const n = await unsyncedEverywhere();
  const warn = n
    ? `Masih ada ${n} perubahan yang BELUM tersinkron${online() ? ' (akan dicoba dikirim dulu)' : ' dan tidak ada internet — perubahan itu akan HILANG'}.\n\n`
    : '';
  if (!confirm(`${warn}Keluar akan menghapus semua data toko dari browser ini. Lanjutkan?`)) return;
  await signOut();
  nav('/masuk', { replace: true });
}

export function Shell(props: ParentProps) {
  const nav = useNavigate();
  const focus = useFocusClass();
  return (
    <div class="shell" classList={{ 'm-focus': focus() }}>
      <DesktopSidebar onLogout={() => void confirmLogout(nav)} />
      <div class="main">
        <DesktopTopBar />
        <MobileAppBar />
        <MobileSubBar />
        <Show when={sync.needsLogin}>
          <div class="alert warn">
            Sesi toko ini di server berakhir. Data tetap aman di browser, tapi belum bisa sinkron.{' '}
            <Show when={user()?.isOwner}><A href="/masuk">Masuk lagi</A></Show>
          </div>
        </Show>
        <div class="content">{props.children}</div>
        <MobileNav />
      </div>
    </div>
  );
}

/** Beranda — satu tampilan untuk HP & desktop (sama dengan DashboardPage aplikasi). */
export function HomePage() {
  return <Beranda />;
}

/** Isi data toko di browser + status sinkron per tabel. */
export function DataPage() {
  const [rows] = createResource(
    () => [db(), sync.lastAt, sync.dirty] as const,
    async ([d]) => {
      if (!d) return [];
      const out: Array<{ table: string; total: number; dirty: number; rejected: number }> = [];
      for (const t of SYNC_TABLES) {
        const total = await d.t(t).count();
        if (!total) continue;
        out.push({ table: t, total, dirty: await d.t(t).where('_dirty').equals(1).count(), rejected: await d.t(t).where('_dirty').equals(2).count() });
      }
      return out;
    },
  );
  const [errors] = createResource(
    () => [db(), sync.rejected] as const,
    async ([d]) => {
      if (!d) return [];
      const out: Array<{ table: string; id: string; err: string }> = [];
      for (const t of SYNC_TABLES) for (const r of await d.t(t).where('_dirty').equals(2).limit(20).toArray()) out.push({ table: t, id: r.id, err: String(r._syncError ?? '') });
      return out;
    },
  );
  const [quota] = createResource(async () => {
    const e = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    return e ? { used: (e.usage ?? 0) / 1048576, quota: (e.quota ?? 0) / 1048576, persisted } : null;
  });
  return (
    <>
      <h1>Data & sinkron</h1>
      <p class="mut" style={{ margin: '0 0 16px' }}>
        Data toko tersimpan di browser ini, jadi aplikasi tetap jalan tanpa internet. Perubahan dikirim otomatis ke server saat online.
      </p>
      <div style={{ display: 'flex', gap: '8px', 'margin-bottom': '16px', 'align-items': 'center' }}>
        <button class="btn primary" disabled={sync.running || !online()} onClick={() => void syncNow({ full: true })}>
          {sync.running ? 'Menyinkron…' : 'Sinkron sekarang'}
        </button>
        <span class="mut small">Terakhir: {fmtTime(sync.lastAt)}</span>
      </div>
      <Show when={sync.error}><div class="alert err">{sync.error}</div></Show>
      <Show when={(errors() ?? []).length}>
        <div class="alert err">
          <b>Ditolak server</b> (tidak dikirim ulang otomatis):
          <ul>
            <For each={errors()}>{(e) => <li class="small">{e.table} · {e.id.slice(0, 8)} — {e.err}</li>}</For>
          </ul>
        </div>
      </Show>
      <div class="card">
        <table class="list">
          <thead><tr><th>Tabel</th><th class="num">Baris</th><th class="num">Belum tersinkron</th><th class="num">Ditolak</th></tr></thead>
          <tbody>
            <For each={rows()} fallback={<tr><td colspan="4" class="mut">Belum ada data.</td></tr>}>
              {(r) => <tr><td>{r.table}</td><td class="num">{r.total}</td><td class="num">{r.dirty || '—'}</td><td class="num">{r.rejected || '—'}</td></tr>}
            </For>
          </tbody>
        </table>
      </div>
      <Show when={quota()}>
        <p class="mut small" style={{ 'margin-top': '12px' }}>
          Penyimpanan browser: {quota()!.used.toFixed(1)} MB dipakai dari ±{Math.round(quota()!.quota)} MB ·{' '}
          {quota()!.persisted ? 'permanen (tidak dibersihkan otomatis)' : 'belum permanen — browser bisa membersihkannya saat ruang penuh'}
        </p>
      </Show>
    </>
  );
}
