import { createEffect, createMemo, createResource, createSignal, For, Index, onCleanup, onMount, Show } from 'solid-js';
import type { Row, StoreDb } from '../db/db';
import { createLive } from '../lib/live';
import { uuid } from '../lib/crypto';
import { activeStore, db, syncNow, user } from '../state';
import {
  addProduct, bindCart, cart, clearCart, lineKey, removeLine, restoreCart, setCustomer, setLineDiscount, setNote,
  setPosConfig, setQty, setTxDiscount, snapshot, totals,
} from '../pos/cart';
import { cashSuggestions, METHOD_LABEL, num, resolvePayment, rp, type DiscountType, type PaymentEntry, type PaymentMethod } from '../pos/calc';
import {
  billSummary, closeBill, commitSale, getBool, holdSale, KEY_ALLOW_NEGATIVE_STOCK, KEY_REQUIRE_OPEN_BILL, openBill, openBillFor,
  paymentOptions, PosError, resumeHeld, storeInfo, tiersFor, type BillSummary, type CommitResult,
} from '../pos/repo';
import { loadReceipt, printReceipt, Receipt, type ReceiptData } from '../pos/receipt';
import { Modal, MoneyInput, Toast } from './ui';

const live = (r: Row) => r.deletedAt == null;

type Dialog =
  | { kind: 'variant'; product: Row }
  | { kind: 'line'; key: string }
  | { kind: 'txDiscount' }
  | { kind: 'customer'; thenPay?: boolean }
  | { kind: 'pay'; credit?: boolean }
  | { kind: 'done'; result: CommitResult; receipt: ReceiptData | null }
  | { kind: 'held' }
  | { kind: 'shift' }
  | null;

