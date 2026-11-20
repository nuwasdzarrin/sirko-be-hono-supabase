import { createSignal, createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';
import { deleteStoreDb, kvGet, kvSet, listStoreDbIds, storeDb, type Row, type StoreDb } from './db/db';
import { authed, loadSession, loginOffline, loginOnline, refreshMe, saveSession, type Session } from './session/auth';
import { ApiError, NetworkError } from './lib/api';
import { verifyOfflinePassword, verifyPin } from './lib/crypto';
import { resolvePermissions, type Permission } from './lib/permissions';
import { allows, type PlanFeature } from './lib/plan';
import { syncOnce } from './sync/sync';

/**
 * State aplikasi (satu tempat): sesi, toko aktif, pengguna aktif (pemilik / karyawan), online,
 * dan status sinkronisasi. Logika murni ada di lib/, db/, sync/, session/.
 */

export interface CurrentUser {
  id: string;
  name: string;
  role: string;
  isOwner: boolean;
  permissions: Set<Permission>;
}

/** Pengguna aktif tersimpan per browser: menutup tab saat mode karyawan TIDAK menjadikan pemilik. */
type ActiveUser = { kind: 'owner' } | { kind: 'staff'; userId: string };

const [session, setSession] = createSignal<Session | null>(null);
const [user, setUser] = createSignal<CurrentUser | null>(null);
const [online, setOnline] = createSignal(typeof navigator === 'undefined' ? true : navigator.onLine);
const [ready, setReady] = createSignal(false);
const [sync, setSync] = createStore({
  running: false,
  lastAt: 0,
  error: '' as string,
  dirty: 0,
  rejected: 0,
  needsLogin: false,
});

export { session, user, online, ready, sync };

export const db = createMemo<StoreDb | null>(() => {
  const s = session();
  return s?.activeBusinessId ? storeDb(s.activeBusinessId) : null;
});

export const activeStore = createMemo(() => {
  const s = session();
  const bid = s?.activeBusinessId;
  if (!s || !bid) return null;
  const tok = s.vault[bid];
  return { id: bid, name: tok?.businessName ?? s.businesses.find((b) => b.id === bid)?.name ?? 'Toko', hasToken: !!tok };
});

export const can = (p: Permission) => !!user()?.permissions.has(p);
export const hasFeature = (f: PlanFeature) => {
  const s = session();
  return !!s && allows(s.plan, f, Date.now());
};

// ── Boot ─────────────────────────────────────────────────────────────────────

export async function boot(): Promise<void> {
  window.addEventListener('online', () => {
    setOnline(true);
    void syncNow();
  });
  window.addEventListener('offline', () => setOnline(false));
  // Minta penyimpanan permanen: browser tak membersihkan data toko otomatis saat ruang sempit.
  void navigator.storage?.persist?.().catch(() => false);
  const s = await loadSession();
  setSession(s);
  if (s?.activeBusinessId) await restoreUser();
  setReady(true);
  startScheduler();
}

async function ownerUser(s: Session): Promise<CurrentUser> {
  const tok = s.activeBusinessId ? s.vault[s.activeBusinessId] : null;
  return {
    id: tok?.user.id ?? s.account?.id ?? 'owner',
    name: tok?.user.name ?? s.account?.name ?? 'Pemilik',
    role: 'owner',
    isOwner: true,
    permissions: resolvePermissions('owner'),
  };
}

function staffUser(r: Row): CurrentUser {
  const role = String(r.role ?? 'staff');
  return { id: r.id, name: String(r.name ?? ''), role, isOwner: role === 'owner', permissions: resolvePermissions(role, r.permissions) };
}

async function restoreUser(): Promise<void> {
  const s = session();
  if (!s) {
    setUser(null);
    return;
  }
  const a = await kvGet<ActiveUser>('activeUser');
  if (a?.kind === 'staff') {
    const r = a.userId ? await db()?.t('users').get(a.userId) : undefined;
    if (r && r.deletedAt == null && r.isActive !== false) {
      setUser(staffUser(r));
      return;
    }
    // Karyawan dihapus/nonaktif → kembali ke pilih pengguna (bukan otomatis pemilik).
    setUser(null);
    return;
  }
  setUser(await ownerUser(s));
}

// ── Login / keluar ───────────────────────────────────────────────────────────

/**
 * Masuk pemilik: online dulu; bila tak ada internet → cocokkan `offlineAuth` tersimpan.
 * Kembalikan pesan error (string) atau null bila berhasil.
 */
export async function signIn(login: string, password: string): Promise<string | null> {
  try {
    const s = await loginOnline(login, password);
    await kvSet('activeUser', { kind: 'owner' });
    setSession(s);
    await restoreUser();
    setSync('needsLogin', false);
    void syncNow({ full: true });
    return null;
  } catch (e) {
    if (e instanceof NetworkError) {
      const s = await loginOffline(login, password);
      if (!s) return 'Tidak ada internet. Masuk tanpa internet hanya bisa di browser yang pernah dipakai masuk akun ini.';
      await kvSet('activeUser', { kind: 'owner' });
      setSession(s);
      await restoreUser();
      return null;
    }
    if (e instanceof ApiError) {
      if (e.code === 'EMAIL_NOT_VERIFIED') return 'Email belum diverifikasi. Selesaikan verifikasi di aplikasi Sirko di HP, lalu masuk lagi di sini.';
      return e.message;
    }
    return 'Gagal masuk. Coba lagi.';
  }
}

export async function afterSessionChange(s: Session): Promise<void> {
  setSession(s);
  await kvSet('activeUser', { kind: 'owner' });
  await restoreUser();
  void syncNow({ full: true });
}

/** Karyawan masuk dengan PIN (butuh fitur `staff` Paket Juragan, sama dengan aplikasi). */
export async function signInStaff(userId: string, pin: string): Promise<string | null> {
  const r = await db()?.t('users').get(userId);
  if (!r || r.deletedAt != null || r.isActive === false) return 'Pengguna tidak ditemukan.';
  if (!(await verifyPin(pin, r.pinHash as string))) return 'PIN salah, coba lagi.';
  const u = staffUser(r);
  if (!u.isOwner && !hasFeature('staff')) return 'Akun karyawan butuh Paket Juragan. Minta pemilik toko berlangganan.';
  await kvSet('activeUser', u.isOwner ? { kind: 'owner' } : { kind: 'staff', userId });
  setUser(u);
  return null;
}

/** Kembali ke pemilik dari mode karyawan: wajib password pemilik (offline bisa). */
export async function resumeOwner(password: string): Promise<string | null> {
  const s = session();
  if (!s) return 'Sesi tidak ditemukan.';
  let ok = await verifyOfflinePassword(password, s.offlineAuth);
  if (!ok && online() && s.account) {
    const login = s.account.email ?? s.account.phone ?? '';
    ok = (await signIn(login, password)) === null;
  }
  if (!ok) return 'Password pemilik salah.';
  await kvSet('activeUser', { kind: 'owner' });
  setUser(await ownerUser(s));
  return null;
}

/** Layar "Ganti pengguna": kosongkan pengguna aktif (sesi toko tetap). */
export async function lockToUserPicker(): Promise<void> {
  await kvSet('activeUser', { kind: 'staff', userId: '' });
  setUser(null);
}

/** Jumlah perubahan yang belum tersinkron di SEMUA toko di browser ini. */
export async function unsyncedEverywhere(): Promise<number> {
  let n = 0;
  for (const id of await listStoreDbIds()) n += (await storeDb(id).pending()).dirty;
  return n;
}

/**
 * Keluar = hapus SEMUA data toko & sesi dari browser ini (keputusan pemilik: komputer bisa dipakai
 * bersama). Yang disisakan hanya email login terakhir (isian awal) & id perangkat.
 */
export async function signOut(): Promise<void> {
  if (online()) {
    try {
      await syncNow();
    } catch {
      /* tetap keluar bila pemilik sudah setuju */
    }
  }
  await inflight?.catch(() => undefined);
  // Tutup tampilan & sesi DULU (halaman berhenti membaca DB), baru hapus database toko.
  setUser(null);
  setSession(null);
  setSync({ dirty: 0, rejected: 0, lastAt: 0, error: '', needsLogin: false });
  await saveSession(null);
  await kvSet('activeUser', undefined);
  await new Promise((r) => setTimeout(r, 0));
  for (const id of await listStoreDbIds()) await deleteStoreDb(id);
}

// ── Sinkronisasi ─────────────────────────────────────────────────────────────

let inflight: Promise<void> | null = null;

export async function refreshPending(): Promise<void> {
  const d = db();
  if (!d) return;
  const p = await d.pending();
  setSync({ dirty: p.dirty, rejected: p.rejected, lastAt: (await d.meta<number>('lastPullAt')) ?? 0 });
}

export function syncNow(opts: { full?: boolean } = {}): Promise<void> {
  const d = db();
  if (!d || !online()) return refreshPending();
  inflight ??= (async () => {
    setSync({ running: true, error: '' });
    try {
      await syncOnce(d, (m, p, b) => authed(m, p, b));
      if (opts.full) {
        const s = await refreshMe().catch(() => null);
        if (s) setSession(s);
      }
      setSync('needsLogin', false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NEEDS_LOGIN') {
        setSync('needsLogin', true);
        setSession(await loadSession());
      } else if (!(e instanceof NetworkError)) setSync('error', (e as Error).message);
    } finally {
      setSync('running', false);
      await refreshPending();
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

let timer: ReturnType<typeof setInterval> | undefined;
let lastFull = 0;

/** Push tiap 30 dtk bila ada perubahan; pull penuh tiap 5 menit & saat tab kembali aktif. */
function startScheduler(): void {
  if (timer) return;
  timer = setInterval(async () => {
    await refreshPending();
    const due = Date.now() - lastFull > 5 * 60_000;
    if (sync.dirty > 0 || due) {
      if (due) lastFull = Date.now();
      void syncNow();
    }
  }, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  window.addEventListener('beforeunload', (e) => {
    if (sync.dirty > 0) e.preventDefault();
  });
  void syncNow({ full: true });
}
