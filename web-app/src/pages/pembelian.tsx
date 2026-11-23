import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import type { Row } from '../db/db';
import { createLive } from '../lib/live';
import { can, db, syncNow, user } from '../state';
import { num, rp } from '../pos/calc';
import { PosError, setSetting } from '../pos/repo';
import {
  costingMethod, COSTING_LABEL, createOpname, deleteSupplier, finalizeOpname, opnameSummary, paySupplierDebt, purchaseStatus, purchaseTotals,
  receivePurchase, saveSupplier, setPhysical, type CostingMethod, type PurchaseLine,
} from '../buy/repo';
import { fmtDateTime } from '../pos/receipt';
import { Modal, MoneyInput, Toast } from './ui';

/** Pembelian & supplier & stok opname — sama dengan menu Pembelian/Supplier/Opname aplikasi HP. */

const live = (r: Row) => r.deletedAt == null;
const msg = (e: unknown) => (e instanceof PosError ? e.message : `Gagal: ${(e as Error).message}`);
const STATUS: Record<string, [string, string]> = { paid: ['Lunas', 'ok'], partial: ['Sebagian', 'warn'], credit: ['Hutang', 'warn'] };
type Tab = 'beli' | 'supplier' | 'opname';

export function PembelianPage() {
  const params = useParams();
  const nav = useNavigate();
  const tab = () => (params.tab as Tab) || 'beli';
  const [toast, setToast] = createSignal('');
  const say = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 3000);
  };
  return (
    <>
      <div class="row-btns">
        <h1 style={{ margin: 0 }}>Pembelian & stok</h1>
        <span class="spacer" />
        <div class="seg ptabs">
          <button class={tab() === 'beli' ? 'on' : ''} onClick={() => nav('/pembelian')}>Pembelian</button>
          <button class={tab() === 'supplier' ? 'on' : ''} onClick={() => nav('/pembelian/supplier')}>Supplier</button>
          <button class={tab() === 'opname' ? 'on' : ''} onClick={() => nav('/pembelian/opname')}>Stok opname</button>
        </div>
      </div>
      <div style={{ 'margin-top': '14px' }}>
        <Show when={tab() === 'beli'}><PurchasesTab say={say} /></Show>
        <Show when={tab() === 'supplier'}><SuppliersTab say={say} /></Show>
        <Show when={tab() === 'opname'}><OpnameTab say={say} /></Show>
      </div>
      <Toast msg={toast()} />
    </>
  );
}

// ── Pembelian ────────────────────────────────────────────────────────────────