export function KasirPage() {
  const [dialog, setDialog] = createSignal<Dialog>(null);
  const [toast, setToast] = createSignal<{ msg: string; kind: 'ok' | 'err' | 'warn' }>({ msg: '', kind: 'ok' });
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const say = (msg: string, kind: 'ok' | 'err' | 'warn' = 'ok') => {
    setToast({ msg, kind });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast({ msg: '', kind }), 3500);
  };

  // Keranjang & konfigurasi pajak/pembulatan milik toko aktif.
  createEffect(() => {
    const d = db();
    if (!d) return;
    void bindCart(d);
    void storeInfo(d, activeStore()?.name ?? 'Toko').then((s) => setPosConfig(s.config));
  });

  const products = createLive(db, async (d) => (await d.t('products').toArray()).filter((p) => live(p) && p.isActive !== false).sort((a, b) => String(a.name).localeCompare(String(b.name))), [] as Row[]);
  const variants = createLive(db, async (d) => (await d.t('product_variants').toArray()).filter(live), [] as Row[]);
  const categories = createLive(db, async (d) => (await d.t('categories').toArray()).filter(live).sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0)), [] as Row[]);
  const customers = createLive(db, async (d) => (await d.t('customers').toArray()).filter(live).sort((a, b) => String(a.name).localeCompare(String(b.name))), [] as Row[]);
  const heldCount = createLive(db, (d) => d.held_sales.count(), 0);
  const settings = createLive(db, async (d) => ({ allowNegative: await getBool(d, KEY_ALLOW_NEGATIVE_STOCK), requireBill: await getBool(d, KEY_REQUIRE_OPEN_BILL) }), { allowNegative: false, requireBill: false });
  const bill = createLive(() => { const d = db(); const u = user(); return d && u ? { d, u: u.id } : null; }, ({ d, u }) => openBillFor(d, u), null as Row | null);

  const variantsOf = createMemo(() => {
    const m = new Map<string, Row[]>();
    for (const v of variants()) {
      const k = String(v.productId);
      m.set(k, [...(m.get(k) ?? []), v]);
    }
    return m;
  });

  const [query, setQuery] = createSignal('');
  const [cat, setCat] = createSignal<string>('');
  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    return products().filter((p) => (!cat() || p.categoryId === cat()) && (!q || String(p.name).toLowerCase().includes(q) || String(p.barcode ?? '').includes(q) || (variantsOf().get(p.id) ?? []).some((v) => String(v.barcode ?? '') === q)));
  });

  const stockOf = (p: Row) => (p.hasVariants === true ? (variantsOf().get(p.id) ?? []).reduce((s, v) => s + Number(v.stock ?? 0), 0) : Number(p.stock ?? 0));

  const add = async (p: Row, variant?: Row) => {
    const d = db();
    if (!d) return;
    if (!variant && p.hasVariants === true && (variantsOf().get(p.id) ?? []).length) {
      setDialog({ kind: 'variant', product: p });
      return;
    }
    const r = addProduct(p, await tiersFor(d, p.id), variant);
    if (r === 'needs_price') say(`"${p.name}" belum punya harga jual. Lengkapi harganya dulu di menu Produk.`, 'warn');
  };

  let searchEl: HTMLInputElement | undefined;
  const focusSearch = () => searchEl?.focus();

  /** Enter di kotak cari = scan barcode (scanner USB mengetik + Enter) atau satu-satunya hasil. */
  const onSearchEnter = async () => {
    const q = query().trim();
    if (!q) return;
    const byBarcode = products().find((p) => String(p.barcode ?? '') === q);
    const vByBarcode = variants().find((v) => String(v.barcode ?? '') === q);
    if (vByBarcode) {
      const p = products().find((x) => x.id === vByBarcode.productId);
      if (p) await add(p, vByBarcode);
    } else if (byBarcode) await add(byBarcode);
    else if (filtered().length === 1) await add(filtered()[0]!);
    else {
      say(filtered().length ? 'Pilih produk dari daftar.' : `Produk "${q}" tidak ditemukan.`, 'warn');
      return;
    }
    setQuery('');
  };

  // Pintasan keyboard: F2 cari · F4 pelanggan · F8 bayar · F9 tunda.
  const onKey = (e: KeyboardEvent) => {
    if (dialog()) return;
    if (e.key === 'F2') { e.preventDefault(); focusSearch(); }
    else if (e.key === 'F4') { e.preventDefault(); setDialog({ kind: 'customer' }); }
    else if (e.key === 'F8') { e.preventDefault(); startPay(); }
    else if (e.key === 'F9') { e.preventDefault(); void hold(); }
  };
  onMount(() => {
    document.addEventListener('keydown', onKey);
    focusSearch();
  });
  onCleanup(() => document.removeEventListener('keydown', onKey));
  createEffect(() => {
    if (!dialog()) queueMicrotask(focusSearch);
  });

  const customer = () => customers().find((c) => c.id === cart.customerId) ?? null;

  const startPay = () => {
    if (!cart.lines.length) return say('Keranjang masih kosong.', 'warn');
    if (settings().requireBill && !bill()) {
      setDialog({ kind: 'shift' });
      return say('Buka shift dulu sebelum bertransaksi.', 'warn');
    }
    setDialog({ kind: 'pay' });
  };

  const hold = async () => {
    const d = db();
    if (!d || !cart.lines.length) return;
    await holdSale(d, snapshot(), totals().grandTotal, user()?.id ?? null);
    clearCart();
    say('Transaksi ditunda.');
  };

  const resume = async (id: string) => {
    const d = db();
    if (!d) return;
    if (cart.lines.length && !confirm('Keranjang sekarang akan diganti dengan transaksi tertunda. Lanjutkan? (Tunda dulu keranjang ini bila masih dipakai.)')) return;
    const s = await resumeHeld(d, id);
    if (s) restoreCart(s);
    setDialog(null);
  };

  const pay = async (payments: PaymentEntry[], allowCredit: boolean): Promise<string | null> => {
    const d = db();
    const u = user();
    if (!d || !u) return 'Sesi tidak aktif.';
    try {
      const result = await commitSale(d, {
        totals: totals(),
        payments,
        allowCredit,
        customerId: cart.customerId,
        cashierId: u.id,
        billId: bill()?.id ?? null,
        note: cart.note,
      });
      clearCart();
      void syncNow();
      setDialog({ kind: 'done', result, receipt: await loadReceipt(d, result.transactionId, activeStore()?.name ?? 'Toko') });
      return null;
    } catch (e) {
      return e instanceof PosError ? e.message : `Gagal menyimpan: ${(e as Error).message}`;
    }
  };

  return (
    <div class="pos">
      <section class="pos-left">
        <div class="pos-bar">
          <input
            ref={searchEl}
            class="pos-search"
            placeholder="Cari nama / scan barcode lalu Enter  (F2)"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void onSearchEnter(); }
              if (e.key === 'Escape') setQuery('');
            }}
            aria-label="Cari produk atau scan barcode"
          />
          <ShiftButton bill={bill()} required={settings().requireBill} onClick={() => setDialog({ kind: 'shift' })} />
        </div>
        <Show when={categories().length}>
          <div class="chips">
            <button class={`chip ${!cat() ? 'on' : ''}`} onClick={() => setCat('')}>Semua</button>
            <For each={categories()}>{(c) => <button class={`chip ${cat() === c.id ? 'on' : ''}`} onClick={() => setCat(c.id)}>{String(c.name)}</button>}</For>
          </div>
        </Show>
        <div class="grid">
          <For each={filtered().slice(0, 200)} fallback={<p class="mut">{products().length ? 'Tidak ada produk yang cocok.' : 'Belum ada produk. Tambahkan produk dari aplikasi HP (atau menu Produk di Fase 3).'}</p>}>
            {(p) => {
              const s = () => stockOf(p);
              return (
                <button class={`pcard ${p.needsPrice === true ? 'np' : ''}`} onClick={() => void add(p)}>
                  <span class="pname">{String(p.name)}</span>
                  <span class="pprice">{p.needsPrice === true ? 'Perlu harga' : p.hasVariants === true ? `${(variantsOf().get(p.id) ?? []).length} varian` : rp(Number(p.sellingPrice ?? 0))}</span>
                  <span class={`pstock ${s() <= 0 ? 'bad' : s() <= Number(p.minStock ?? 0) ? 'warn' : ''}`}>Stok {num(s())}</span>
                </button>
              );
            }}
          </For>
        </div>
        <Show when={filtered().length > 200}><p class="mut small">Menampilkan 200 dari {filtered().length} produk — perjelas pencarian.</p></Show>
      </section>

      <aside class="pos-cart">
        <div class="cart-head">
          <b>Keranjang</b>
          <span class="mut small">{totals().itemCount} item</span>
          <span class="spacer" />
          <button class="btn sm" onClick={() => setDialog({ kind: 'held' })}>Tertunda{heldCount() ? ` (${heldCount()})` : ''}</button>
        </div>
        <button class="cust" onClick={() => setDialog({ kind: 'customer' })}>
          <span class="mut small">Pelanggan (F4)</span>
          <b>{customer() ? String(customer()!.name) : 'Umum'}</b>
          <Show when={customer() && Number(customer()!.debtBalance ?? 0) > 0}><span class="small bad-t">Hutang {rp(Number(customer()!.debtBalance))}</span></Show>
        </button>
        <div class="lines">
          <For each={totals().lineResults} fallback={<p class="mut empty">Scan barcode atau klik produk untuk menambah.</p>}>
            {(r) => {
              const k = lineKey(r.line);
              const over = () => !settings().allowNegative && r.line.qty > r.line.availableStock;
              return (
                <div class="line">
                  <button class="lname" onClick={() => setDialog({ kind: 'line', key: k })} title="Ubah jumlah / diskon">
                    {r.line.nameSnapshot}
                    <span class="small mut">
                      {rp(r.effectiveUnitPrice)}{r.appliedWholesale ? ' · grosir' : ''}{r.discount ? ` · diskon ${rp(r.discount)}` : ''}
                    </span>
                    <Show when={over()}><span class="small bad-t">Stok tinggal {r.line.availableStock}</span></Show>
                  </button>
                  <div class="qty">
                    <button aria-label="Kurangi" onClick={() => setQty(k, r.line.qty - 1)}>−</button>
                    <input value={r.line.qty} inputmode="numeric" aria-label="Jumlah" onChange={(e) => setQty(k, parseInt(e.currentTarget.value, 10) || 0)} onFocus={(e) => e.currentTarget.select()} />
                    <button aria-label="Tambah" onClick={() => setQty(k, r.line.qty + 1)}>+</button>
                  </div>
                  <span class="ltotal">{rp(r.lineTotal)}</span>
                </div>
              );
            }}
          </For>
        </div>
        <div class="sum">
          <div class="kv"><span>Subtotal</span><span>{rp(totals().subtotal)}</span></div>
          <button class="kv link" onClick={() => setDialog({ kind: 'txDiscount' })}>
            <span>Diskon transaksi</span><span>{totals().discountTotal ? `-${rp(totals().discountTotal)}` : 'Tambah'}</span>
          </button>
          <Show when={totals().taxTotal}><div class="kv"><span>Pajak{totals().grandTotalBeforeRounding === totals().subtotal - totals().discountTotal ? ' (termasuk)' : ''}</span><span>{rp(totals().taxTotal)}</span></div></Show>
          <Show when={totals().roundingAdjustment}><div class="kv"><span>Pembulatan</span><span>{rp(totals().roundingAdjustment)}</span></div></Show>
          <div class="kv total"><span>Total</span><span>{rp(totals().grandTotal)}</span></div>
          <input class="note" placeholder="Catatan (opsional)" value={cart.note} onChange={(e) => setNote(e.currentTarget.value)} maxlength="200" />
          <div class="actions">
            <button class="btn" disabled={!cart.lines.length} onClick={() => confirm('Kosongkan keranjang?') && clearCart()}>Kosongkan</button>
            <button class="btn" disabled={!cart.lines.length} onClick={() => void hold()}>Tunda (F9)</button>
            <button class="btn primary big" disabled={!cart.lines.length} onClick={startPay}>Bayar {rp(totals().grandTotal)} (F8)</button>
          </div>
        </div>
      </aside>

      <Show when={dialog()} keyed>
        {(d) => {
          const close = () => setDialog(null);
          switch (d.kind) {
            case 'variant':
              return <VariantDialog product={d.product} variants={variantsOf().get(d.product.id) ?? []} onPick={(v) => { void add(d.product, v); close(); }} onClose={close} />;
            case 'line':
              return <LineDialog lineKey={d.key} onClose={close} />;
            case 'txDiscount':
              return <TxDiscountDialog onClose={close} />;
            case 'customer':
              return <CustomerDialog customers={customers()} onPick={(id) => { setCustomer(id); setDialog(d.thenPay ? { kind: 'pay', credit: true } : null); }} onClose={() => setDialog(d.thenPay ? { kind: 'pay', credit: true } : null)} />;
            case 'pay':
              return <PayDialog customer={customer()} initialCredit={d.credit} onPay={pay} onPickCustomer={() => setDialog({ kind: 'customer', thenPay: true })} onClose={close} />;
            case 'done':
              return <DoneDialog result={d.result} receipt={d.receipt} onClose={close} />;
            case 'held':
              return <HeldDialog onResume={resume} onClose={close} />;
            case 'shift':
              return <ShiftDialog bill={bill()} onClose={close} say={say} />;
          }
        }}
      </Show>
      <Toast msg={toast().msg} kind={toast().kind} />
    </div>
  );
}

