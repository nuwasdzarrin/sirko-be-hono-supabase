import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import { ApiError } from '../lib/api';
import { createLive } from '../lib/live';
import { can, db, online, user } from '../state';
import { rp } from '../pos/calc';
import {
  cancelTopup, CATEGORY_LABEL, createTopup, getOrder, getPricing, getTopup, ledgerLabel, listOrders, points, pointsLedger, ppobProducts, savePricing, sellPriceFor,
  type LedgerItem, type PpobCategory, type PpobOrder, type PpobPricing, type Topup,
} from '../cloud/ppob';
import { fmtDateTime } from '../pos/receipt';
import { MoneyInput } from './ui';

/** PPOB & Poin Sirko — Riwayat PPOB, Poin (saldo, top-up, mutasi), Harga jual (pemilik). Butuh internet. */

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Gagal memuat. Periksa internet.');
type Tab = 'riwayat' | 'poin' | 'harga';
const ORDER_STATUS: Record<string, [string, string]> = { success: ['Berhasil', ''], failed: ['Gagal', 'off'], pending: ['Diproses', 'warn'], processing: ['Diproses', 'warn'] };

export function PpobPage() {
  const params = useParams();
  const nav = useNavigate();
  const tabs = (): Array<[Tab, string]> => [
    ...(can('ppobSell') ? [['riwayat', 'Riwayat PPOB'] as [Tab, string]] : []),
    ...(can('ppobSell') || can('pointTopup') ? [['poin', 'Poin Sirko'] as [Tab, string]] : []),
    ...(user()?.isOwner ? [['harga', 'Harga jual'] as [Tab, string]] : []),
  ];
  const tab = () => ((params.tab as Tab) || tabs()[0]?.[0]) ?? 'poin';
  return (
    <>
      <div class="row-btns">
        <h1 style={{ margin: 0 }}>PPOB & Poin</h1>
        <span class="spacer" />
        <div class="seg"><For each={tabs()}>{([k, l]) => <button class={tab() === k ? 'on' : ''} onClick={() => nav(`/ppob/${k}`)}>{l}</button>}</For></div>
      </div>
      <p class="mut small">Jual pulsa, paket data & token listrik lewat tombol <b>PPOB</b> di halaman Kasir. Pembelian memotong Poin Sirko.</p>
      <Show when={!online()}><div class="alert warn">Halaman ini butuh internet.</div></Show>
      <Show when={tab() === 'riwayat'}><OrdersTab /></Show>
      <Show when={tab() === 'poin'}><PointsTab /></Show>
      <Show when={tab() === 'harga' && user()?.isOwner}><PricingTab /></Show>
    </>
  );
}

