import { createResource, createSignal, For, Show } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { kvGet } from '../db/db';
import { createBusiness } from '../session/auth';
import { ApiError } from '../lib/api';
import { afterSessionChange, db, resumeOwner, session, signIn, signInStaff, online } from '../state';

const ICON = '/app/icon.svg';

export function Brand(props: { sub?: string }) {
  return (
    <div class="brand">
      <img src={ICON} alt="" />
      <div>
        <b>Sirko</b>
        <span class="mut small">{props.sub ?? 'Kasir toko, untung kelihatan.'}</span>
      </div>
    </div>
  );
}

/** Masuk pemilik: email / nomor WA + password (online; tanpa internet → offlineAuth). */
export function LoginPage() {
  const nav = useNavigate();
  const [last] = createResource(() => kvGet<string>('lastLogin'));
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [show, setShow] = createSignal(false);

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    setBusy(true);
    setError('');
    const err = await signIn(String(f.get('login') ?? ''), String(f.get('password') ?? ''));
    setBusy(false);
    if (err) return setError(err);
    nav(session()?.activeBusinessId ? '/' : '/buat-toko', { replace: true });
  };

  return (
    <main class="auth">
      <div class="auth-card">
        <Brand />
        <h1>Masuk</h1>
        <p class="mut small" style={{ margin: '0 0 18px' }}>
          Pakai akun pemilik yang sama dengan aplikasi Sirko di HP.
        </p>
        <Show when={!online()}>
          <div class="alert warn">Tidak ada internet. Anda tetap bisa masuk bila browser ini pernah dipakai masuk akun ini.</div>
        </Show>
        <Show when={error()}>
          <div class="alert err" role="alert">{error()}</div>
        </Show>
        <form onSubmit={submit}>
          <div class="field">
            <label for="login">Email atau nomor WhatsApp</label>
            <input id="login" name="login" required autocomplete="username" value={last() ?? ''} autofocus />
          </div>
          <div class="field">
            <label for="password">Password</label>
            <input id="password" name="password" type={show() ? 'text' : 'password'} required autocomplete="current-password" />
            <label class="small mut" style={{ 'font-weight': 400 }}>
              <input type="checkbox" checked={show()} onChange={(e) => setShow(e.currentTarget.checked)} /> Tampilkan password
            </label>
          </div>
          <button class="btn primary block" type="submit" disabled={busy()}>
            {busy() ? 'Memeriksa…' : 'Masuk'}
          </button>
        </form>
        <p class="small" style={{ 'margin-top': '16px', display: 'flex', 'justify-content': 'space-between', gap: '8px' }}>
          <A href="/daftar">Daftar akun baru</A>
          <A href="/lupa-password">Lupa password?</A>
        </p>
      </div>
    </main>
  );
}

/** Akun baru tanpa toko → buat toko (toko pertama gratis). */
export function CreateStorePage() {
  const nav = useNavigate();
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    setBusy(true);
    setError('');
    try {
      const s = await createBusiness(String(f.get('name') ?? '').trim(), String(f.get('type') ?? '') || null);
      await afterSessionChange(s);
      nav('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal membuat toko. Periksa internet lalu coba lagi.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main class="auth">
      <div class="auth-card">
        <Brand />
        <h1>Buat toko</h1>
        <p class="mut small" style={{ margin: '0 0 18px' }}>Toko pertama gratis (Paket Warung).</p>
        <Show when={error()}>
          <div class="alert err" role="alert">{error()}</div>
        </Show>
        <form onSubmit={submit}>
          <div class="field">
            <label for="name">Nama toko</label>
            <input id="name" name="name" required maxlength="120" autofocus placeholder="mis. Warung Bu Sri" />
          </div>
          <div class="field">
            <label for="type">Jenis usaha</label>
            <select id="type" name="type">
              <For each={['Kelontong', 'Sembako', 'Grosir', 'Minimarket', 'Toko bangunan', 'Toko pertanian', 'Lainnya']}>{(t) => <option>{t}</option>}</For>
            </select>
          </div>
          <button class="btn primary block" disabled={busy() || !online()}>
            {busy() ? 'Membuat…' : 'Buat toko'}
          </button>
          <Show when={!online()}>
            <p class="mut small">Membuat toko butuh internet.</p>
          </Show>
        </form>
      </div>
    </main>
  );
}

/** Ganti pengguna: pilih karyawan + PIN, atau kembali sebagai pemilik dengan password. */
export function UserPickerPage() {
  const nav = useNavigate();
  const [users] = createResource(db, async (d) =>
    (await d.t('users').toArray())
      .filter((u) => u.deletedAt == null && u.isActive !== false && u.role !== 'owner' && u.role !== 'sirko_admin' && typeof u.pinHash === 'string' && String(u.pinHash).includes(':'))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  );
  const [picked, setPicked] = createSignal<string>('');
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [ownerMode, setOwnerMode] = createSignal(false);

  const enterPin = async (e: SubmitEvent) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement; // currentTarget kosong setelah await
    const pin = String(new FormData(form).get('pin') ?? '');
    const id = picked() || users()?.[0]?.id;
    if (!id) return;
    setBusy(true);
    const err = await signInStaff(id, pin);
    setBusy(false);
    form.reset();
    if (err) return setError(err);
    nav('/', { replace: true });
  };
  const enterOwner = async (e: SubmitEvent) => {
    e.preventDefault();
    setBusy(true);
    const err = await resumeOwner(String(new FormData(e.currentTarget as HTMLFormElement).get('password') ?? ''));
    setBusy(false);
    if (err) return setError(err);
    nav('/', { replace: true });
  };

  return (
    <main class="auth">
      <div class="auth-card" style={{ 'max-width': '520px' }}>
        <Brand sub={session()?.activeBusinessId ? session()!.vault[session()!.activeBusinessId!]?.businessName : undefined} />
        <h1>Siapa yang memakai?</h1>
        <Show when={error()}>
          <div class="alert err" role="alert">{error()}</div>
        </Show>
        <Show
          when={!ownerMode()}
          fallback={
            <form onSubmit={enterOwner}>
              <div class="field">
                <label for="password">Password pemilik</label>
                <input id="password" name="password" type="password" required autofocus autocomplete="current-password" />
              </div>
              <button class="btn primary block" disabled={busy()}>Masuk sebagai pemilik</button>
              <button type="button" class="btn block" style={{ 'margin-top': '8px' }} onClick={() => setOwnerMode(false)}>Kembali</button>
            </form>
          }
        >
          <Show when={(users() ?? []).length} fallback={<p class="mut">Belum ada akun karyawan di toko ini.</p>}>
            <div class="users">
              <For each={users()}>
                {(u) => (
                  <button type="button" class={`user-btn ${(picked() || users()?.[0]?.id) === u.id ? 'on' : ''}`} onClick={() => setPicked(u.id)}>
                    <div class="ava">{String(u.name ?? '?').charAt(0).toUpperCase()}</div>
                    <b>{String(u.name)}</b>
                    <div class="mut small">{String(u.role)}</div>
                  </button>
                )}
              </For>
            </div>
            <form class="pin" onSubmit={enterPin}>
              <div class="field">
                <label for="pin">PIN</label>
                <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="off" required minlength="4" maxlength="12" autofocus />
              </div>
              <button class="btn primary block" disabled={busy()}>{busy() ? 'Memeriksa…' : 'Masuk'}</button>
            </form>
          </Show>
          <button type="button" class="btn block" style={{ 'margin-top': '12px' }} onClick={() => setOwnerMode(true)}>
            Masuk sebagai pemilik
          </button>
        </Show>
      </div>
    </main>
  );
}
