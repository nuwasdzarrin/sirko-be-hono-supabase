import { createMemo, createResource, createSignal, For, onCleanup, Show } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import type { Row } from '../db/db';
import { ApiError } from '../lib/api';
import { createLive } from '../lib/live';
import { daysLeft } from '../lib/plan';
import { createBusiness, switchBusiness } from '../session/auth';
import { activeStore, afterSessionChange, can, db, hasFeature, online, session, syncNow } from '../state';
import { num, rp } from '../pos/calc';
import {
  checkoutStatus, combinedReport, copyProducts, needCopy, planCatalog, planTransfer, productLinks, REPORT_PRESETS, startCheckout, stockTransfer,
  type Checkout, type TransferPick,
} from '../cloud/stores';
import { fmtDateTime } from '../pos/receipt';

/** Toko Saya (Paket Juragan) & Langganan — sama dengan layar Toko Saya / Paket Juragan aplikasi HP (pemilik). */

const errText = (e: unknown, fb = 'Gagal. Periksa internet lalu coba lagi.') => (e instanceof ApiError ? e.message : fb);
type Tab = 'toko' | 'laporan' | 'transfer';

export function TokoPage() {
  const params = useParams();
  const nav = useNavigate();
  const tab = () => (params.tab as Tab) || 'toko';
  return (
    <>
      <div class="row-btns">
        <h1 style={{ margin: 0 }}>Toko Saya</h1>
        <span class="spacer" />
        <div class="seg">
          <button class={tab() === 'toko' ? 'on' : ''} onClick={() => nav('/toko')}>Daftar toko</button>
          <button class={tab() === 'laporan' ? 'on' : ''} onClick={() => nav('/toko/laporan')}>Laporan gabungan</button>
          <button class={tab() === 'transfer' ? 'on' : ''} onClick={() => nav('/toko/transfer')}>Transfer stok</button>
        </div>
      </div>
      <Show when={!online()}><div class="alert warn" style={{ 'margin-top': '12px' }}>Fitur Toko Saya butuh internet.</div></Show>
      <Show when={!hasFeature('multi_store') && tab() !== 'toko'}>
        <div class="alert warn" style={{ 'margin-top': '12px' }}>Fitur ini bagian dari <b>Paket Juragan</b>. <a href="/app/langganan">Lihat paket</a></div>
      </Show>
      <div style={{ 'margin-top': '14px' }}>
        <Show when={tab() === 'toko'}><StoresTab /></Show>
        <Show when={tab() === 'laporan' && hasFeature('multi_store')}><CombinedTab /></Show>
        <Show when={tab() === 'transfer' && hasFeature('multi_store')}><TransferTab /></Show>
      </div>
    </>
  );
}

function StoresTab() {
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const s = () => session();
  const go = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await syncNow();
      await afterSessionChange(await switchBusiness(id));
    } catch (e) {
      setError(errText(e, 'Pindah toko butuh internet.'));
    } finally {
      setBusy(false);
    }
  };
  const add = async (e: SubmitEvent) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const name = String(new FormData(form).get('name') ?? '').trim();
    if (!name) return;
    if (!hasFeature('multi_store')) return setError('Tambah toko (cabang) butuh Paket Juragan.');
    if (!confirm(`Buat toko "${name}"? Aplikasi akan pindah ke toko baru.`)) return;
    setBusy(true);
    setError('');
    try {
      await syncNow();
      await afterSessionChange(await createBusiness(name, null));
      form.reset();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Show when={error()}><div class="alert err">{error()}</div></Show>
      <div class="cards">
        <For each={s()?.businesses ?? []}>
          {(b) => (
            <div class={`card ${b.id === s()?.activeBusinessId ? 'active-store' : ''}`}>
              <b>{b.name}</b>
              <div class="small mut">{b.id === s()?.activeBusinessId ? 'Sedang dibuka' : 'Data tersimpan terpisah'}</div>
              <Show when={b.id !== s()?.activeBusinessId}>
                <button class="btn sm primary" style={{ 'margin-top': '8px' }} disabled={busy() || !online()} onClick={() => void go(b.id)}>Buka toko ini</button>
              </Show>
            </div>
          )}
        </For>
      </div>
      <div class="card" style={{ 'margin-top': '14px', 'max-width': '520px' }}>
        <h2>Tambah toko / cabang</h2>
        <Show when={hasFeature('multi_store')} fallback={<p class="small">Punya lebih dari satu toko? <b>Paket Juragan</b> (maks. 3 toko) membuat semua toko bisa dikelola dari satu akun. <a href="/app/langganan">Lihat paket</a></p>}>
          <form class="row-btns" onSubmit={add}>
            <input class="pos-search" name="name" placeholder="Nama toko baru" maxlength="120" required />
            <button class="btn primary" disabled={busy() || !online()}>Buat toko</button>
          </form>
        </Show>
      </div>
    </>
  );
}

