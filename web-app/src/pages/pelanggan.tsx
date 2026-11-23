import { createMemo, createSignal, For, Show } from 'solid-js';
import { useNavigate, useParams, useSearchParams } from '@solidjs/router';
import type { Row } from '../db/db';
import { createLive } from '../lib/live';
import { can, db, syncNow } from '../state';
import { METHOD_LABEL, rp, type PaymentMethod } from '../pos/calc';
import { PosError } from '../pos/repo';
import { createInstallmentPlan, deleteCustomer, installmentStatus, outstandingFor, payDebt, restoreCustomer, saveCustomer } from '../manage/repo';
import { fmtDateTime } from '../pos/receipt';
import { Modal, MoneyInput, Toast } from './ui';
import { Icon } from '../ui/icon';

const live = (r: Row) => r.deletedAt == null;
const msg = (e: unknown) => (e instanceof PosError ? e.message : `Gagal: ${(e as Error).message}`);
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
const toDateInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type Filter = 'all' | 'debt' | 'deleted';

export function PelangganPage() {
  const params = useParams();
  const nav = useNavigate();
  const [q, setQ] = createSignal('');
  const [search] = useSearchParams();
  // Pintasan "Kas Bon" di Beranda (HP) → ?f=hutang.
  const [filter, setFilter] = createSignal<Filter>(search.f === 'hutang' ? 'debt' : 'all');
  const [toast, setToast] = createSignal('');
  const say = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 3000);
  };
  const customers = createLive(db, async (d) => (await d.t('customers').toArray()).sort((a, b) => String(a.name).localeCompare(String(b.name))), [] as Row[]);
  const list = createMemo(() => {
    const s = q().trim().toLowerCase();
    return customers().filter((c) => {
      if (filter() === 'deleted' ? c.deletedAt == null : c.deletedAt != null) return false;
      if (filter() === 'debt' && Number(c.debtBalance ?? 0) <= 0) return false;
      return !s || String(c.name).toLowerCase().includes(s) || String(c.phone ?? '').includes(s);
    });
  });
  const totalDebt = createMemo(() => customers().filter(live).reduce((s, c) => s + Number(c.debtBalance ?? 0), 0));

  const debtors = createMemo(() => customers().filter((c) => live(c) && Number(c.debtBalance ?? 0) > 0).length);
  return (
    <div class="split">
      {/* HP: CustomerListScreen + banner Kas Bon */}
        <section class="split-list">
          <Show when={totalDebt() > 0}>
            <button class="m-debt-banner" onClick={() => setFilter(filter() === 'debt' ? 'all' : 'debt')}>
              <span class="small">Total piutang</span>
              <b>{rp(totalDebt())}</b>
              <span class="small">{debtors()} pelanggan</span>
            </button>
          </Show>
          <div class="m-toolbar">
            <input class="pos-search" placeholder="Cari nama atau telepon…" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
          </div>
          <div class="m-chiprow">
            <button class={`chip ${filter() === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>Semua</button>
            <button class={`chip ${filter() === 'debt' ? 'on' : ''}`} onClick={() => setFilter('debt')}>Punya hutang</button>
            <Show when={can('recycleBin')}><button class={`chip ${filter() === 'deleted' ? 'on' : ''}`} onClick={() => setFilter('deleted')}>Terhapus</button></Show>
          </div>
          <div class="m-list">
            <For each={list().slice(0, 500)} fallback={<div class="m-empty"><Icon name="people" size={48} /><b>Belum ada pelanggan</b><span class="small">Tambah pelanggan dengan tombol di bawah</span></div>}>
              {(c) => (
                <button class="m-row" classList={{ sel: params.id === c.id }} onClick={() => nav(`/pelanggan/${c.id}`)}>
                  <span class="m-avatar">{String(c.name ?? '?').trim().charAt(0).toUpperCase()}</span>
                  <span class="m-row-text">
                    <span class="m-row-title">{String(c.name)}</span>
                    <span class="m-row-sub">{String(c.phone ?? '') || '—'}</span>
                  </span>
                  <Show when={Number(c.debtBalance ?? 0) > 0} fallback={<Icon name="chevronRight" class="m-trail" />}>
                    <span class="m-row-end"><span class="small">Hutang</span><b class="bad-t m-amt">{rp(Number(c.debtBalance))}</b></span>
                  </Show>
                </button>
              )}
            </For>
          </div>
          <button class="m-fab" onClick={() => nav('/pelanggan/baru')}><Icon name="personAdd" />Pelanggan</button>
        </section>
      <Show when={params.id} keyed fallback={<aside class="split-detail mut empty">Pilih pelanggan untuk melihat hutang & riwayat.</aside>}>
        {(id) => <CustomerDetail id={id === 'baru' ? null : id} onDone={(nid, m) => { if (m) say(m); nav(nid ? `/pelanggan/${nid}` : '/pelanggan'); void syncNow(); }} />}
      </Show>
      <Toast msg={toast()} />
    </div>
  );
}

interface CreditTx { tx: Row; outstanding: number; installments: Row[] }

function CustomerDetail(props: { id: string | null; onDone: (id: string | null, msg?: string) => void }) {
  const dep = () => { const d = db(); return d && props.id ? { d, id: props.id } : null; };
  const c = createLive(dep, async ({ d, id }) => (await d.t('customers').get(id)) ?? null, null as Row | null);
  const credits = createLive(dep, async ({ d, id }) => {
    const txs = (await d.t('transactions').where('customerId').equals(id).toArray()).filter((t) => live(t) && (t.status === 'credit' || t.status === 'partial')).sort((a, b) => Number(b.datetime) - Number(a.datetime));
    const out: CreditTx[] = [];
    for (const tx of txs) out.push({ tx, outstanding: await outstandingFor(d, tx.id), installments: (await d.t('installments').where('transactionId').equals(tx.id).toArray()).filter(live).sort((a, b) => Number(a.dueDate) - Number(b.dueDate)) });
    return out;
  }, [] as CreditTx[]);
  const payments = createLive(dep, async ({ d, id }) => (await d.t('credit_payments').where('customerId').equals(id).toArray()).filter(live).sort((a, b) => Number(b.datetime) - Number(a.datetime)).slice(0, 50), [] as Row[]);
  const [editing, setEditing] = createSignal(!props.id);
  // Isian form = salinan saat mulai mengubah (sinkron latar belakang tak menimpa ketikan).
  const [cf, setCf] = createSignal<Row | null>(null);
  const [error, setError] = createSignal('');
  const [pay, setPay] = createSignal<{ tx?: Row; inst?: Row; max: number } | null>(null);
  const [plan, setPlan] = createSignal<CreditTx | null>(null);

  const save = async (e: SubmitEvent) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    const bd = String(f.get('birthdate') ?? '');
    try {
      const name = String(f.get('name') ?? '');
      if (!name.trim()) throw new PosError('Nama wajib diisi.');
      const id = await saveCustomer(db()!, props.id, { name, phone: String(f.get('phone') ?? ''), address: String(f.get('address') ?? ''), note: String(f.get('note') ?? ''), birthdate: bd ? new Date(`${bd}T00:00:00`).getTime() : null });
      setEditing(false);
      props.onDone(id, props.id ? 'Pelanggan disimpan.' : 'Pelanggan ditambahkan.');
    } catch (err) {
      setError(msg(err));
    }
  };
  const debt = () => Number(c()?.debtBalance ?? 0);
  const waLink = () => {
    const p = String(c()?.phone ?? '').replace(/\D/g, '').replace(/^0/, '62');
    return p ? `https://wa.me/${p}?text=${encodeURIComponent(`Halo ${c()?.name}, mengingatkan sisa kasbon Anda ${rp(debt())}. Terima kasih.`)}` : null;
  };

  return (
    <aside class="split-detail">
      <div class="row-btns">
        <h2 style={{ margin: 0 }}>{props.id ? String(c()?.name ?? '…') : 'Pelanggan baru'}</h2>
        <span class="spacer" />
        <button class="x" aria-label="Tutup" onClick={() => props.onDone(null)}>×</button>
      </div>
      <Show when={c()?.deletedAt != null}>
        <div class="alert warn">Pelanggan ini terhapus. <button class="btn sm" onClick={async () => { await restoreCustomer(db()!, props.id!); props.onDone(props.id, 'Pelanggan dipulihkan.'); }}>Pulihkan</button></div>
      </Show>
      <Show when={error()}><div class="alert err">{error()}</div></Show>
      <Show
        when={editing()}
        fallback={
          <>
            <p class="small mut">{String(c()?.phone ?? 'Tanpa no. HP')}{c()?.address ? ` · ${c()!.address}` : ''}{c()?.note ? ` · ${c()!.note}` : ''}</p>
            <div class="paysum">
              <div class="kv"><span>Sisa hutang</span><b class={debt() ? 'bad-t' : ''}>{rp(debt())}</b></div>
            </div>
            <div class="row-btns" style={{ margin: '12px 0' }}>
              <button class="btn" onClick={() => { setCf({ ...(c() ?? {}) } as Row); setEditing(true); }}>Ubah data</button>
              <Show when={waLink() && debt() > 0}><a class="btn" href={waLink()!} target="_blank" rel="noopener">Ingatkan via WA</a></Show>
              <span class="spacer" />
              <Show when={debt() > 0 && c()?.deletedAt == null}><button class="btn primary" onClick={() => setPay({ max: debt() })}>Bayar hutang</button></Show>
            </div>
          </>
        }
      >
        <form onSubmit={save} class="form-grid">
          <div class="field full"><label for="cn">Nama</label><input id="cn" name="name" required maxlength="120" value={String(cf()?.name ?? '')} autofocus /></div>
          <div class="field"><label for="cp">No. HP / WA</label><input id="cp" name="phone" inputmode="tel" maxlength="20" value={String(cf()?.phone ?? '')} /></div>
          <div class="field"><label for="cb">Tanggal lahir</label><input id="cb" name="birthdate" type="date" value={cf()?.birthdate != null ? toDateInput(Number(cf()!.birthdate)) : ''} /></div>
          <div class="field full"><label for="ca">Alamat</label><input id="ca" name="address" maxlength="200" value={String(cf()?.address ?? '')} /></div>
          <div class="field full"><label for="ct">Catatan</label><input id="ct" name="note" maxlength="200" value={String(cf()?.note ?? '')} /></div>
          <div class="row-btns full">
            <Show when={props.id && c()?.deletedAt == null}>
              <button type="button" class="btn bad" onClick={async () => { if (confirm(`Hapus pelanggan "${c()?.name}"?${debt() ? ` Masih ada hutang ${rp(debt())}.` : ''}`)) { await deleteCustomer(db()!, props.id!); props.onDone(null, 'Pelanggan dihapus.'); } }}>Hapus</button>
            </Show>
            <span class="spacer" />
            <Show when={props.id}><button type="button" class="btn" onClick={() => setEditing(false)}>Batal</button></Show>
            <button class="btn primary">Simpan</button>
          </div>
        </form>
      </Show>

      <Show when={props.id}>
        <div class="sec">
          <h3>Nota kasbon</h3>
          <For each={credits()} fallback={<p class="mut small">Tidak ada nota kasbon.</p>}>
            {(ct) => (
              <div class="credit-tx">
                <div class="row-btns">
                  <span><b>{String(ct.tx.invoiceNo)}</b> <span class="mut small">{fmtDate(Number(ct.tx.datetime))}</span></span>
                  <span class="spacer" />
                  <span class={ct.outstanding ? 'bad-t' : 'mut'}>{ct.outstanding ? `sisa ${rp(ct.outstanding)}` : 'lunas'}</span>
                </div>
                <div class="small mut">Total {rp(Number(ct.tx.grandTotal))} · dibayar saat beli {rp(Number(ct.tx.paidTotal))}</div>
                <Show when={ct.installments.length}>
                  <table class="list small">
                    <tbody>
                      <For each={ct.installments}>
                        {(i) => {
                          const st = installmentStatus(i, Date.now());
                          return (
                            <tr>
                              <td>{fmtDate(Number(i.dueDate))}</td>
                              <td class="num">{rp(Number(i.amountPaid ?? 0))} / {rp(Number(i.amountDue))}</td>
                              <td><span class={`badge ${st === 'paid' ? '' : st === 'overdue' ? 'warn' : 'off'}`}>{st === 'paid' ? 'Lunas' : st === 'overdue' ? 'Lewat tempo' : 'Menunggu'}</span></td>
                              <td class="num"><Show when={st !== 'paid'}><button class="btn sm" onClick={() => setPay({ tx: ct.tx, inst: i, max: Number(i.amountDue) - Number(i.amountPaid ?? 0) })}>Bayar</button></Show></td>
                            </tr>
                          );
                        }}
                      </For>
                    </tbody>
                  </table>
                </Show>
                <Show when={ct.outstanding > 0}>
                  <div class="row-btns" style={{ 'margin-top': '6px' }}>
                    <button class="btn sm" onClick={() => setPay({ tx: ct.tx, max: ct.outstanding })}>Bayar nota ini</button>
                    <button class="btn sm" onClick={() => setPlan(ct)}>{ct.installments.length ? 'Jadwal ulang cicilan' : 'Jadwalkan cicilan'}</button>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
        <div class="sec">
          <h3>Riwayat pembayaran hutang</h3>
          <table class="list small">
            <tbody>
              <For each={payments()} fallback={<tr><td class="mut">Belum ada pembayaran.</td></tr>}>
                {(p) => <tr><td>{fmtDateTime(Number(p.datetime))}<div class="mut">{METHOD_LABEL[p.method as PaymentMethod] ?? String(p.method)}{p.note ? ` · ${p.note}` : ''}</div></td><td class="num">{rp(Number(p.amount))}</td></tr>}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      <Show when={pay()} keyed>
        {(p) => <PayDebtDialog customer={c()!} target={p} onClose={() => setPay(null)} onPaid={(m) => { setPay(null); props.onDone(props.id, m); }} />}
      </Show>
      <Show when={plan()} keyed>
        {(ct) => <PlanDialog ct={ct} onClose={() => setPlan(null)} onSaved={() => { setPlan(null); props.onDone(props.id, 'Jadwal cicilan disimpan.'); }} />}
      </Show>
    </aside>
  );
}

function PayDebtDialog(props: { customer: Row; target: { tx?: Row; inst?: Row; max: number }; onClose: () => void; onPaid: (m: string) => void }) {
  const [amount, setAmount] = createSignal(props.target.max);
  const [method, setMethod] = createSignal<PaymentMethod>('cash');
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const note = String(new FormData(e.currentTarget as HTMLFormElement).get('note') ?? '');
    setBusy(true);
    try {
      const r = await payDebt(db()!, { customerId: props.customer.id, amount: amount(), method: method(), transactionId: props.target.tx?.id ?? null, installmentId: props.target.inst?.id ?? null, note });
      props.onPaid(`Pembayaran ${rp(amount())} dicatat. Sisa hutang ${rp(r.newDebtBalance)}.`);
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Bayar hutang — ${props.customer.name}`} onClose={props.onClose}>
      <form onSubmit={submit} class="pay">
        <p class="small mut">
          {props.target.inst ? `Cicilan jatuh tempo ${fmtDate(Number(props.target.inst.dueDate))}` : props.target.tx ? `Nota ${props.target.tx.invoiceNo}` : 'Dialokasikan ke nota kasbon tertua dulu.'} · maks. {rp(props.target.max)}
        </p>
        <div class="seg methods">
          <For each={['cash', 'qris', 'transfer', 'ewallet', 'other'] as PaymentMethod[]}>{(m) => <button type="button" class={method() === m ? 'on' : ''} onClick={() => setMethod(m)}>{METHOD_LABEL[m]}</button>}</For>
        </div>
        <MoneyInput value={amount()} onInput={setAmount} autofocus class="big-input" />
        <input name="note" class="note" placeholder="Catatan (opsional)" maxlength="120" />
        <Show when={amount() > props.target.max}><p class="small bad-t">Melebihi sisa ({rp(props.target.max)}).</p></Show>
        <Show when={error()}><div class="alert err">{error()}</div></Show>
        <button class="btn primary block big" disabled={busy() || amount() <= 0 || amount() > props.target.max}>Simpan pembayaran</button>
      </form>
    </Modal>
  );
}

function PlanDialog(props: { ct: CreditTx; onClose: () => void; onSaved: () => void }) {
  const [count, setCount] = createSignal(3);
  const [gap, setGap] = createSignal(30);
  const [first, setFirst] = createSignal(toDateInput(Date.now() + 30 * 86_400_000));
  const [error, setError] = createSignal('');
  const total = () => props.ct.outstanding;
  const preview = createMemo(() => {
    const n = Math.max(1, Math.min(60, count()));
    const base = Math.floor(total() / n);
    return { n, base, last: total() - base * (n - 1) };
  });
  const save = async (e: Event) => {
    e.preventDefault();
    try {
      await createInstallmentPlan(db()!, props.ct.tx.id, total(), preview().n, new Date(`${first()}T00:00:00`).getTime(), Math.max(1, gap()));
      props.onSaved();
    } catch (err) {
      setError(msg(err));
    }
  };
  return (
    <Modal title={`Cicilan ${props.ct.tx.invoiceNo}`} onClose={props.onClose}>
      <form onSubmit={save} class="form-grid">
        <p class="small mut full">Sisa {rp(total())} dibagi rata; sisa pembagian masuk cicilan terakhir.</p>
        <div class="field"><label for="pc">Jumlah cicilan</label><input id="pc" inputmode="numeric" value={count()} onInput={(e) => setCount(parseInt(e.currentTarget.value, 10) || 1)} /></div>
        <div class="field"><label for="pi">Jarak (hari)</label><input id="pi" inputmode="numeric" value={gap()} onInput={(e) => setGap(parseInt(e.currentTarget.value, 10) || 1)} /></div>
        <div class="field full"><label for="pf">Jatuh tempo pertama</label><input id="pf" type="date" value={first()} onInput={(e) => setFirst(e.currentTarget.value)} required /></div>
        <p class="small full">{preview().n}× {rp(preview().base)}{preview().last !== preview().base ? ` (terakhir ${rp(preview().last)})` : ''}</p>
        <Show when={error()}><div class="alert err full">{error()}</div></Show>
        <button class="btn primary block full">Simpan jadwal</button>
      </form>
    </Modal>
  );
}