function ShiftButton(props: { bill: Row | null; required: boolean; onClick: () => void }) {
  const t = () => (props.bill ? new Date(Number(props.bill.openedAt)).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '');
  return (
    <button class={`btn ${!props.bill && props.required ? 'warn' : ''}`} onClick={props.onClick} title="Buka / tutup shift (rekap kas laci)">
      <span class={`dot ${props.bill ? '' : 'off'}`} />
      {props.bill ? `Shift sejak ${t()}` : 'Shift belum dibuka'}
    </button>
  );
}

function VariantDialog(props: { product: Row; variants: Row[]; onPick: (v: Row) => void; onClose: () => void }) {
  return (
    <Modal title={`Pilih varian — ${String(props.product.name)}`} onClose={props.onClose}>
      <div class="vlist">
        <For each={props.variants}>
          {(v, i) => (
            <button class="vbtn" autofocus={i() === 0} onClick={() => props.onPick(v)}>
              <b>{String(v.name)}</b>
              <span>{rp(Number(v.sellingPrice ?? 0))}</span>
              <span class={`small ${Number(v.stock ?? 0) <= 0 ? 'bad-t' : 'mut'}`}>Stok {num(Number(v.stock ?? 0))}</span>
            </button>
          )}
        </For>
      </div>
    </Modal>
  );
}