function CombinedTab() {
  const [preset, setPreset] = createSignal('month');
  const [data] = createResource(preset, (p) => combinedReport(p));
  const seeProfit = () => can('viewCostProfit');
  return (
    <>
      <div class="seg tabs"><For each={REPORT_PRESETS}>{([k, l]) => <button class={preset() === k ? 'on' : ''} onClick={() => setPreset(k)}>{l}</button>}</For></div>
      <Show when={data.error}><div class="alert err">{errText(data.error)}</div></Show>
      <Show when={data()} fallback={<p class="mut">{data.loading ? 'Memuat…' : ''}</p>}>
        {(d) => (
          <>
            <p class="small mut">Periode {d().from} s/d {d().to}</p>
            <div class="card flush">
              <table class="list">
                <thead><tr><th>Toko</th><th class="num">Transaksi</th><th class="num">Omzet</th><Show when={seeProfit()}><th class="num">Laba kotor</th></Show><th class="num">Piutang</th><th class="num">Saldo kas</th></tr></thead>
                <tbody>
                  <For each={[...d().stores, { ...d().total, name: 'Total' }]}>
                    {(r) => (
                      <tr class={r.name === 'Total' ? 'strong' : ''}>
                        <td>{r.name}</td><td class="num">{num(r.txCount)}</td><td class="num">{rp(r.omzet)}</td>
                        <Show when={seeProfit()}><td class="num">{rp(r.grossProfit)}</td></Show>
                        <td class="num">{rp(r.receivables)}</td><td class="num">{rp(r.cashBalance)}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <p class="small mut">Angka dari data yang sudah tersinkron ke server.</p>
          </>
        )}
      </Show>
    </>
  );
}

function TransferTab() {
  const products = createLive(db, async (d) => (await d.t('products').toArray()).filter((p) => p.deletedAt == null).sort((a, b) => String(a.name).localeCompare(String(b.name))), [] as Row[]);
  const variants = createLive(db, async (d) => (await d.t('product_variants').toArray()).filter((v) => v.deletedAt == null), [] as Row[]);
  const targets = () => (session()?.businesses ?? []).filter((b) => b.id !== session()?.activeBusinessId);
  const [to, setTo] = createSignal(targets()[0]?.id ?? '');
  const [picks, setPicks] = createSignal<Array<TransferPick & { stock: number }>>([]);
  const [q, setQ] = createSignal('');
  const [msg, setMsg] = createSignal<{ t: string; err?: boolean }>({ t: '' });
  const [busy, setBusy] = createSignal(false);
  const options = createMemo(() => {
    const out: Array<TransferPick & { key: string; stock: number }> = [];
    for (const p of products()) {
      if (p.hasVariants === true) for (const v of variants().filter((x) => x.productId === p.id)) out.push({ key: v.id, productId: p.id, variantId: v.id, name: `${p.name} — ${v.name}`, qty: 1, stock: Number(v.stock ?? 0) });
      else out.push({ key: p.id, productId: p.id, variantId: null, name: String(p.name), qty: 1, stock: Number(p.stock ?? 0) });
    }
    return out;
  });
  const found = createMemo(() => {
    const s = q().trim().toLowerCase();
    return s ? options().filter((o) => o.name.toLowerCase().includes(s)).slice(0, 8) : [];
  });
  const add = (o: ReturnType<typeof options>[number]) => {
    if (!picks().some((p) => (p.variantId ?? p.productId) === o.key)) setPicks([...picks(), { productId: o.productId, variantId: o.variantId, name: o.name, qty: 1, stock: o.stock }]);
    setQ('');
  };
  const send = async () => {
    const from = session()?.activeBusinessId;
    if (!from || !to()) return;
    const over = picks().find((p) => p.qty > p.stock);
    if (over) return setMsg({ t: `Stok "${over.name}" tidak cukup (ada ${over.stock}).`, err: true });
    if (!confirm(`Pindahkan ${picks().length} barang ke ${targets().find((t) => t.id === to())?.name}?`)) return;
    setBusy(true);
    setMsg({ t: '' });
    try {
      await syncNow(); // stok server harus mutakhir dulu
      let links = await productLinks(from, to());
      const missing = needCopy(picks(), links);
      if (missing.length) links = [...links, ...(await copyProducts(from, to(), missing)).links];
      const plan = planTransfer(picks(), links);
      if (plan.unmatched.length) throw new Error(`Belum ada pasangan di toko tujuan: ${plan.unmatched.join(', ')}. Samakan varian di toko tujuan dulu.`);
      await stockTransfer(from, to(), plan.lines);
      await syncNow({ full: true });
      setPicks([]);
      setMsg({ t: 'Stok dipindahkan. Produk yang belum ada di toko tujuan sudah disalin otomatis.' });
    } catch (e) {
      setMsg({ t: errText(e, (e as Error).message), err: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Show when={!targets().length}><div class="alert warn">Belum ada toko lain. Tambahkan toko dulu di tab Daftar toko.</div></Show>
      <Show when={msg().t}><div class={`alert ${msg().err ? 'err' : 'ok'}`}>{msg().t}</div></Show>
      <div class="card">
        <div class="form-grid">
          <div class="field"><label>Dari</label><input value={activeStore()?.name ?? ''} disabled /></div>
          <div class="field"><label for="tt">Ke toko</label>
            <select id="tt" value={to()} onChange={(e) => setTo(e.currentTarget.value)}><For each={targets()}>{(t) => <option value={t.id}>{t.name}</option>}</For></select>
          </div>
        </div>
        <input class="pos-search" placeholder="Cari barang yang dipindah" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
        <div class="clist" style={{ 'max-height': '150px' }}><For each={found()}>{(o) => <button class="crow" onClick={() => add(o)}><b>{o.name}</b><span class="mut small">stok {num(o.stock)}</span></button>}</For></div>
        <table class="list" style={{ 'margin-top': '8px' }}>
          <tbody>
            <For each={picks()} fallback={<tr><td class="mut">Belum ada barang dipilih.</td></tr>}>
              {(p, i) => (
                <tr>
                  <td>{p.name}<div class="small mut">stok {num(p.stock)}</div></td>
                  <td class="num"><input class="mini" inputmode="numeric" value={p.qty} aria-label="Jumlah dipindah" onInput={(e) => setPicks(picks().map((x, j) => (j === i() ? { ...x, qty: parseInt(e.currentTarget.value, 10) || 0 } : x)))} /></td>
                  <td class="num"><button class="btn sm" onClick={() => setPicks(picks().filter((_, j) => j !== i()))}>Hapus</button></td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <button class="btn primary block" style={{ 'margin-top': '12px' }} disabled={busy() || !online() || !picks().length || !to()} onClick={() => void send()}>{busy() ? 'Memindahkan…' : 'Pindahkan stok'}</button>
      </div>
    </>
  );
}

// ── Langganan ────────────────────────────────────────────────────────────────

export function LanggananPage() {
  const [catalog] = createResource(() => online(), () => planCatalog());
  const [checkout, setCheckout] = createSignal<Checkout | null>(null);
  const [error, setError] = createSignal('');
  const plan = () => session()?.plan;
  const left = () => (plan() ? daysLeft(plan()!, Date.now()) : null);
  let timer: ReturnType<typeof setInterval> | undefined;
  onCleanup(() => clearInterval(timer));
  const poll = (id: string) => {
    clearInterval(timer);
    timer = setInterval(async () => {
      try {
        const c = await checkoutStatus(id);
        setCheckout(c);
        if (c.status !== 'pending') {
          clearInterval(timer);
          if (c.status === 'confirmed') void syncNow({ full: true });
        }
      } catch {
        /* coba lagi di putaran berikut */
      }
    }, 10_000);
  };
  const buy = async (period: Checkout['period']) => {
    setError('');
    try {
      const c = await startCheckout(period);
      setCheckout(c);
      poll(c.id);
    } catch (e) {
      setError(errText(e));
    }
  };
  return (
    <>
      <h1>Paket Juragan</h1>
      <p class="mut">
        Paket sekarang: <b>{plan()?.name === 'juragan' ? 'Juragan' : 'Warung (gratis)'}</b>
        <Show when={left() !== null}> · berlaku {left()} hari lagi</Show>
      </p>
      <div class="card" style={{ 'max-width': '640px', 'margin-bottom': '14px' }}>
        <b>Isi Paket Juragan</b>
        <ul class="small">
          <li>Sampai 3 toko/cabang dalam satu akun, laporan gabungan & transfer stok antar-toko</li>
          <li>Akun karyawan dengan PIN & hak akses per peran</li>
          <li>Laporan lengkap & logo toko di struk</li>
        </ul>
      </div>
      <Show when={!online()}><div class="alert warn">Berlangganan butuh internet.</div></Show>
      <Show when={error() || catalog.error}><div class="alert err">{error() || errText(catalog.error)}</div></Show>
      <Show when={!checkout()}>
        <div class="cards">
          <For each={catalog()?.prices ?? []}>
            {(p) => (
              <div class="card">
                <b>{p.period === 'yearly' ? 'Tahunan' : 'Bulanan'}</b>
                <div class="kpi"><div class="n">{rp(p.amount)}</div></div>
                <div class="small mut">/{p.period === 'yearly' ? 'tahun' : 'bulan'} · maks. {p.maxStores} toko</div>
                <button class="btn primary block" style={{ 'margin-top': '10px' }} disabled={!online()} onClick={() => void buy(p.period)}>{plan()?.name === 'juragan' ? 'Perpanjang' : 'Langganan'}</button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={checkout()}>
        {(c) => (
          <div class="card topup" style={{ 'max-width': '520px' }}>
            <Show when={c().status === 'pending'}>
              <h2>Bayar {rp(c().amount)}</h2>
              <p>Bayar tepat <b class="big-amt">{rp(c().amount)}</b> (termasuk kode unik {c().uniqueCode}) sebelum {fmtDateTime(c().expiresAt)}.</p>
              <Show when={c().qrisUrl ?? catalog()?.payment.qrisUrl}><img class="qris" src={(c().qrisUrl ?? catalog()?.payment.qrisUrl)!} alt="QRIS pembayaran Paket Juragan" /></Show>
              <Show when={catalog()?.payment.accountNo}><p class="small">{catalog()!.payment.bankName} <b>{catalog()!.payment.accountNo}</b> a.n. {catalog()!.payment.accountName}</p></Show>
              <p class="small mut">Status dicek otomatis tiap 10 detik. Paket aktif setelah pembayaran dikonfirmasi admin.</p>
            </Show>
            <Show when={c().status === 'confirmed'}><div class="alert ok">Pembayaran dikonfirmasi — Paket Juragan aktif. Terima kasih!</div></Show>
            <Show when={c().status === 'rejected' || c().status === 'expired'}>
              <div class="alert err">Pembayaran {c().status === 'expired' ? 'kedaluwarsa' : 'ditolak'}.{c().note ? ` ${c().note}` : ''}</div>
              <button class="btn" onClick={() => setCheckout(null)}>Coba lagi</button>
            </Show>
          </div>
        )}
      </Show>
    </>
  );
}
