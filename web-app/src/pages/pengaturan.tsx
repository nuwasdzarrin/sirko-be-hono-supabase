import { createSignal, For, Show } from 'solid-js';
import { createLive } from '../lib/live';
import { ApiError } from '../lib/api';
import { daysLeft } from '../lib/plan';
import { changePassword } from '../session/auth';
import { activeStore, db, online, session, syncNow, user } from '../state';
import { METHOD_LABEL, PAYMENT_METHODS, type PaymentMethod } from '../pos/calc';
import { getBool, KEY_REQUIRE_OPEN_BILL, paymentOptions } from '../pos/repo';
import { savePaymentOptions, setRequireOpenBill } from '../manage/repo';
import { APP_VERSION } from '../sync/sync';

/** Pengaturan — isi sama dengan halaman Pengaturan aplikasi HP (toko, wajib shift, metode bayar, password). */
export function PengaturanPage() {
  const business = createLive(db, async (d) => (await d.t('business').toArray())[0] ?? null, null);
  const requireBill = createLive(db, (d) => getBool(d, KEY_REQUIRE_OPEN_BILL), false);
  const opts = createLive(db, (d) => paymentOptions(d), { methods: PAYMENT_METHODS, allowSplit: true });
  const [saved, setSaved] = createSignal('');
  const flash = (m: string) => {
    setSaved(m);
    setTimeout(() => setSaved(''), 2500);
  };
  const plan = () => session()?.plan;

  const toggleMethod = async (m: PaymentMethod, on: boolean) => {
    const cur = await paymentOptions(db()!); // baca terbaru: dua centang cepat tak saling menimpa
    const set = new Set(cur.methods);
    if (on) set.add(m);
    else set.delete(m);
    await savePaymentOptions(db()!, { methods: PAYMENT_METHODS.filter((x) => set.has(x)), allowSplit: cur.allowSplit });
    flash('Metode bayar disimpan.');
  };

  return (
    <>
      <h1>Pengaturan</h1>
      <Show when={saved()}><div class="alert ok">{saved()}</div></Show>
      <div class="cards settings">
        <div class="card">
          <h2>Toko</h2>
          <p><b>{String(business()?.name ?? activeStore()?.name ?? '')}</b><br /><span class="mut small">{String(business()?.businessType ?? 'Toko')}</span></p>
          <p class="small mut">
            Paket {plan()?.name === 'juragan' ? 'Juragan' : 'Warung'}
            <Show when={plan() && daysLeft(plan()!, Date.now()) !== null}> · {daysLeft(plan()!, Date.now())} hari lagi</Show>
          </p>
          <p class="small mut">Ubah nama toko, logo struk & langganan lewat aplikasi Sirko di HP.</p>
        </div>

        <div class="card">
          <h2>Shift kasir</h2>
          <label class="check">
            <input type="checkbox" checked={requireBill()} onChange={async (e) => { await setRequireOpenBill(db()!, e.currentTarget.checked); void syncNow(); flash('Pengaturan shift disimpan.'); }} />
            <span><b>Wajib buka shift sebelum transaksi</b><br /><span class="small mut">Kasir harus mengisi kas awal dulu; saat tutup shift terlihat selisih kas laci. Berlaku juga di aplikasi HP.</span></span>
          </label>
        </div>

        <div class="card">
          <h2>Metode pembayaran</h2>
          <p class="small mut">Metode yang tampil di layar Bayar komputer ini. Tunai selalu ada.</p>
          <div class="perm-grid">
            <For each={PAYMENT_METHODS}>
              {(m) => <label class="check"><input type="checkbox" disabled={m === 'cash'} checked={opts().methods.includes(m)} onChange={(e) => void toggleMethod(m, e.currentTarget.checked)} /> {METHOD_LABEL[m]}</label>}
            </For>
          </div>
          <label class="check" style={{ 'margin-top': '10px' }}>
            <input type="checkbox" checked={opts().allowSplit} onChange={async (e) => { const on = e.currentTarget.checked; await savePaymentOptions(db()!, { ...(await paymentOptions(db()!)), allowSplit: on }); flash('Disimpan.'); }} />
            Boleh bayar sebagian dengan metode lain (split)
          </label>
        </div>

        <Show when={user()?.isOwner}>
          <ChangePasswordCard />
        </Show>

        <div class="card">
          <h2>Tentang</h2>
          <p class="small mut">Sirko web {APP_VERSION}. Data toko tersimpan di browser ini & disinkronkan ke server. Kunjungi menu "Data & sinkron" untuk detail.</p>
        </div>
      </div>
    </>
  );
}

function ChangePasswordCard() {
  const [msg, setMsg] = createSignal<{ t: string; err?: boolean }>({ t: '' });
  const [busy, setBusy] = createSignal(false);
  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const f = new FormData(form);
    if (f.get('next') !== f.get('next2')) return setMsg({ t: 'Konfirmasi password baru tidak sama.', err: true });
    setBusy(true);
    try {
      await changePassword(String(f.get('current') ?? ''), String(f.get('next') ?? ''));
      form.reset();
      setMsg({ t: 'Password diganti. Pakai password baru saat masuk berikutnya (juga di HP).' });
    } catch (err) {
      setMsg({ t: err instanceof ApiError ? err.message : 'Gagal mengganti password. Periksa internet.', err: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="card">
      <h2>Ganti password</h2>
      <Show when={msg().t}><div class={`alert ${msg().err ? 'err' : 'ok'}`}>{msg().t}</div></Show>
      <form onSubmit={submit}>
        <div class="field"><label for="pw0">Password sekarang</label><input id="pw0" name="current" type="password" required autocomplete="current-password" /></div>
        <div class="field"><label for="pw1">Password baru (min. 8)</label><input id="pw1" name="next" type="password" required minlength="8" autocomplete="new-password" /></div>
        <div class="field"><label for="pw2">Ulangi password baru</label><input id="pw2" name="next2" type="password" required minlength="8" autocomplete="new-password" /></div>
        <button class="btn primary" disabled={busy() || !online()}>{online() ? 'Ganti password' : 'Butuh internet'}</button>
      </form>
    </div>
  );
}
