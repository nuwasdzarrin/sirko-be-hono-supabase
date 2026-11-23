import { createMemo, createResource, For, Show } from 'solid-js';
import { A, useLocation, useNavigate } from '@solidjs/router';
import { Icon } from './icon';
import { allowed, isActive, MORE, OWNER, pageTitle, TABS, type NavItem } from './nav';
import { ppobStatus } from '../cloud/ppob';
import { rp } from '../pos/calc';
import { activeStore, can, hasFeature, lockToUserPicker, online, sync, syncNow, user } from '../state';

/**
 * Kerangka aplikasi — satu sistem untuk HP & desktop (tata letak adaptif Material 3):
 *  - HP (≤ 860px): app bar + bar turunan "← Judul" + NavigationBar bawah (AppShell Flutter).
 *  - Desktop: navigation drawer (sidebar) berisi menu yang SAMA + app bar judul halaman.
 * Elemen keduanya dirender; CSS memilih yang tampil (theme.css / mobile.css).
 */

/** Path relatif router (tanpa basis /app). */
export function usePath() {
  const loc = useLocation();
  return () => loc.pathname.replace(/^\/app(?=\/|$)/, '') || '/';
}

const LAINNYA: NavItem = { path: '/lainnya', label: 'Lainnya', icon: 'moreHoriz' };
const tabOf = (p: string) => TABS.find((t) => isActive(t, p))?.path ?? '/lainnya';
export const isFocusMode = (path: string) => path.startsWith('/kasir');
const isOwner = () => !!user()?.isOwner;
const ok = (i: NavItem) => allowed(i, can, isOwner());

/** Chip saldo Poin (PointsBalanceChip): ⚡ Rp… · "…" saat memuat · "–" saat offline. */
export function PointsChip() {
  const nav = useNavigate();
  const [st] = createResource(
    () => (online() && (can('ppobSell') || can('pointTopup')) ? sync.lastAt || 1 : false),
    async () => (await ppobStatus()).points.balance,
  );
  const label = () => (!online() ? '–' : st.loading && st() === undefined ? '…' : st.error ? '–' : rp(st() ?? 0));
  return (
    <Show when={can('ppobSell') || can('pointTopup')}>
      <button class="m-chip" onClick={() => nav('/ppob/poin')} title="Poin Sirko">
        <Icon name="bolt" size={18} />
        {label()}
      </button>
    </Show>
  );
}

