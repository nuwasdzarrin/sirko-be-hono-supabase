import { createResource, createSignal, For, Show } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import type { Row } from '../db/db';
import { createLive } from '../lib/live';
import { can, db, sync, syncNow } from '../state';
import { rp } from '../pos/calc';
import { PosError } from '../pos/repo';
import { makeRange, walletCashFlow, type DateRange } from '../finance/report';
import { createWallet, deleteWallet, deposit, renameWallet, transfer, WALLET_TYPE_LABEL, withdraw, type WalletType } from '../finance/wallets';
import { fmtDateTime } from '../pos/receipt';
import { RangeBar } from './laporan';
import { isMobile } from '../lib/media';
import { Icon } from '../ui/icon';
import { Modal, MoneyInput, Toast } from './ui';

/** Kas & dompet — sama dengan menu Kas/Wallet HP (lihat: walletView; ubah: walletManagement). */

const msg = (e: unknown) => (e instanceof PosError ? e.message : `Gagal: ${(e as Error).message}`);
type Dlg = { kind: 'new' } | { kind: 'edit'; w: Row } | { kind: 'move'; w: Row; mode: 'in' | 'out' | 'transfer' } | null;

export function KasPage() {
  const params = useParams();
  const nav = useNavigate();
  const [range, setRange] = createSignal<DateRange>(makeRange('thisMonth'));
  const [dlg, setDlg] = createSignal<Dlg>(null);
  const [toast, setToast] = createSignal('');
  const say = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 3000);
  };
  const wallets = createLive(db, async (d) => (await d.t('wallets').toArray()).filter((w) => w.deletedAt == null).sort((a, b) => Number(a.createdAt) - Number(b.createdAt)), [] as Row[]);
  const [flows] = createResource(() => { const d = db(); return d ? { d, r: range(), n: wallets(), at: sync.lastAt } : null; }, ({ d, r }) => walletCashFlow(d, r));
  const total = () => wallets().reduce((s, w) => s + Number(w.balance ?? 0), 0);
  const manage = () => can('walletManagement');
  const sel = () => wallets().find((w) => w.id === params.id) ?? null;

  return (
    <div class="split">
      <section class="split-list">
        <div class="row-btns">
          <h1 style={{ margin: 0 }}>Kas & dompet</h1>
          <span class="spacer" />
          <Show when={manage()}><button class="btn sm primary" onClick={() => setDlg({ kind: 'new' })}>+ Dompet</button></Show>
        </div>
        <p class="mut small">Total saldo semua dompet: <b>{rp(total())}</b>. Penjualan tunai otomatis masuk ke dompet kas utama.</p>
        <RangeBar range={range()} onChange={setRange} />
        <Show when={isMobile()}>
          <div class="m-list">
            <For each={flows() ?? []} fallback={<div class="m-empty"><Icon name="wallet" size={48} /><b>Belum ada dompet</b></div>}>
              {(f) => (
                <button class="m-row" onClick={() => nav(`/kas/${f.walletId}`)}>
                  <span class="m-avatar"><Icon name="wallet" /></span>
                  <span class="m-row-text">
                    <span class="m-row-title">{f.name}</span>
                    <span class="m-row-sub">{WALLET_TYPE_LABEL[f.type as WalletType] ?? f.type} • masuk {rp(f.totalIn)} • keluar {rp(f.totalOut)}</span>
                  </span>
                  <span class="m-row-end"><b>{rp(f.balance)}</b></span>
                </button>
              )}
            </For>
          </div>
          <Show when={manage()}><button class="m-fab" onClick={() => setDlg({ kind: 'new' })}><Icon name="add" />Dompet</button></Show>
        </Show>
        <div class="card flush d-only">
          <table class="list hover">
            <thead><tr><th>Dompet</th><th class="num">Masuk</th><th class="num">Keluar</th><th class="num">Transfer ±</th><th class="num">Bersih</th><th class="num">Saldo</th></tr></thead>
            <tbody>
              <For each={flows() ?? []} fallback={<tr><td colspan="6" class="mut">Belum ada dompet.</td></tr>}>
                {(f) => (
                  <tr class={params.id === f.walletId ? 'sel' : ''} onClick={() => nav(`/kas/${f.walletId}`)}>
                    <td>{f.name}<div class="small mut">{WALLET_TYPE_LABEL[f.type as WalletType] ?? f.type}</div></td>
                    <td class="num">{rp(f.totalIn)}</td>
                    <td class="num">{rp(f.totalOut)}</td>
                    <td class="num">{f.transferIn - f.transferOut ? `${f.transferIn - f.transferOut > 0 ? '+' : ''}${rp(f.transferIn - f.transferOut)}` : '—'}</td>
                    <td class={`num ${f.net < 0 ? 'bad-t' : ''}`}>{rp(f.net)}</td>
                    <td class="num"><b>{rp(f.balance)}</b></td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </section>
      <Show when={sel()} keyed fallback={<aside class="split-detail mut empty">Pilih dompet untuk melihat mutasi.</aside>}>
        {(w) => <WalletDetail w={w} manage={manage()} onAct={(mode) => setDlg({ kind: 'move', w, mode })} onEdit={() => setDlg({ kind: 'edit', w })} onClose={() => nav('/kas')} />}
      </Show>
      <Show when={dlg()} keyed>
        {(d) => (d.kind === 'move'
          ? <MoveDialog w={d.w} mode={d.mode} wallets={wallets()} onClose={() => setDlg(null)} onDone={(m) => { setDlg(null); say(m); void syncNow(); }} />
          : <WalletDialog w={d.kind === 'edit' ? d.w : null} onClose={() => setDlg(null)} onDone={(m, id) => { setDlg(null); say(m); void syncNow(); nav(id ? `/kas/${id}` : '/kas'); }} />)}
      </Show>
      <Toast msg={toast()} />
    </div>
  );
}

function WalletDetail(props: { w: Row; manage: boolean; onAct: (m: 'in' | 'out' | 'transfer') => void; onEdit: () => void; onClose: () => void }) {
  const muts = createLive(
    () => { const d = db(); return d ? { d, id: props.w.id } : null; },
    async ({ d, id }) => {
      const own = await d.t('wallet_transactions').where('walletId').equals(id).toArray();
      const incoming = await d.t('wallet_transactions').where('targetWalletId').equals(id).toArray();
      return [...own, ...incoming].filter((m) => m.deletedAt == null).sort((a, b) => Number(b.datetime) - Number(a.datetime)).slice(0, 200);
    },
    [] as Row[],
  );
  const names = createLive(db, async (d) => new Map((await d.t('wallets').toArray()).map((w) => [w.id, String(w.name)])), new Map<string, string>());
  const sign = (m: Row) => (m.type === 'in' || (m.type === 'transfer' && m.targetWalletId === props.w.id) ? 1 : -1);
  return (
    <aside class="split-detail">
      <div class="row-btns">
        <h2 style={{ margin: 0 }}>{String(props.w.name)}</h2>
        <span class="spacer" />
        <button class="x" aria-label="Tutup" onClick={props.onClose}>×</button>
      </div>
      <div class="paysum" style={{ margin: '10px 0' }}><div class="kv"><span>Saldo</span><b>{rp(Number(props.w.balance ?? 0))}</b></div></div>
      <Show when={props.manage}>
        <div class="row-btns" style={{ 'margin-bottom': '10px' }}>
          <button class="btn sm primary" onClick={() => props.onAct('in')}>Uang masuk</button>
          <button class="btn sm" onClick={() => props.onAct('out')}>Uang keluar</button>
          <button class="btn sm" onClick={() => props.onAct('transfer')}>Transfer</button>
          <span class="spacer" />
          <button class="btn sm" onClick={props.onEdit}>Ubah</button>
        </div>
      </Show>
      <table class="list small">
        <tbody>
          <For each={muts()} fallback={<tr><td class="mut">Belum ada mutasi.</td></tr>}>
            {(m) => (
              <tr>
                <td>
                  {fmtDateTime(Number(m.datetime))}
                  <div class="mut">
                    {m.type === 'transfer' ? (sign(m) > 0 ? `Transfer dari ${names().get(String(m.walletId)) ?? '—'}` : `Transfer ke ${names().get(String(m.targetWalletId)) ?? '—'}`) : m.type === 'in' ? 'Masuk' : 'Keluar'}
                    {m.category ? ` · ${m.category}` : ''}{m.note ? ` · ${m.note}` : ''}
                  </div>
                </td>
                <td class={`num ${sign(m) < 0 ? 'bad-t' : ''}`}>{sign(m) > 0 ? '+' : '−'}{rp(Number(m.amount))}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </aside>
  );
}

function WalletDialog(props: { w: Row | null; onClose: () => void; onDone: (m: string, id?: string) => void }) {
  const [type, setType] = createSignal<WalletType>((props.w?.type as WalletType) ?? 'cash');
  const [opening, setOpening] = createSignal(0);
  const [error, setError] = createSignal('');
  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget as HTMLFormElement).get('name') ?? '');
    try {
      if (props.w) {
        await renameWallet(db()!, props.w.id, name, type());
        props.onDone('Dompet disimpan.', props.w.id);
      } else {
        const id = await createWallet(db()!, name, type(), opening());
        props.onDone('Dompet ditambahkan.', id);
      }
    } catch (err) {
      setError(msg(err));
    }
  };
  const remove = async () => {
    if (!props.w || !confirm(`Hapus dompet ${props.w.name}?`)) return;
    try {
      await deleteWallet(db()!, props.w.id);
      props.onDone('Dompet dihapus.');
    } catch (err) {
      setError(msg(err));
    }
  };
  return (
    <Modal title={props.w ? `Ubah ${props.w.name}` : 'Dompet baru'} onClose={props.onClose}>
      <form onSubmit={submit}>
        <Show when={error()}><div class="alert err">{error()}</div></Show>
        <div class="field"><label for="wn">Nama</label><input id="wn" name="name" required maxlength="60" value={String(props.w?.name ?? '')} autofocus placeholder="mis. Laci kasir, BCA, DANA" /></div>
        <div class="field"><label>Jenis</label>
          <div class="seg"><For each={Object.entries(WALLET_TYPE_LABEL)}>{([k, l]) => <button type="button" class={type() === k ? 'on' : ''} onClick={() => setType(k as WalletType)}>{l}</button>}</For></div>
        </div>
        <Show when={!props.w}><div class="field"><label>Saldo awal</label><MoneyInput value={opening()} onInput={setOpening} /></div></Show>
        <div class="row-btns">
          <Show when={props.w}><button type="button" class="btn bad" onClick={remove}>Hapus</button></Show>
          <span class="spacer" />
          <button class="btn primary">Simpan</button>
        </div>
      </form>
    </Modal>
  );
}

