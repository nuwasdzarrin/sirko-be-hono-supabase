import { createSignal, Show } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { ApiError } from '../lib/api';
import { forgotPassword, register, resendVerification, resetPassword, verifyEmail, type OtpSent } from '../session/auth';
import { afterSessionChange, online, session } from '../state';
import { Brand } from './auth';

/** Daftar akun & lupa password — alur sama dengan aplikasi HP (email + WA + password, OTP email). */

const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function OtpField(props: { sent: OtpSent; onResend: () => Promise<OtpSent> }) {
  const [info, setInfo] = createSignal('');
  const resend = async (e: Event) => {
    e.preventDefault();
    try {
      await props.onResend();
      setInfo('Kode baru sudah dikirim.');
    } catch (err) {
      setInfo(errText(err, 'Gagal mengirim ulang.'));
    }
  };
  return (
    <div class="field">
      <label for="code">Kode 6 angka</label>
      <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required pattern="\d{6}" maxlength="6" autofocus value={props.sent.devCode ?? ''} />
      <span class="small mut">
        Kode dikirim ke {props.sent.sentTo ?? 'email Anda'}. Cek juga folder spam. <a href="#" onClick={resend}>Kirim ulang</a>
      </span>
      <Show when={info()}><span class="small">{info()}</span></Show>
    </div>
  );
}

export function RegisterPage() {
  const nav = useNavigate();
  const [sent, setSent] = createSignal<OtpSent | null>(null);
  const [email, setEmail] = createSignal('');
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    setError('');
    if (f.get('password') !== f.get('password2')) return setError('Konfirmasi password tidak sama.');
    setBusy(true);
    try {
      setEmail(String(f.get('email') ?? '').trim());
      setSent(await register(String(f.get('name') ?? ''), email(), String(f.get('phone') ?? ''), String(f.get('password') ?? '')));
    } catch (err) {
      setError(errText(err, 'Gagal mendaftar. Periksa internet lalu coba lagi.'));
    } finally {
      setBusy(false);
    }
  };
  const verify = async (e: SubmitEvent) => {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget as HTMLFormElement).get('code') ?? '');
    setBusy(true);
    setError('');
    try {
      await afterSessionChange(await verifyEmail(email(), code));
      nav(session()?.activeBusinessId ? '/' : '/buat-toko', { replace: true });
    } catch (err) {
      setError(errText(err, 'Gagal memeriksa kode.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main class="auth">
      <div class="auth-card">
        <Brand />
        <h1>{sent() ? 'Verifikasi email' : 'Daftar akun'}</h1>
        <Show when={!online()}><div class="alert warn">Mendaftar butuh internet.</div></Show>
        <Show when={error()}><div class="alert err" role="alert">{error()}</div></Show>
        <Show
          when={sent()}
          fallback={
            <form onSubmit={submit}>
              <div class="field"><label for="name">Nama Anda</label><input id="name" name="name" required maxlength="120" autocomplete="name" autofocus /></div>
              <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="email" /></div>
              <div class="field"><label for="phone">Nomor WhatsApp</label><input id="phone" name="phone" type="tel" required inputmode="tel" placeholder="08…" autocomplete="tel" /></div>
              <div class="field"><label for="password">Password (min. 8 karakter)</label><input id="password" name="password" type="password" required minlength="8" autocomplete="new-password" /></div>
              <div class="field"><label for="password2">Ulangi password</label><input id="password2" name="password2" type="password" required minlength="8" autocomplete="new-password" /></div>
              <button class="btn primary block" disabled={busy() || !online()}>{busy() ? 'Mendaftar…' : 'Daftar'}</button>
            </form>
          }
        >
          <form onSubmit={verify}>
            <OtpField sent={sent()!} onResend={() => resendVerification(email())} />
            <button class="btn primary block" disabled={busy()}>{busy() ? 'Memeriksa…' : 'Verifikasi & masuk'}</button>
          </form>
        </Show>
        <p class="small" style={{ 'margin-top': '16px' }}><A href="/masuk">Sudah punya akun? Masuk</A></p>
      </div>
    </main>
  );
}

export function ForgotPasswordPage() {
  const nav = useNavigate();
  const [sent, setSent] = createSignal<OtpSent | null>(null);
  const [login, setLogin] = createSignal('');
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  const ask = async (e: SubmitEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setLogin(String(new FormData(e.currentTarget as HTMLFormElement).get('login') ?? '').trim());
      setSent(await forgotPassword(login()));
    } catch (err) {
      setError(errText(err, 'Gagal mengirim kode. Periksa internet lalu coba lagi.'));
    } finally {
      setBusy(false);
    }
  };
  const reset = async (e: SubmitEvent) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    setError('');
    if (f.get('password') !== f.get('password2')) return setError('Konfirmasi password tidak sama.');
    setBusy(true);
    try {
      await afterSessionChange(await resetPassword(login(), String(f.get('code') ?? ''), String(f.get('password') ?? '')));
      nav(session()?.activeBusinessId ? '/' : '/buat-toko', { replace: true });
    } catch (err) {
      setError(errText(err, 'Gagal mengatur ulang password.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main class="auth">
      <div class="auth-card">
        <Brand />
        <h1>Lupa password</h1>
        <Show when={!online()}><div class="alert warn">Atur ulang password butuh internet.</div></Show>
        <Show when={error()}><div class="alert err" role="alert">{error()}</div></Show>
        <Show
          when={sent()}
          fallback={
            <form onSubmit={ask}>
              <div class="field"><label for="login">Email atau nomor WhatsApp akun</label><input id="login" name="login" required autofocus autocomplete="username" /></div>
              <button class="btn primary block" disabled={busy() || !online()}>{busy() ? 'Mengirim…' : 'Kirim kode'}</button>
            </form>
          }
        >
          <form onSubmit={reset}>
            <OtpField sent={sent()!} onResend={() => forgotPassword(login())} />
            <div class="field"><label for="password">Password baru (min. 8 karakter)</label><input id="password" name="password" type="password" required minlength="8" autocomplete="new-password" /></div>
            <div class="field"><label for="password2">Ulangi password baru</label><input id="password2" name="password2" type="password" required minlength="8" autocomplete="new-password" /></div>
            <button class="btn primary block" disabled={busy()}>{busy() ? 'Menyimpan…' : 'Simpan & masuk'}</button>
          </form>
        </Show>
        <p class="small" style={{ 'margin-top': '16px' }}><A href="/masuk">Kembali ke Masuk</A></p>
      </div>
    </main>
  );
}