/** Status sinkron — seperti aplikasi HP hanya muncul saat perlu perhatian (offline / sesi habis / ditolak). */
function SyncIcon() {
  const nav = useNavigate();
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

// ── HP ─────────────────────────────────────────────────────────────────────

export function MobileAppBar() {
  const nav = useNavigate();
  const path = usePath();
  const tab = createMemo(() => [...TABS, LAINNYA].find((t) => t.path === tabOf(path())) ?? LAINNYA);
  const firstTab = () => TABS.find(ok)?.path ?? '/lainnya';
  return (
    <header class="m-appbar">
      <Show when={isFocusMode(path())}>
        <button class="m-icon-btn" title="Beranda" onClick={() => nav(firstTab())}><Icon name="home" /></button>
      </Show>
      <span class="m-title">{tab().label}</span>
      <span class="spacer" />
      <SyncIcon />
      <PointsChip />
    </header>
  );
}

/** Bar kedua "← Judul" untuk halaman di bawah tab (seperti layar yang di-push di aplikasi HP). */
export function MobileSubBar() {
  const nav = useNavigate();
  const path = usePath();
  const sub = createMemo(() => (TABS.some((t) => t.path === path()) || path() === '/lainnya' || path().startsWith('/kasir') || path().startsWith('/laporan') ? null : pageTitle(path())));
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
  const tabs = () => [...TABS.filter(ok), LAINNYA];
  return (
    <Show when={!isFocusMode(path())}>
      <nav class="m-nav" style={{ 'grid-template-columns': `repeat(${tabs().length}, 1fr)` }}>
        <For each={tabs()}>
          {(t) => {
            const on = () => tabOf(path()) === t.path;
            return (
              <button class={`m-nav-item ${on() ? 'on' : ''}`} aria-current={on() ? 'page' : undefined} onClick={() => nav(t.path)}>
                <span class="m-nav-pill"><Icon name={on() ? t.iconOn ?? t.icon : t.icon} /></span>
                <span class="m-nav-label">{t.label}</span>
              </button>
            );
          }}
        </For>
      </nav>
    </Show>
  );
}

export function useFocusClass() {
  const path = usePath();
  return () => isFocusMode(path());
}

// ── Desktop ────────────────────────────────────────────────────────────────

function DrawerLink(props: { item: NavItem; path: string }) {
  const on = () => isActive(props.item, props.path);
  return (
    <A href={props.item.path} class={`d-nav-item ${on() ? 'on' : ''}`} aria-current={on() ? 'page' : undefined} end={props.item.exact}>
      <Icon name={on() ? props.item.iconOn ?? props.item.icon : props.item.icon} />
      <span>{props.item.label}</span>
    </A>
  );
}

/** Navigation drawer desktop: menu sama dengan tab + halaman Lainnya aplikasi HP. */
export function DesktopSidebar(props: { onLogout: () => void }) {
  const nav = useNavigate();
  const path = usePath();
  return (
    <aside class="side">
      <div class="d-brand">
        <img src="/app/lockup.png" alt="Sirko" />
        <span>{activeStore()?.name}</span>
      </div>
      <nav class="d-nav">
        <For each={TABS.filter(ok)}>{(i) => <DrawerLink item={i} path={path()} />}</For>
        <Show when={MORE.some(ok)}>
          <div class="d-nav-head">Lainnya</div>
          <For each={MORE.filter(ok)}>{(i) => <DrawerLink item={i} path={path()} />}</For>
        </Show>
        <Show when={isOwner()}>
          <div class="d-nav-head">Pemilik</div>
          <For each={OWNER}>{(i) => <DrawerLink item={i} path={path()} />}</For>
        </Show>
      </nav>
      <div class="grow" />
      <div class="d-user">
        <span class="m-avatar">{(user()?.name ?? '?').trim().charAt(0).toUpperCase()}</span>
        <span class="m-row-text">
          <span class="m-row-title">{user()?.name}</span>
          <span class="m-row-sub">Masuk sebagai {isOwner() ? 'owner' : user()?.role}</span>
        </span>
      </div>
      <Show when={hasFeature('staff')}>
        <button class="d-nav-item" onClick={async () => { await lockToUserPicker(); nav('/pengguna'); }}>
          <Icon name="switchAccount" /><span>Ganti pengguna</span>
        </button>
      </Show>
      <a class="d-nav-item" href="/kontak" target="_blank" rel="noopener"><Icon name="supportAgent" /><span>Hubungi Bantuan</span></a>
      <Show when={isOwner()}>
        <button class="d-nav-item" onClick={() => props.onLogout()}><Icon name="logout" /><span>Keluar</span></button>
      </Show>
    </aside>
  );
}

const fmtTime = (ms: number) => (ms ? new Date(ms).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'belum pernah');

/** Chip status sinkron desktop (ruang cukup → selalu tampil; klik = sinkron penuh). */
function SyncChip() {
  const state = () =>
    !online() ? { cls: 'off', text: 'Offline' }
    : sync.needsLogin ? { cls: 'bad', text: 'Perlu masuk lagi' }
    : sync.running ? { cls: 'warn', text: 'Menyinkron…' }
    : sync.rejected ? { cls: 'bad', text: `${sync.rejected} ditolak server` }
    : sync.dirty ? { cls: 'warn', text: `${sync.dirty} belum tersinkron` }
    : { cls: '', text: 'Tersinkron' };
  return (
    <button class="m-chip d-sync" title={`Sinkron terakhir: ${fmtTime(sync.lastAt)}`} onClick={() => void syncNow({ full: true })}>
      <span class={`dot ${state().cls}`} />
      {state().text}
    </button>
  );
}

/** App bar desktop: judul halaman (sama dengan aplikasi) + status sinkron + chip Poin. */
export function DesktopTopBar() {
  const path = usePath();
  return (
    <header class="top">
      <span class="m-title">{pageTitle(path())?.title ?? 'Sirko'}</span>
      <span class="spacer" />
      <SyncChip />
      <PointsChip />
    </header>
  );
}
