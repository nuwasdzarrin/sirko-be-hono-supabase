import { createResource, createSignal, For, Show, type ParentProps } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { Brand } from './auth';
import { MENU, CURRENT_PHASE, menuVisible } from '../menu';
import { SYNC_TABLES } from '../db/db';
import { switchBusiness } from '../session/auth';
import { ApiError } from '../lib/api';
import { daysLeft } from '../lib/plan';
import { buildReport, makeRange } from '../finance/report';
import { rp } from '../pos/calc';
import {
  activeStore, afterSessionChange, can, db, hasFeature, lockToUserPicker, online, session, signOut,
  sync, syncNow, unsyncedEverywhere, user,
} from '../state';

const fmtTime = (ms: number) => (ms ? new Date(ms).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'belum pernah');

function SyncChip() {
  const state = () =>
    !online() ? { cls: 'off', text: 'Offline' }
    : sync.needsLogin ? { cls: 'bad', text: 'Perlu masuk lagi' }
    : sync.running ? { cls: 'warn', text: 'Menyinkron…' }
    : sync.rejected ? { cls: 'bad', text: `${sync.rejected} ditolak server` }
    : sync.dirty ? { cls: 'warn', text: `${sync.dirty} belum tersinkron` }
    : { cls: '', text: 'Tersinkron' };
  return (
    <button class="chip" title={`Sinkron terakhir: ${fmtTime(sync.lastAt)}`} onClick={() => void syncNow({ full: true })}>
      <span class={`dot ${state().cls}`} />
      {state().text}
    </button>
  );
}

export function Shell(props: ParentProps) {
  const nav = useNavigate();
  const items = () => MENU.filter((m) => menuVisible(m, can, !!user()?.isOwner));
  const logout = async () => {
    const n = await unsyncedEverywhere();
    const warn = n
      ? `Masih ada ${n} perubahan yang BELUM tersinkron${online() ? ' (akan dicoba dikirim dulu)' : ' dan tidak ada internet — perubahan itu akan HILANG'}.\n\n`
      : '';
    if (!confirm(`${warn}Keluar akan menghapus semua data toko dari browser ini. Lanjutkan?`)) return;
    await signOut();
    nav('/masuk', { replace: true });
  };
  return (
    <div class="shell">
      <aside class="side">
        <Brand sub={activeStore()?.name} />
        <nav class="nav">
          <For each={items()}>
            {(m) =>
              m.phase <= CURRENT_PHASE ? (
                <A href={m.path} end={m.path === '/'} activeClass="active">{m.label}</A>
              ) : (
                <a class="soon" title={`${m.desc} — hadir di Fase ${m.phase}`} aria-disabled="true">
                  {m.label} <span class="tag">Fase {m.phase}</span>
                </a>
              )
            }
          </For>
        </nav>
        <div class="grow" />
        <Show when={hasFeature('staff')}>
          <button class="btn" onClick={async () => { await lockToUserPicker(); nav('/pengguna'); }}>Ganti pengguna</button>
        </Show>
        <Show when={user()?.isOwner}>
          <button class="btn bad" onClick={logout}>Keluar</button>
        </Show>
      </aside>
      <div class="main">
        <header class="top">
          <span class="store">{activeStore()?.name}</span>
          <span class="mut small">· {user()?.name} ({user()?.isOwner ? 'pemilik' : user()?.role})</span>
          <span class="spacer" />
          <SyncChip />
        </header>
        <Show when={sync.needsLogin}>
          <div class="alert warn" style={{ margin: '16px 24px 0' }}>
            Sesi toko ini di server berakhir. Data tetap aman di browser, tapi belum bisa sinkron.{' '}
            <Show when={user()?.isOwner}><A href="/masuk">Masuk lagi</A></Show>
          </div>
        </Show>
        <div class="content">{props.children}</div>
      </div>
    </div>
  );
}