function MoveDialog(props: { w: Row; mode: 'in' | 'out' | 'transfer'; wallets: Row[]; onClose: () => void; onDone: (m: string) => void }) {
  const others = () => props.wallets.filter((x) => x.id !== props.w.id);
  const [amount, setAmount] = createSignal(0);
  const [target, setTarget] = createSignal(others()[0]?.id ?? '');
  const [error, setError] = createSignal('');
  const title = { in: 'Uang masuk', out: 'Uang keluar', transfer: 'Transfer' }[props.mode];
  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    const category = String(f.get('category') ?? '');
    const note = String(f.get('note') ?? '');
    try {
      if (props.mode === 'in') await deposit(db()!, props.w.id, amount(), category, note);
      else if (props.mode === 'out') await withdraw(db()!, props.w.id, amount(), category, note);
      else await transfer(db()!, props.w.id, target(), amount(), note);
      props.onDone(`${title} ${rp(amount())} dicatat.`);
    } catch (err) {
      setError(msg(err));
    }
  };
  return (
    <Modal title={`${title} — ${props.w.name}`} onClose={props.onClose}>
      <form onSubmit={submit}>
        <Show when={error()}><div class="alert err">{error()}</div></Show>
        <div class="field"><label>Nominal</label><MoneyInput value={amount()} onInput={setAmount} autofocus class="big-input" /></div>
        <Show
          when={props.mode === 'transfer'}
          fallback={<div class="field"><label for="mc">Kategori (opsional)</label><input id="mc" name="category" maxlength="40" list="wallet-cats" placeholder={props.mode === 'in' ? 'mis. modal' : 'mis. operasional, gaji, belanja'} /><datalist id="wallet-cats"><option>modal</option><option>operasional</option><option>gaji</option><option>belanja</option><option>prive</option><option>lainnya</option></datalist></div>}
        >
          <div class="field"><label for="mt">Ke dompet</label>
            <select id="mt" value={target()} onChange={(e) => setTarget(e.currentTarget.value)}>
              <For each={others()}>{(x) => <option value={x.id}>{String(x.name)} ({rp(Number(x.balance ?? 0))})</option>}</For>
            </select>
          </div>
        </Show>
        <div class="field"><label for="mn">Catatan (opsional)</label><input id="mn" name="note" maxlength="120" /></div>
        <p class="small mut">Saldo sekarang: {rp(Number(props.w.balance ?? 0))}</p>
        <button class="btn primary block" disabled={amount() <= 0 || (props.mode === 'transfer' && !target())}>Simpan</button>
      </form>
    </Modal>
  );
}