function DiscountFields(props: { type: DiscountType; value: number; onType: (t: DiscountType) => void; onValue: (n: number) => void; autofocus?: boolean }) {
  return (
    <div class="disc">
      <div class="seg">
        <button type="button" class={props.type === 'nominal' ? 'on' : ''} onClick={() => props.onType('nominal')}>Rp</button>
        <button type="button" class={props.type === 'percent' ? 'on' : ''} onClick={() => props.onType('percent')}>%</button>
      </div>
      <Show when={props.type === 'nominal'} fallback={<input inputmode="numeric" autofocus={props.autofocus} value={props.value || ''} placeholder="0" onInput={(e) => props.onValue(Math.min(100, parseInt(e.currentTarget.value.replace(/\D/g, ''), 10) || 0))} />}>
        <MoneyInput value={props.value} onInput={props.onValue} autofocus={props.autofocus} />
      </Show>
    </div>
  );
}

function LineDialog(props: { lineKey: string; onClose: () => void }) {
  const line = () => cart.lines.find((l) => lineKey(l) === props.lineKey);
  const [qty, setQ] = createSignal(line()?.qty ?? 1);
  const [type, setType] = createSignal<DiscountType>(line()?.discountType ?? 'nominal');
  const [value, setValue] = createSignal(line()?.discountValue ?? 0);
  const save = (e: Event) => {
    e.preventDefault();
    setLineDiscount(props.lineKey, type(), value());
    setQty(props.lineKey, qty());
    props.onClose();
  };
  return (
    <Show when={line()}>
      <Modal title={line()!.nameSnapshot} onClose={props.onClose}>
        <form onSubmit={save}>
          <div class="field">
            <label for="lq">Jumlah</label>
            <input id="lq" inputmode="numeric" value={qty()} autofocus onFocus={(e) => e.currentTarget.select()} onInput={(e) => setQ(parseInt(e.currentTarget.value, 10) || 0)} />
          </div>
          <Show when={line()!.wholesaleTiers.length}>
            <p class="small mut">Harga grosir: <For each={[...line()!.wholesaleTiers].sort((a, b) => a.minQty - b.minQty)}>{(t) => <span class="tagx">≥{t.minQty}: {rp(t.price)}</span>}</For></p>
          </Show>
          <div class="field">
            <label>Diskon item</label>
            <DiscountFields type={type()} value={value()} onType={setType} onValue={setValue} />
          </div>
          <div class="row-btns">
            <button type="button" class="btn bad" onClick={() => { removeLine(props.lineKey); props.onClose(); }}>Hapus item</button>
            <span class="spacer" />
            <button class="btn primary" type="submit">Simpan</button>
          </div>
        </form>
      </Modal>
    </Show>
  );
}