export function HomePage() {
  const s = () => session();
  const [counts] = createResource(
    () => [db(), sync.lastAt] as const,
    async ([d]) => {
      if (!d) return null;
      const live = async (t: string) => (await d.t(t).toArray()).filter((r) => r.deletedAt == null).length;
      return { products: await live('products'), customers: await live('customers'), transactions: await live('transactions') };
    },
  );
  // Dashboard hari ini (sama dengan Beranda HP; laba hanya untuk izin viewCostProfit).
  const [today] = createResource(
    () => [db(), sync.lastAt, sync.dirty] as const,
    async ([d]) => (d && can('dashboardAccess') ? buildReport(d, makeRange('today')) : null),
  );
  const plan = () => s()?.plan;
  const left = () => (plan() ? daysLeft(plan()!, Date.now()) : null);
  return (
    <>
      <h1>Halo, {user()?.name}</h1>
      <p class="mut" style={{ margin: '0 0 20px' }}>
        Paket {plan()?.name === 'juragan' ? 'Juragan' : 'Warung'}
        <Show when={left() !== null}> · {left()} hari lagi</Show> · Sinkron terakhir {fmtTime(sync.lastAt)}
      </p>
      <Show when={today()}>
        {(t) => (
          <>
            <h2>Hari ini</h2>
            <div class="cards" style={{ 'margin-bottom': '18px' }}>
              <div class="card kpi"><div class="n">{rp(t().sales.grossRevenue)}</div><div class="mut">Omzet · {t().sales.transactionCount} transaksi</div></div>
              <Show when={can('viewCostProfit')}><div class="card kpi"><div class="n">{rp(t().profit.grossProfit)}</div><div class="mut">Laba kotor</div></div></Show>
              <div class="card kpi"><div class="n">{t().sales.itemCount}</div><div class="mut">Item terjual</div></div>
              <div class="card kpi"><div class={`n ${t().status.outstanding ? 'bad-t' : ''}`}>{rp(t().status.outstanding)}</div><div class="mut">Kasbon hari ini</div></div>
            </div>
          </>
        )}
      </Show>
      <h2>Data toko</h2>
      <div class="cards" style={{ 'margin-bottom': '24px' }}>
        <div class="card kpi"><div class="n">{counts()?.products ?? '—'}</div><div class="mut">Produk</div></div>
        <div class="card kpi"><div class="n">{counts()?.customers ?? '—'}</div><div class="mut">Pelanggan</div></div>
        <div class="card kpi"><div class="n">{counts()?.transactions ?? '—'}</div><div class="mut">Transaksi</div></div>
        <div class="card kpi"><div class="n">{sync.dirty}</div><div class="mut">Belum tersinkron</div></div>
      </div>
      <h2>Menu</h2>
      <div class="cards">
        <For each={MENU.filter((m) => m.path !== '/' && menuVisible(m, can, !!user()?.isOwner))}>
          {(m) => (
            <Show
              when={m.phase <= CURRENT_PHASE}
              fallback={<div class="card tile soon"><b>{m.label}</b><span class="mut small">{m.desc}</span><div class="small mut">Hadir di Fase {m.phase}</div></div>}
            >
              <A class="card tile" href={m.path}><b>{m.label}</b><span class="mut small">{m.desc}</span></A>
            </Show>
          )}
        </For>
      </div>
      <Show when={(s()?.businesses.length ?? 0) > 1 && user()?.isOwner}>
        <StoreSwitcher />
      </Show>
    </>
  );
}

function StoreSwitcher() {
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const go = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await syncNow();
      await afterSessionChange(await switchBusiness(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Pindah toko butuh internet.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="card" style={{ 'margin-top': '24px' }}>
      <h2>Toko Anda</h2>
      <Show when={error()}><div class="alert err">{error()}</div></Show>
      <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
        <For each={session()?.businesses}>
          {(b) => (
            <button class={`btn ${b.id === session()?.activeBusinessId ? 'primary' : ''}`} disabled={busy() || b.id === session()?.activeBusinessId || !online()} onClick={() => go(b.id)}>
              {b.name}
            </button>
          )}
        </For>
      </div>
      <p class="mut small">Data tiap toko disimpan terpisah di browser ini. Pindah toko butuh internet.</p>
    </div>
  );
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