function OrdersTab() {
  const [orders, setOrders] = createSignal<PpobOrder[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  // Order yang sudah tercatat di nota lokal (catatan "PPOB <id>") — seperti recordedPpobOrderIds HP.
  const recorded = createLive(db, async (d) => {
    const ids = new Set<string>();
    await d.t('transactions').each((t) => {
      for (const m of String(t.note ?? '').matchAll(/PPOB (\S+)/g)) ids.add(m[1]!);
    });
    return ids;
  }, new Set<string>());
  const load = async (more = false) => {
    setLoading(true);
    setError('');
    try {
      const r = await listOrders(more ? cursor() ?? undefined : undefined);
      setOrders(more ? [...orders(), ...r.items] : r.items);
      setCursor(r.nextCursor);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  };
  void load();
  const refreshOne = async (id: string) => {
    try {
      const fresh = await getOrder(id);
      setOrders(orders().map((x) => (x.id === id ? fresh : x)));
    } catch (e) {
      setError(errText(e));
    }
  };
  return (
    <>
      <div class="row-btns" style={{ margin: '10px 0' }}><span class="spacer" /><button class="btn sm" disabled={loading()} onClick={() => void load()}>Muat ulang</button></div>
      <Show when={error()}><div class="alert err">{error()}</div></Show>
      <div class="card flush">
        <table class="list">
          <thead><tr><th>Waktu</th><th>Produk</th><th>Nomor</th><th>Status</th><th>SN / Token</th><th class="num">Modal</th></tr></thead>
          <tbody>
            <For each={orders()} fallback={<tr><td colspan="6" class="mut">{loading() ? 'Memuat…' : 'Belum ada transaksi PPOB.'}</td></tr>}>
              {(o) => (
                <tr>
                  <td>{fmtDateTime(o.createdAt)}</td>
                  <td>{o.productName}<div class="small mut">{CATEGORY_LABEL[o.category]}{o.plnName ? ` · a.n. ${o.plnName}` : ''}</div></td>
                  <td>{o.customerNo}</td>
                  <td>
                    <span class={`badge ${ORDER_STATUS[o.status]?.[1] ?? 'warn'}`}>{ORDER_STATUS[o.status]?.[0] ?? o.status}</span>
                    <Show when={o.refunded}><div class="small mut">Poin dikembalikan</div></Show>
                    <Show when={o.status === 'success' && !recorded().has(o.id)}><div class="small bad-t">Belum tercatat di nota</div></Show>
                    <Show when={o.message && o.status !== 'success'}><div class="small mut">{o.message}</div></Show>
                  </td>
                  <td><b>{o.sn ?? '—'}</b></td>
                  <td class="num">
                    {rp(o.price)}
                    <Show when={o.status !== 'success' && o.status !== 'failed'}><div><button class="btn sm" onClick={() => void refreshOne(o.id)}>Cek status</button></div></Show>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <Show when={cursor()}><button class="btn block" style={{ 'margin-top': '10px' }} disabled={loading()} onClick={() => void load(true)}>Muat lebih banyak</button></Show>
    </>
  );
}

function PointsTab() {
  const [data, { refetch }] = createResource(() => online(), () => points());
  const [ledger, setLedger] = createSignal<LedgerItem[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [amount, setAmount] = createSignal(100000);
  const [active, setActive] = createSignal<Topup | null>(null);
  const [error, setError] = createSignal('');
  const canTopup = () => can('pointTopup');
  const loadLedger = async (more = false) => {
    try {
      const r = await pointsLedger(more ? cursor() ?? undefined : undefined);
      setLedger(more ? [...ledger(), ...r.items] : r.items);
      setCursor(r.nextCursor);
    } catch (e) {
      setError(errText(e));
    }
  };
  void loadLedger();
  const topup = async () => {
    setError('');
    try {
      setActive(await createTopup(amount()));
      void refetch();
    } catch (e) {
      setError(errText(e));
    }
  };
  return (
    <>
      <Show when={error() || data.error}><div class="alert err">{error() || errText(data.error)}</div></Show>
      <div class="cards" style={{ margin: '12px 0' }}>
        <div class="card kpi"><div class="mut small">Saldo Poin</div><div class="n">{data() ? rp(data()!.balance) : '…'}</div><div class="small mut">1 Poin = Rp1</div></div>
        <Show when={canTopup()}>
          <div class="card">
            <h2>Top-up Poin</h2>
            <MoneyInput value={amount()} onInput={setAmount} class="big-input" />
            <p class="small mut">Min. {rp(data()?.minTopup ?? 0)} · maks. {rp(data()?.maxTopup ?? 0)}. Bayar lewat QRIS / transfer, Poin masuk setelah dikonfirmasi admin.</p>
            <button class="btn primary block" disabled={!online() || amount() <= 0} onClick={() => void topup()}>Buat permintaan top-up</button>
          </div>
        </Show>
      </div>
      <For each={[...(active() ? [active()!] : []), ...(data()?.pendingTopups ?? []).filter((t) => t.id !== active()?.id)]}>
        {(t) => <TopupCard t={t} onChange={(nt) => { setActive(nt.status === 'pending' ? nt : null); void refetch(); }} />}
      </For>
      <h2 style={{ 'margin-top': '16px' }}>Mutasi Poin</h2>
      <div class="card flush">
        <table class="list">
          <tbody>
            <For each={ledger()} fallback={<tr><td class="mut">Belum ada mutasi.</td></tr>}>
              {(l) => (
                <tr>
                  <td>{fmtDateTime(l.createdAt)}<div class="small mut">{ledgerLabel(l)}{l.businessName ? ` · ${l.businessName}` : ''}</div></td>
                  <td class={`num ${l.amount < 0 ? 'bad-t' : ''}`}>{l.amount > 0 ? '+' : ''}{rp(l.amount)}</td>
                  <td class="num mut">{rp(l.balanceAfter)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <Show when={cursor()}><button class="btn block" style={{ 'margin-top': '10px' }} onClick={() => void loadLedger(true)}>Muat lebih banyak</button></Show>
    </>
  );
}

function TopupCard(props: { t: Topup; onChange: (t: Topup) => void }) {
  const [err, setErr] = createSignal('');
  const ins = () => props.t.instructions;
  const act = async (fn: () => Promise<Topup>) => {
    try {
      props.onChange(await fn());
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <div class="card topup" style={{ 'margin-bottom': '10px' }}>
      <div class="row-btns">
        <h2 style={{ margin: 0 }}>Top-up {rp(props.t.amount)}</h2>
        <span class={`badge ${props.t.status === 'pending' ? 'warn' : props.t.status === 'confirmed' ? '' : 'off'}`}>{({ pending: 'Menunggu pembayaran', confirmed: 'Berhasil', rejected: 'Ditolak', expired: 'Kedaluwarsa', cancelled: 'Dibatalkan' } as Record<string, string>)[props.t.status] ?? props.t.status}</span>
      </div>
      <Show when={err()}><div class="alert err small">{err()}</div></Show>
      <Show when={props.t.status === 'pending'}>
        <p>Transfer tepat <b class="big-amt">{rp(props.t.transferAmount || ins()?.transferAmount || props.t.amount)}</b> (termasuk kode unik {props.t.uniqueCode}) sebelum {fmtDateTime(props.t.expiresAt || ins()?.expiresAt || 0)}.</p>
        <Show when={ins()?.qrisImageUrl}><img class="qris" src={ins()!.qrisImageUrl!} alt="QRIS pembayaran top-up" /></Show>
        <Show when={ins()?.accountNo}><p class="small">{ins()!.bankName} <b>{ins()!.accountNo}</b> a.n. {ins()!.accountName}</p></Show>
        <Show when={ins()?.note}><p class="small mut">{ins()!.note}</p></Show>
        <div class="row-btns">
          <button class="btn sm" onClick={() => void act(() => getTopup(props.t.id))}>Cek status</button>
          <button class="btn sm bad" onClick={() => confirm('Batalkan permintaan top-up ini?') && void act(() => cancelTopup(props.t.id))}>Batalkan</button>
        </div>
      </Show>
      <Show when={props.t.adminNote}><p class="small mut">Catatan admin: {props.t.adminNote}</p></Show>
    </div>
  );
}

function PricingTab() {
  const [pricing, setPricing] = createSignal<PpobPricing | null>(null);
  const [cat, setCat] = createSignal<PpobCategory>('pulsa');
  const [msg, setMsg] = createSignal<{ t: string; err?: boolean }>({ t: '' });
  const [busy, setBusy] = createSignal(false);
  void getPricing().then(setPricing).catch((e) => setMsg({ t: errText(e), err: true }));
  const [products] = createResource(cat, (c) => ppobProducts(c).catch(() => []));
  const rows = createMemo(() => (products() ?? []).filter((p) => p.available));
  const set = (patch: Partial<PpobPricing>) => setPricing({ ...pricing()!, ...patch });
  const save = async () => {
    setBusy(true);
    try {
      const r = await savePricing(pricing()!);
      setPricing(r.pricing);
      setMsg({ t: r.warnings.length ? `Disimpan dengan catatan: ${r.warnings.map((w) => w.message).join('; ')}` : 'Harga jual PPOB disimpan.', err: !!r.warnings.length });
    } catch (e) {
      setMsg({ t: errText(e), err: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Show when={pricing()} fallback={<p class="mut">{msg().t || 'Memuat…'}</p>}>
      {(pr) => (
        <>
          <Show when={msg().t}><div class={`alert ${msg().err ? 'warn' : 'ok'}`}>{msg().t}</div></Show>
          <div class="card" style={{ margin: '12px 0' }}>
            <h2>Untung per transaksi</h2>
            <p class="small mut">Harga jual = modal + untung, dibulatkan ke atas. Berlaku di semua toko Anda.</p>
            <div class="form-grid">
              <For each={['pulsa', 'data', 'pln'] as PpobCategory[]}>
                {(c) => <div class="field"><label>{CATEGORY_LABEL[c]}</label><MoneyInput value={pr().markups[c]} onInput={(v) => set({ markups: { ...pr().markups, [c]: v } })} /></div>}
              </For>
              <div class="field"><label for="rd">Pembulatan</label>
                <select id="rd" value={pr().rounding} onChange={(e) => set({ rounding: Number(e.currentTarget.value) })}>
                  <For each={[100, 500, 1000]}>{(r) => <option value={r}>{rp(r)}</option>}</For>
                </select>
              </div>
            </div>
          </div>
          <div class="row-btns">
            <div class="seg"><For each={['pulsa', 'data', 'pln'] as PpobCategory[]}>{(c) => <button class={cat() === c ? 'on' : ''} onClick={() => setCat(c)}>{CATEGORY_LABEL[c]}</button>}</For></div>
            <span class="spacer" />
            <button class="btn primary" disabled={busy()} onClick={() => void save()}>Simpan harga</button>
          </div>
          <div class="card flush" style={{ 'margin-top': '10px' }}>
            <table class="list">
              <thead><tr><th>Produk</th><th class="num">Modal</th><th class="num">Harga jual</th><th class="num">Atur manual</th></tr></thead>
              <tbody>
                <For each={rows()} fallback={<tr><td colspan="4" class="mut">{products.loading ? 'Memuat…' : 'Tidak ada produk.'}</td></tr>}>
                  {(p) => (
                    <tr>
                      <td>{p.name}<div class="small mut">{p.brand}</div></td>
                      <td class="num">{rp(p.price)}</td>
                      <td class="num">{rp(sellPriceFor(pr(), p))}</td>
                      <td class="num">
                        <MoneyInput class="mini" value={pr().overrides[p.id] ?? 0} placeholder="otomatis" onInput={(v) => {
                          const o = { ...pr().overrides };
                          if (v > 0) o[p.id] = v;
                          else delete o[p.id];
                          set({ overrides: o });
                        }} />
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </>
      )}
    </Show>
  );
}