function TxDiscountDialog(props: { onClose: () => void }) {
  const [type, setType] = createSignal<DiscountType>(cart.txDiscountType);
  const [value, setValue] = createSignal(cart.txDiscountValue);
  return (
    <Modal title="Diskon transaksi" onClose={props.onClose}>
      <form onSubmit={(e) => { e.preventDefault(); setTxDiscount(type(), value()); props.onClose(); }}>
        <p class="small mut">Diterapkan ke subtotal, sebelum pajak.</p>
        <DiscountFields type={type()} value={value()} onType={setType} onValue={setValue} autofocus />
        <div class="row-btns">
          <button type="button" class="btn" onClick={() => { setTxDiscount('nominal', 0); props.onClose(); }}>Hapus diskon</button>
          <span class="spacer" />
          <button class="btn primary" type="submit">Simpan</button>
        </div>
      </form>
    </Modal>
  );
}

function CustomerDialog(props: { customers: Row[]; onPick: (id: string | null) => void; onClose: () => void }) {
  const [q, setQ] = createSignal('');
  const [adding, setAdding] = createSignal(false);
  const list = createMemo(() => {
    const s = q().trim().toLowerCase();
    return props.customers.filter((c) => !s || String(c.name).toLowerCase().includes(s) || String(c.phone ?? '').includes(s)).slice(0, 100);
  });
  const create = async (e: SubmitEvent) => {
    e.preventDefault();
    const d = db();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    const name = String(f.get('name') ?? '').trim();
    if (!d || !name) return;
    const now = Date.now();
    const id = uuid();
    await d.t('customers').put({ id, createdAt: now, updatedAt: now, deletedAt: null, name, phone: String(f.get('phone') ?? '').trim() || null, address: null, birthdate: null, debtBalance: 0, note: null, _dirty: 1 });
    props.onPick(id);
  };
  return (
    <Modal title="Pilih pelanggan" onClose={props.onClose}>
      <Show
        when={!adding()}
        fallback={
          <form onSubmit={create}>
            <div class="field"><label for="cn">Nama</label><input id="cn" name="name" required maxlength="120" autofocus value={q()} /></div>
            <div class="field"><label for="cp">No. HP / WA (opsional)</label><input id="cp" name="phone" inputmode="tel" maxlength="20" /></div>
            <div class="row-btns"><button type="button" class="btn" onClick={() => setAdding(false)}>Kembali</button><span class="spacer" /><button class="btn primary">Simpan & pilih</button></div>
          </form>
        }
      >
        <input class="pos-search" placeholder="Cari nama / no. HP" autofocus value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
        <div class="clist">
          <button class="crow" onClick={() => props.onPick(null)}><b>Umum</b><span class="mut small">Tanpa pelanggan</span></button>
          <For each={list()}>
            {(c) => (
              <button class={`crow ${cart.customerId === c.id ? 'on' : ''}`} onClick={() => props.onPick(c.id)}>
                <b>{String(c.name)}</b>
                <span class="mut small">{String(c.phone ?? '')}</span>
                <Show when={Number(c.debtBalance ?? 0) > 0}><span class="small bad-t">Hutang {rp(Number(c.debtBalance))}</span></Show>
              </button>
            )}
          </For>
        </div>
        <button class="btn block" style={{ 'margin-top': '10px' }} onClick={() => setAdding(true)}>+ Pelanggan baru</button>
      </Show>
    </Modal>
  );
}