function PurchasesTab(props: { say: (m: string) => void }) {
  const purchases = createLive(db, async (d) => (await d.t('purchases').toArray()).filter(live).sort((a, b) => Number(b.datetime) - Number(a.datetime)).slice(0, 300), [] as Row[]);
  const suppliers = createLive(db, async (d) => new Map((await d.t('suppliers').toArray()).map((s) => [s.id, String(s.name)])), new Map<string, string>());
  const [form, setForm] = createSignal(false);
  const [detail, setDetail] = createSignal<Row | null>(null);
  const [method, { refetch }] = createResource(db, (d) => costingMethod(d));
  return (
    <>
      <div class="row-btns" style={{ 'margin-bottom': '10px' }}>
        <span class="small mut">Harga modal baru dihitung dengan: <b>{COSTING_LABEL[method() ?? 'last_cost']}</b></span>
        <Show when={user()?.isOwner}>
          <select class="sel" value={method() ?? 'last_cost'} onChange={async (e) => { await setSetting(db()!, 'costing_method', e.currentTarget.value); void refetch(); void syncNow(); }} aria-label="Metode harga modal">
            <For each={Object.entries(COSTING_LABEL)}>{([k, l]) => <option value={k}>{l}</option>}</For>
          </select>
        </Show>
        <span class="spacer" />
        <button class="btn primary" onClick={() => setForm(true)}>+ Terima barang (kulakan)</button>
      </div>
      <div class="card flush">
        <table class="list hover">
          <thead><tr><th>Waktu</th><th>No. nota</th><th>Supplier</th><th>Status</th><th class="num">Total</th></tr></thead>
          <tbody>
            <For each={purchases()} fallback={<tr><td colspan="5" class="mut">Belum ada pembelian.</td></tr>}>
              {(p) => (
                <tr onClick={() => setDetail(p)}>
                  <td>{fmtDateTime(Number(p.datetime))}</td>
                  <td>{String(p.refNo ?? '—')}</td>
                  <td>{suppliers().get(String(p.supplierId)) ?? '—'}</td>
                  <td><span class={`badge ${STATUS[String(p.status)]?.[1] ?? ''}`}>{STATUS[String(p.status)]?.[0] ?? String(p.status)}</span></td>
                  <td class="num">{rp(Number(p.grandTotal ?? 0))}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <Show when={form()}><PurchaseForm onClose={() => setForm(false)} onDone={(m) => { setForm(false); props.say(m); void syncNow(); }} /></Show>
      <Show when={detail()} keyed>{(p) => <PurchaseDetail p={p} supplier={suppliers().get(String(p.supplierId))} onClose={() => setDetail(null)} />}</Show>
    </>
  );
}

function PurchaseDetail(props: { p: Row; supplier?: string; onClose: () => void }) {
  const [items] = createResource(() => [db(), props.p.id] as const, async ([d, id]) => (d ? (await d.t('purchase_items').where('purchaseId').equals(id).toArray()).sort((a, b) => Number(a.createdAt) - Number(b.createdAt)) : []));
  const p = props.p;
  return (
    <Modal title={`Pembelian ${p.refNo ?? ''}`.trim()} onClose={props.onClose} wide>
      <p class="small mut">{fmtDateTime(Number(p.datetime))} · Supplier: {props.supplier ?? '—'}{p.note ? ` · ${p.note}` : ''}</p>
      <table class="list">
        <tbody>
          <For each={items()}>{(i) => <tr><td>{String(i.nameSnapshot)}<div class="small mut">{num(Number(i.qty))} × {rp(Number(i.costPrice))}</div></td><td class="num">{rp(Number(i.lineTotal))}</td></tr>}</For>
          <tr><td>Subtotal</td><td class="num">{rp(Number(p.subtotal ?? 0))}</td></tr>
          <Show when={Number(p.discountTotal)}><tr><td>Diskon</td><td class="num">-{rp(Number(p.discountTotal))}</td></tr></Show>
          <tr class="strong"><td>Total</td><td class="num">{rp(Number(p.grandTotal ?? 0))}</td></tr>
          <tr><td>Dibayar</td><td class="num">{rp(Number(p.paidTotal ?? 0))}</td></tr>
        </tbody>
      </table>
    </Modal>
  );
}

function PurchaseForm(props: { onClose: () => void; onDone: (m: string) => void }) {
  const products = createLive(db, async (d) => (await d.t('products').toArray()).filter((p) => live(p)).sort((a, b) => String(a.name).localeCompare(String(b.name))), [] as Row[]);
  const variants = createLive(db, async (d) => (await d.t('product_variants').toArray()).filter(live), [] as Row[]);
  const suppliers = createLive(db, async (d) => (await d.t('suppliers').toArray()).filter(live).sort((a, b) => String(a.name).localeCompare(String(b.name))), [] as Row[]);
  const wallets = createLive(db, async (d) => (await d.t('wallets').toArray()).filter(live), [] as Row[]);
  const [lines, setLines] = createSignal<PurchaseLine[]>([]);
  const [q, setQ] = createSignal('');
  const [supplierId, setSupplierId] = createSignal('');
  const [discount, setDiscount] = createSignal(0);
  const [paid, setPaid] = createSignal<number | null>(null);
  const [walletId, setWalletId] = createSignal('');
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  // Kandidat: produk biasa + setiap varian (stok & modal per varian).
  const options = createMemo(() => {
    const out: Array<{ key: string; productId: string; variantId: string | null; name: string; cost: number; barcode: string }> = [];
    for (const p of products()) {
      if (p.hasVariants === true) for (const v of variants().filter((x) => x.productId === p.id)) out.push({ key: v.id, productId: p.id, variantId: v.id, name: `${p.name} — ${v.name}`, cost: Number(v.costPrice ?? 0), barcode: String(v.barcode ?? '') });
      else out.push({ key: p.id, productId: p.id, variantId: null, name: String(p.name), cost: Number(p.costPrice ?? 0), barcode: String(p.barcode ?? '') });
    }
    return out;
  });
  const found = createMemo(() => {
    const s = q().trim().toLowerCase();
    return s ? options().filter((o) => o.name.toLowerCase().includes(s) || o.barcode === s).slice(0, 8) : [];
  });
  const add = (o: ReturnType<typeof options>[number]) => {
    const ex = lines().findIndex((l) => (l.variantId ?? l.productId) === o.key);
    if (ex >= 0) setLines(lines().map((l, i) => (i === ex ? { ...l, qty: l.qty + 1 } : l)));
    else setLines([...lines(), { productId: o.productId, variantId: o.variantId, nameSnapshot: o.name, qty: 1, costPrice: o.cost }]);
    setQ('');
  };
  const setLine = (i: number, patch: Partial<PurchaseLine>) => setLines(lines().map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const totals = () => purchaseTotals(lines(), discount());
  const paidVal = () => paid() ?? totals().grandTotal;

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    setBusy(true);
    setError('');
    try {
      const r = await receivePurchase(db()!, { lines: lines(), supplierId: supplierId() || null, refNo: String(f.get('refNo') ?? ''), discountTotal: discount(), paidTotal: paidVal(), walletId: walletId() || null, note: String(f.get('note') ?? '') });
      props.onDone(`Barang diterima, stok bertambah.${r.debtAdded ? ` Hutang ke supplier ${rp(r.debtAdded)}.` : ''}`);
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Terima barang dari supplier" onClose={props.onClose} wide>
      <form onSubmit={submit}>
        <Show when={error()}><div class="alert err">{error()}</div></Show>
        <div class="form-grid">
          <div class="field"><label for="ps">Supplier</label>
            <select id="ps" value={supplierId()} onChange={(e) => setSupplierId(e.currentTarget.value)}>
              <option value="">— tanpa supplier —</option>
              <For each={suppliers()}>{(s) => <option value={s.id}>{String(s.name)}</option>}</For>
            </select>
          </div>
          <div class="field"><label for="pr">No. nota supplier</label><input id="pr" name="refNo" maxlength="60" /></div>
        </div>
        <input
          class="pos-search"
          placeholder="Scan barcode / cari produk lalu Enter"
          value={q()}
          autofocus
          onInput={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const exact = options().find((o) => o.barcode && o.barcode === q().trim());
            const pick = exact ?? (found().length === 1 ? found()[0] : undefined);
            if (pick) add(pick);
          }}
        />
        <div class="clist" style={{ 'max-height': '150px' }}><For each={found()}>{(o) => <button type="button" class="crow" onClick={() => add(o)}><b>{o.name}</b><span class="mut small">modal {rp(o.cost)}</span></button>}</For></div>
        <table class="list" style={{ 'margin-top': '8px' }}>
          <thead><tr><th>Barang</th><th class="num">Qty</th><th class="num">Harga beli</th><th class="num">Jumlah</th><th /></tr></thead>
          <tbody>
            <For each={lines()} fallback={<tr><td colspan="5" class="mut">Belum ada barang.</td></tr>}>
              {(l, i) => (
                <tr>
                  <td>{l.nameSnapshot}</td>
                  <td class="num"><input class="mini" inputmode="numeric" value={l.qty} onInput={(e) => setLine(i(), { qty: parseInt(e.currentTarget.value, 10) || 0 })} aria-label="Qty" /></td>
                  <td class="num"><MoneyInput class="mini" value={l.costPrice} onInput={(n) => setLine(i(), { costPrice: n })} /></td>
                  <td class="num">{rp(l.qty * l.costPrice)}</td>
                  <td class="num"><button type="button" class="btn sm" onClick={() => setLines(lines().filter((_, j) => j !== i()))}>Hapus</button></td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <div class="form-grid" style={{ 'margin-top': '12px' }}>
          <div class="field"><label>Diskon nota</label><MoneyInput value={discount()} onInput={setDiscount} /></div>
          <div class="field"><label>Dibayar sekarang</label><MoneyInput value={paidVal()} onInput={setPaid} /></div>
          <div class="field"><label for="pw">Bayar dari dompet</label>
            <select id="pw" value={walletId()} onChange={(e) => setWalletId(e.currentTarget.value)}>
              <option value="">— tidak dicatat di kas —</option>
              <For each={wallets()}>{(w) => <option value={w.id}>{String(w.name)} ({rp(Number(w.balance ?? 0))})</option>}</For>
            </select>
          </div>
          <div class="field"><label for="pn">Catatan</label><input id="pn" name="note" maxlength="120" /></div>
        </div>
        <div class="paysum">
          <div class="kv"><span>Total</span><b>{rp(totals().grandTotal)}</b></div>
          <Show when={paidVal() < totals().grandTotal}><div class="kv bad-t"><span>Jadi hutang ke supplier</span><b>{rp(totals().grandTotal - paidVal())}</b></div></Show>
          <div class="kv"><span>Status</span><span>{STATUS[purchaseStatus(totals().grandTotal, paidVal())]?.[0]}</span></div>
        </div>
        <button class="btn primary block big" style={{ 'margin-top': '12px' }} disabled={busy() || !lines().length}>{busy() ? 'Menyimpan…' : 'Simpan & tambah stok'}</button>
      </form>
    </Modal>
  );
}

// ── Supplier ─────────────────────────────────────────────────────────────────

function SuppliersTab(props: { say: (m: string) => void }) {
  const suppliers = createLive(db, async (d) => (await d.t('suppliers').toArray()).filter(live).sort((a, b) => String(a.name).localeCompare(String(b.name))), [] as Row[]);
  const [edit, setEdit] = createSignal<Row | 'new' | null>(null);
  const [pay, setPay] = createSignal<Row | null>(null);
  const total = () => suppliers().reduce((s, x) => s + Number(x.debtBalance ?? 0), 0);
  return (
    <>
      <div class="row-btns" style={{ 'margin-bottom': '10px' }}>
        <span class="small mut">Total hutang ke supplier: <b class={total() ? 'bad-t' : ''}>{rp(total())}</b></span>
        <span class="spacer" />
        <button class="btn primary" onClick={() => setEdit('new')}>+ Supplier</button>
      </div>
      <div class="card flush">
        <table class="list hover">
          <thead><tr><th>Nama</th><th>No. HP</th><th class="num">Hutang</th><th /></tr></thead>
          <tbody>
            <For each={suppliers()} fallback={<tr><td colspan="4" class="mut">Belum ada supplier.</td></tr>}>
              {(s) => (
                <tr onClick={() => setEdit(s)}>
                  <td>{String(s.name)}<div class="small mut">{String(s.address ?? '')}</div></td>
                  <td>{String(s.phone ?? '—')}</td>
                  <td class={`num ${Number(s.debtBalance ?? 0) ? 'bad-t' : 'mut'}`}>{Number(s.debtBalance ?? 0) ? rp(Number(s.debtBalance)) : '—'}</td>
                  <td class="num"><Show when={Number(s.debtBalance ?? 0) > 0}><button class="btn sm" onClick={(e) => { e.stopPropagation(); setPay(s); }}>Bayar</button></Show></td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <Show when={edit()} keyed>{(s) => <SupplierForm s={s === 'new' ? null : s} onClose={() => setEdit(null)} onDone={(m) => { setEdit(null); props.say(m); void syncNow(); }} />}</Show>
      <Show when={pay()} keyed>{(s) => <PaySupplier s={s} onClose={() => setPay(null)} onDone={(m) => { setPay(null); props.say(m); void syncNow(); }} />}</Show>
    </>
  );
}

function SupplierForm(props: { s: Row | null; onClose: () => void; onDone: (m: string) => void }) {
  const [error, setError] = createSignal('');
  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    try {
      await saveSupplier(db()!, props.s?.id ?? null, { name: String(f.get('name') ?? ''), phone: String(f.get('phone') ?? ''), address: String(f.get('address') ?? ''), note: String(f.get('note') ?? '') });
      props.onDone(props.s ? 'Supplier disimpan.' : 'Supplier ditambahkan.');
    } catch (err) {
      setError(msg(err));
    }
  };
  return (
    <Modal title={props.s ? `Ubah ${props.s.name}` : 'Supplier baru'} onClose={props.onClose}>
      <form onSubmit={submit}>
        <Show when={error()}><div class="alert err">{error()}</div></Show>
        <div class="field"><label for="sn">Nama</label><input id="sn" name="name" required maxlength="120" value={String(props.s?.name ?? '')} autofocus /></div>
        <div class="field"><label for="sp">No. HP</label><input id="sp" name="phone" maxlength="20" value={String(props.s?.phone ?? '')} /></div>
        <div class="field"><label for="sa">Alamat</label><input id="sa" name="address" maxlength="200" value={String(props.s?.address ?? '')} /></div>
        <div class="field"><label for="st">Catatan</label><input id="st" name="note" maxlength="200" value={String(props.s?.note ?? '')} /></div>
        <div class="row-btns">
          <Show when={props.s}><button type="button" class="btn bad" onClick={async () => { if (!confirm(`Hapus supplier ${props.s!.name}?`)) return; try { await deleteSupplier(db()!, props.s!.id); props.onDone('Supplier dihapus.'); } catch (err) { setError(msg(err)); } }}>Hapus</button></Show>
          <span class="spacer" />
          <button class="btn primary">Simpan</button>
        </div>
      </form>
    </Modal>
  );
}

function PaySupplier(props: { s: Row; onClose: () => void; onDone: (m: string) => void }) {
  const wallets = createLive(db, async (d) => (await d.t('wallets').toArray()).filter(live), [] as Row[]);
  const [amount, setAmount] = createSignal(Number(props.s.debtBalance ?? 0));
  const [walletId, setWalletId] = createSignal('');
  const [error, setError] = createSignal('');
  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    try {
      const left = await paySupplierDebt(db()!, props.s.id, amount(), walletId() || null);
      props.onDone(`Pembayaran dicatat. Sisa hutang ${rp(left)}.`);
    } catch (err) {
      setError(msg(err));
    }
  };
  return (
    <Modal title={`Bayar hutang — ${props.s.name}`} onClose={props.onClose}>
      <form onSubmit={submit}>
        <Show when={error()}><div class="alert err">{error()}</div></Show>
        <p class="small mut">Hutang: {rp(Number(props.s.debtBalance ?? 0))}</p>
        <div class="field"><label>Nominal</label><MoneyInput value={amount()} onInput={setAmount} autofocus class="big-input" /></div>
        <div class="field"><label for="pw2">Dari dompet</label>
          <select id="pw2" value={walletId()} onChange={(e) => setWalletId(e.currentTarget.value)}>
            <option value="">— tidak dicatat di kas —</option>
            <For each={wallets()}>{(w) => <option value={w.id}>{String(w.name)} ({rp(Number(w.balance ?? 0))})</option>}</For>
          </select>
        </div>
        <button class="btn primary block" disabled={amount() <= 0}>Simpan pembayaran</button>
      </form>
    </Modal>
  );
}

// ── Stok opname ──────────────────────────────────────────────────────────────

function OpnameTab(props: { say: (m: string) => void }) {
  const opnames = createLive(db, async (d) => (await d.t('stock_opnames').toArray()).filter(live).sort((a, b) => Number(b.datetime) - Number(a.datetime)), [] as Row[]);
  const [open, setOpen] = createSignal<string | null>(null);
  const start = async () => {
    const ref = prompt('Nomor / nama sesi opname (opsional):', `OP-${new Date().toISOString().slice(0, 10)}`) ?? undefined;
    const id = await createOpname(db()!, user()?.id ?? null, ref);
    setOpen(id);
  };
  return (
    <>
      <div class="row-btns" style={{ 'margin-bottom': '10px' }}>
        <span class="small mut">Hitung stok fisik semua barang, lalu finalkan: stok sistem disamakan dengan hasil hitung.</span>
        <span class="spacer" />
        <Show when={can('productManagement')}><button class="btn primary" onClick={() => void start()}>+ Mulai opname</button></Show>
      </div>
      <div class="card flush">
        <table class="list hover">
          <thead><tr><th>Waktu</th><th>Sesi</th><th>Status</th></tr></thead>
          <tbody>
            <For each={opnames()} fallback={<tr><td colspan="3" class="mut">Belum ada sesi opname.</td></tr>}>
              {(o) => (
                <tr onClick={() => setOpen(o.id)}>
                  <td>{fmtDateTime(Number(o.datetime))}</td>
                  <td>{String(o.refNo ?? '—')}</td>
                  <td><span class={`badge ${o.status === 'draft' ? 'warn' : ''}`}>{o.status === 'draft' ? 'Sedang dihitung' : 'Final'}</span></td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <Show when={open()} keyed>{(id) => <OpnameSession id={id} onClose={() => setOpen(null)} say={props.say} />}</Show>
    </>
  );
}

function OpnameSession(props: { id: string; onClose: () => void; say: (m: string) => void }) {
  const o = createLive(db, async (d) => (await d.t('stock_opnames').get(props.id)) ?? null, null as Row | null);
  const items = createLive(db, async (d) => (await d.t('stock_opname_items').where('opnameId').equals(props.id).toArray()).sort((a, b) => String(a.nameSnapshot).localeCompare(String(b.nameSnapshot))), [] as Row[]);
  const [sum] = createResource(() => [db(), items()] as const, async ([d]) => (d ? opnameSummary(d, props.id) : null));
  const [q, setQ] = createSignal('');
  const [onlyDiff, setOnlyDiff] = createSignal(false);
  const draft = () => o()?.status === 'draft';
  const list = createMemo(() => items().filter((i) => (!onlyDiff() || Number(i.diff)) && String(i.nameSnapshot).toLowerCase().includes(q().trim().toLowerCase())));
  const finalize = async () => {
    if (!confirm('Finalkan opname? Stok semua barang yang berbeda akan disamakan dengan hasil hitung fisik.')) return;
    try {
      const n = await finalizeOpname(db()!, props.id);
      props.say(`Opname final: ${n} barang disesuaikan.`);
      void syncNow();
    } catch (err) {
      alert(msg(err));
    }
  };
  return (
    <Modal title={`Opname ${o()?.refNo ?? ''}`.trim()} onClose={props.onClose} wide>
      <Show when={sum()}>
        {(s) => (
          <div class="paysum" style={{ 'margin-bottom': '10px' }}>
            <div class="kv"><span>Barang berbeda</span><b>{s().changed}</b></div>
            <div class="kv"><span>Lebih / kurang</span><span>+{num(s().surplus)} / −{num(s().shortage)}</span></div>
            <Show when={can('viewCostProfit')}><div class="kv bad-t"><span>Nilai kekurangan (modal)</span><b>{rp(s().loss)}</b></div></Show>
          </div>
        )}
      </Show>
      <div class="filters">
        <input class="pos-search" placeholder="Cari barang" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
        <label class="small"><input type="checkbox" checked={onlyDiff()} onChange={(e) => setOnlyDiff(e.currentTarget.checked)} /> Hanya yang berbeda</label>
      </div>
      <table class="list">
        <thead><tr><th>Barang</th><th class="num">Sistem</th><th class="num">Fisik</th><th class="num">Selisih</th></tr></thead>
        <tbody>
          <For each={list()}>
            {(i) => (
              <tr>
                <td>{String(i.nameSnapshot)}</td>
                <td class="num">{num(Number(i.systemQty))}</td>
                <td class="num">
                  <Show when={draft()} fallback={num(Number(i.physicalQty))}>
                    <input class="mini" inputmode="numeric" value={Number(i.physicalQty)} aria-label={`Fisik ${i.nameSnapshot}`} onFocus={(e) => e.currentTarget.select()} onChange={(e) => { const n = parseInt(e.currentTarget.value, 10); if (Number.isFinite(n) && n >= 0) void setPhysical(db()!, i.id, n); }} />
                  </Show>
                </td>
                <td class={`num ${Number(i.diff) < 0 ? 'bad-t' : ''}`}>{Number(i.diff) ? `${Number(i.diff) > 0 ? '+' : ''}${num(Number(i.diff))}` : '—'}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <Show when={draft()}>
        <p class="small mut">Hasil hitung tersimpan di komputer ini sampai difinalkan.</p>
        <button class="btn primary block" onClick={() => void finalize()}>Finalkan opname</button>
      </Show>
    </Modal>
  );
}

export type { CostingMethod };