interface PayRow { method: PaymentMethod; amount: number }

function PayDialog(props: { customer: Row | null; initialCredit?: boolean; onPay: (p: PaymentEntry[], allowCredit: boolean) => Promise<string | null>; onPickCustomer: () => void; onClose: () => void }) {
  const total = () => totals().grandTotal;
  const [opts] = createResource(db, (d: StoreDb) => paymentOptions(d));
  const [rows, setRows] = createSignal<PayRow[]>([{ method: 'cash', amount: 0 }]);
  const [credit, setCredit] = createSignal(!!props.initialCredit);
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  let firstInput: HTMLInputElement | undefined;
  onMount(() => queueMicrotask(() => firstInput?.focus()));

  const entries = () => rows().filter((r) => r.amount > 0).map((r) => ({ method: r.method, amount: r.amount }));
  const res = createMemo(() => resolvePayment(total(), entries()));
  const setRow = (i: number, patch: Partial<PayRow>) => setRows(rows().map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remainingFor = (i: number) => Math.max(0, total() - rows().reduce((s, r, j) => (j === i ? s : s + r.amount), 0));

  const submit = async (e?: Event) => {
    e?.preventDefault();
    if (busy()) return;
    setError('');
    if (res().status !== 'paid' && !credit()) return setError(`Pembayaran kurang ${rp(res().remaining)}. Tambah pembayaran atau aktifkan Kasbon.`);
    if (res().status !== 'paid' && !props.customer) return setError('Kasbon wajib memilih pelanggan.');
    setBusy(true);
    const err = await props.onPay(entries(), credit());
    setBusy(false);
    if (err) setError(err);
  };

  const methods = () => (opts()?.methods ?? ['cash']).filter((m) => m in METHOD_LABEL);
  return (
    <Modal title={`Bayar ${rp(total())}`} onClose={props.onClose} wide>
      <form onSubmit={submit} class="pay">
        <Index each={rows()}>
          {(r, i) => (
            <div class="payrow">
              <div class="seg methods">
                <For each={methods()}>
                  {(m) => <button type="button" class={r().method === m ? 'on' : ''} onClick={() => setRow(i, { method: m, amount: m === 'cash' ? r().amount : r().amount || remainingFor(i) })}>{METHOD_LABEL[m]}</button>}
                </For>
              </div>
              <div class="payamt">
                <MoneyInput value={r().amount} onInput={(n) => setRow(i, { amount: n })} ref={(el) => i === 0 && (firstInput = el)} class="big-input" />
                <Show when={rows().length > 1}><button type="button" class="btn sm" onClick={() => setRows(rows().filter((_, j) => j !== i))}>Hapus</button></Show>
              </div>
              <Show when={r().method === 'cash'}>
                <div class="quick">
                  <button type="button" class="btn sm" onClick={() => setRow(i, { amount: remainingFor(i) })}>Uang pas</button>
                  <For each={cashSuggestions(remainingFor(i))}>{(s) => <button type="button" class="btn sm" onClick={() => setRow(i, { amount: s })}>{num(s)}</button>}</For>
                </div>
              </Show>
            </div>
          )}
        </Index>
        <Show when={opts()?.allowSplit !== false && rows().length < 4 && res().paidTotal < total()}>
          <button type="button" class="btn sm" onClick={() => setRows([...rows(), { method: methods().find((m) => m !== 'cash') ?? 'cash', amount: remainingFor(rows().length) }])}>+ Bayar sebagian dengan metode lain</button>
        </Show>

        <label class="credit">
          <input type="checkbox" checked={credit()} onChange={(e) => setCredit(e.currentTarget.checked)} />
          <span><b>Kasbon</b> — sisa yang belum dibayar dicatat sebagai hutang pelanggan</span>
        </label>
        <Show when={credit()}>
          <div class="alert warn small">
            Pelanggan: <b>{props.customer ? String(props.customer.name) : 'belum dipilih'}</b>{' '}
            <button type="button" class="btn sm" onClick={props.onPickCustomer}>{props.customer ? 'Ganti' : 'Pilih pelanggan'}</button>
          </div>
        </Show>

        <div class="paysum">
          <div class="kv"><span>Total</span><b>{rp(total())}</b></div>
          <div class="kv"><span>Dibayar</span><span>{rp(res().paidTotal)}</span></div>
          <Show when={res().status === 'paid'} fallback={<div class="kv bad-t"><span>{credit() ? 'Jadi hutang' : 'Kurang'}</span><b>{rp(res().remaining)}</b></div>}>
            <div class="kv change"><span>Kembalian</span><b>{rp(res().change)}</b></div>
          </Show>
        </div>
        <Show when={error()}><div class="alert err" role="alert">{error()}</div></Show>
        <button class="btn primary block big" type="submit" disabled={busy()}>{busy() ? 'Menyimpan…' : res().status === 'paid' ? 'Selesaikan (Enter)' : credit() ? 'Simpan kasbon' : 'Selesaikan'}</button>
      </form>
    </Modal>
  );
}

function DoneDialog(props: { result: CommitResult; receipt: ReceiptData | null; onClose: () => void }) {
  let newBtn: HTMLButtonElement | undefined;
  onMount(() => queueMicrotask(() => newBtn?.focus()));
  // Enter = transaksi baru (walau fokus di tombol cetak) — kasir langsung lanjut melayani.
  const onEnter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    props.onClose();
  };
  onMount(() => document.addEventListener('keydown', onEnter, true));
  onCleanup(() => document.removeEventListener('keydown', onEnter, true));
  return (
    <Modal title="Transaksi berhasil" onClose={props.onClose} wide>
      <div class="done">
        <div class="done-main">
          <div class="mut">{props.result.invoiceNo}</div>
          <div class="kv big"><span>Total</span><b>{rp(props.result.grandTotal)}</b></div>
          <Show when={props.result.change > 0}><div class="kv change big"><span>Kembalian</span><b>{rp(props.result.change)}</b></div></Show>
          <div class="row-btns" style={{ 'margin-top': '16px' }}>
            <Show when={props.receipt}><button class="btn" onClick={() => printReceipt(props.receipt!)}>Cetak struk</button></Show>
            <span class="spacer" />
            <button ref={newBtn} class="btn primary" onClick={props.onClose}>Transaksi baru (Enter)</button>
          </div>
        </div>
        <Show when={props.receipt}><div class="done-receipt"><Receipt data={props.receipt!} /></div></Show>
      </div>
    </Modal>
  );
}

function HeldDialog(props: { onResume: (id: string) => void; onClose: () => void }) {
  const held = createLive(db, (d) => d.held_sales.orderBy('createdAt').reverse().toArray(), []);
  return (
    <Modal title="Transaksi tertunda" onClose={props.onClose}>
      <p class="small mut">Tersimpan di komputer ini saja (tidak ikut sinkron), sama seperti di HP.</p>
      <div class="clist">
        <For each={held()} fallback={<p class="mut">Tidak ada transaksi tertunda.</p>}>
          {(h) => (
            <div class="crow">
              <b>{h.label}</b>
              <span class="mut small">{h.itemCount} item · {rp(h.total)}</span>
              <span class="row-btns">
                <button class="btn sm bad" onClick={() => confirm('Hapus transaksi tertunda ini?') && void db()?.held_sales.delete(h.id)}>Hapus</button>
                <button class="btn sm primary" onClick={() => props.onResume(h.id)}>Lanjutkan</button>
              </span>
            </div>
          )}
        </For>
      </div>
    </Modal>
  );
}

function ShiftDialog(props: { bill: Row | null; onClose: () => void; say: (m: string, k?: 'ok' | 'err' | 'warn') => void }) {
  const [amount, setAmount] = createSignal(0);
  const [error, setError] = createSignal('');
  const [summary] = createResource(() => (props.bill ? [db(), props.bill.id] as const : null), ([d, id]) => (d ? billSummary(d, id) : Promise.resolve(null as BillSummary | null)));
  const act = async (e: Event) => {
    e.preventDefault();
    const d = db();
    const u = user();
    if (!d || !u) return;
    try {
      if (props.bill) {
        const b = await closeBill(d, props.bill.id, amount());
        const v = Number(b.variance ?? 0);
        props.say(`Shift ditutup. ${v === 0 ? 'Kas pas.' : v > 0 ? `Kas lebih ${rp(v)}.` : `Kas kurang ${rp(-v)}.`}`, v === 0 ? 'ok' : 'warn');
      } else {
        await openBill(d, u.id, amount());
        props.say('Shift dibuka.');
      }
      void syncNow();
      props.onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Modal title={props.bill ? 'Tutup shift' : 'Buka shift'} onClose={props.onClose}>
      <form onSubmit={act}>
        <Show when={props.bill && summary()}>
          {(s) => (
            <div class="paysum" style={{ 'margin-bottom': '14px' }}>
              <div class="kv"><span>Kas awal</span><span>{rp(s().openingCash)}</span></div>
              <div class="kv"><span>Penjualan tunai bersih ({s().txCount} nota)</span><span>{rp(s().netCashSales)}</span></div>
              <div class="kv"><b>Kas seharusnya</b><b>{rp(s().expectedCash)}</b></div>
            </div>
          )}
        </Show>
        <div class="field">
          <label for="sa">{props.bill ? 'Uang tunai di laci sekarang' : 'Kas awal (modal kembalian)'}</label>
          <MoneyInput id="sa" value={amount()} onInput={setAmount} autofocus class="big-input" />
        </div>
        <Show when={props.bill && summary()}>
          {(s) => {
            const v = () => amount() - s().expectedCash;
            return <p class={`small ${v() === 0 ? '' : 'bad-t'}`}>Selisih: {v() === 0 ? 'pas' : `${v() > 0 ? 'lebih' : 'kurang'} ${rp(Math.abs(v()))}`}</p>;
          }}
        </Show>
        <Show when={error()}><div class="alert err">{error()}</div></Show>
        <button class="btn primary block" type="submit">{props.bill ? 'Tutup shift' : 'Buka shift'}</button>
      </form>
    </Modal>
  );
}
