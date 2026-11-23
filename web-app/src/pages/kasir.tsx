import { createEffect, createMemo, createResource, createSignal, For, Index, onCleanup, onMount, Show } from 'solid-js';
import type { Row, StoreDb } from '../db/db';
import { createLive } from '../lib/live';
import { uuid } from '../lib/crypto';
import { activeStore, can, db, online, syncNow, user } from '../state';
import { ApiError } from '../lib/api';
import { CATEGORY_LABEL, listOrders, normalizeMeter, normalizePhone, plnInquiry, ppobNoteTag, ppobProducts, ppobStatus, processLine, receiptName, type PpobCategory, type PpobOutcome, type PpobProduct } from '../cloud/ppob';
import type { CartLine } from '../pos/calc';
import {
  addPpob, addProduct, bindCart, cart, clearCart, lineKey, removeLine, replaceLines, restoreCart, setCustomer, setLineDiscount, setNote,
  setPosConfig, setQty, setTxDiscount, snapshot, totals,
} from '../pos/cart';
import { cashSuggestions, METHOD_LABEL, num, resolvePayment, rp, type DiscountType, type PaymentEntry, type PaymentMethod } from '../pos/calc';
import {
  billSummary, closeBill, commitSale, getBool, holdSale, KEY_ALLOW_NEGATIVE_STOCK, KEY_REQUIRE_OPEN_BILL, openBill, openBillFor,
  paymentOptions, PosError, resumeHeld, storeInfo, tiersFor, type BillSummary, type CommitResult,
} from '../pos/repo';
import { loadReceipt, printReceipt, Receipt, type ReceiptData } from '../pos/receipt';
import { Modal, MoneyInput, Toast } from './ui';
import { useNavigate } from '@solidjs/router';
import { isMobile } from '../lib/media';
import { Icon } from '../ui/icon';
import { ScanButton } from '../ui/scanner';

const live = (r: Row) => r.deletedAt == null;

type Dialog =
  | { kind: 'variant'; product: Row }
  | { kind: 'line'; key: string }
  | { kind: 'txDiscount' }
  | { kind: 'customer'; thenPay?: boolean }
  | { kind: 'pay'; credit?: boolean }
  | { kind: 'done'; result: CommitResult | null; receipt: ReceiptData | null; outcomes: PpobOutcome[] }
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
  // HP: jangan fokus otomatis (keyboard layar akan terus muncul). Desktop: siap untuk scanner USB.
  const focusSearch = () => !isMobile() && searchEl?.focus();
  const nav = useNavigate();
  // HP: keranjang = bottom sheet (CartPanel di showModalBottomSheet), dibuka lewat FAB keranjang.
  const [cartOpen, setCartOpen] = createSignal(false);
  // Desktop: keranjang bisa diminimalkan jadi ikon (seperti FAB keranjang aplikasi HP) agar daftar
  // produk lega di layar kecil. Pilihan diingat di browser ini.
  const [cartMin, setCartMinRaw] = createSignal(localStorage.getItem('sirko.cartMin') === '1');
  const setCartMin = (v: boolean) => {
    setCartMinRaw(v);
    try { localStorage.setItem('sirko.cartMin', v ? '1' : '0'); } catch { /* mode privat */ }
  };
  // Tab Fisik | PPOB (PosScreen aplikasi): PPOB = panel jual langsung di halaman, bukan dialog.
  const [tab, setTab] = createSignal<'fisik' | 'ppob'>('fisik');
  createEffect(() => {
    if (!cart.lines.length) setCartOpen(false);
  });

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

  /**
   * Bayar (CheckoutController.submit): item PPOB dikirim dulu satu per satu (maks. 15 dtk). Sukses /
   * diterima → tetap di nota (SN/token di nama item); gagal / belum ada jawaban → keluar dari nota &
   * total dihitung ulang. Keranjang memakai hasil PPOB: bila simpan gagal, PPOB yang sudah berhasil
   * tidak dibeli ulang saat Bayar diulang.
   */
  const pay = async (payments: PaymentEntry[], allowCredit: boolean): Promise<string | null> => {
    const d = db();
    const u = user();
    if (!d || !u) return 'Sesi tidak aktif.';
    const hasPpob = cart.lines.some((l) => l.ppob);
    if (hasPpob && !online()) return 'Item PPOB butuh internet. Hapus item PPOB atau sambungkan internet.';
    try {
      const outcomes: PpobOutcome[] = [];
      if (hasPpob) {
        const kept: CartLine[] = [];
        for (const l of snapshot().lines) {
          if (!l.ppob) {
            kept.push(l);
            continue;
          }
          const o = await processLine(l.ppob);
          outcomes.push(o);
          if (o.kind === 'success' || o.kind === 'accepted') kept.push({ ...l, ppob: o.line, nameSnapshot: receiptName(o.line), costPriceSnapshot: o.line.cost });
        }
        replaceLines(kept);
        if (!kept.length) {
          clearCart();
          setDialog({ kind: 'done', result: null, receipt: null, outcomes });
          return null;
        }
      }
      const tags = cart.lines.filter((l) => l.ppob?.orderId).map((l) => ppobNoteTag(l.ppob!.orderId!));
      const note = [cart.note?.trim(), ...tags].filter(Boolean).join(' · ');
      const result = await commitSale(d, {
        totals: totals(),
        payments,
        allowCredit,
        customerId: cart.customerId,
        cashierId: u.id,
        billId: bill()?.id ?? null,
        note,
      });
      clearCart();
      void syncNow();
      setDialog({ kind: 'done', result, receipt: await loadReceipt(d, result.transactionId, activeStore()?.name ?? 'Toko'), outcomes });
      return null;
    } catch (e) {
      return e instanceof PosError ? e.message : `Gagal menyimpan: ${(e as Error).message}`;
    }
  };

  return (
    <div class={`pos ${cartMin() && !isMobile() ? 'cart-min' : ''}`}>
      <section class="pos-left">
        <Show when={can('ppobSell')}>
          <div class="m-tabs">
            <button class={tab() === 'fisik' ? 'on' : ''} onClick={() => setTab('fisik')}>Fisik</button>
            <button class={tab() === 'ppob' ? 'on' : ''} onClick={() => setTab('ppob')}>PPOB</button>
          </div>
        </Show>
        <Show when={tab() === 'fisik'} fallback={<PpobPanel onAdded={(m) => say(m)} />}>
        <div class="pos-bar">
          <input
            ref={searchEl}
            class="pos-search"
            placeholder={isMobile() ? 'Cari nama atau barcode…' : 'Cari nama / scan barcode lalu Enter  (F2)'}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void onSearchEnter(); }
              if (e.key === 'Escape') setQuery('');
            }}
            aria-label="Cari produk atau scan barcode"
          />
          <ScanButton title="Scan barcode" onCode={(c) => { setQuery(c); void onSearchEnter(); }} />
          <button class="m-icon-btn" title="Transaksi tertunda" onClick={() => setDialog({ kind: 'held' })}>
                <Icon name="pauseCircle" />
                <Show when={heldCount()}><span class="m-badge">{heldCount()}</span></Show>
              </button>
              <button class="m-icon-btn" title="Riwayat transaksi" onClick={() => nav('/transaksi')}><Icon name="receiptLong" /></button>
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
                <button class={`pcard ${p.needsPrice === true ? 'np' : ''} ${s() <= 0 && p.hasVariants !== true && !settings().allowNegative ? 'out' : ''}`} onClick={() => void add(p)}>
                  <span class="pimg"><Icon name="inventory2" size={36} /></span>
                  <span class="pname">{String(p.name)}</span>
                  <span class="pprice">{p.needsPrice === true ? 'Perlu harga' : p.hasVariants === true ? `${(variantsOf().get(p.id) ?? []).length} varian` : rp(Number(p.sellingPrice ?? 0))}</span>
                  <span class={`pstock ${s() <= 0 ? 'bad' : s() <= Number(p.minStock ?? 0) ? 'warn' : ''}`}>{s() <= 0 ? 'Stok habis' : `Stok ${num(s())}`}</span>
                </button>
              );
            }}
          </For>
        </div>
        <Show when={filtered().length > 200}><p class="mut small">Menampilkan 200 dari {filtered().length} produk — perjelas pencarian.</p></Show>
        </Show>
      </section>

      <Show when={isMobile()}>
        <Show when={cartOpen()}><div class="m-sheet-bg" onClick={() => setCartOpen(false)} /></Show>
        <Show when={!cartOpen()}>
          <button class="m-fab round m-cart-fab" title="Keranjang" onClick={() => cart.lines.length ? setCartOpen(true) : say('Keranjang masih kosong.', 'warn')}>
            <Icon name="shoppingCart" />
            <Show when={totals().itemCount}><span class="m-badge">{num(totals().itemCount)}</span></Show>
          </button>
          <Show when={cart.lines.length}>
            <div class="m-cartbar">
              <button class="m-cartbar-sum" onClick={() => setCartOpen(true)}>
                <span class="small">{num(totals().itemCount)} item</span>
                <b>{rp(totals().grandTotal)}</b>
              </button>
              <button class="btn primary" onClick={startPay}><Icon name="payments" size={18} />Bayar</button>
            </div>
          </Show>
        </Show>
      </Show>

      <Show when={!isMobile() && cartMin()}>
        <button
          class="m-fab round d-cart-fab"
          title={cart.lines.length ? `Buka keranjang · ${num(totals().itemCount)} item · ${rp(totals().grandTotal)}` : 'Buka keranjang'}
          aria-label="Buka keranjang"
          onClick={() => setCartMin(false)}
        >
          <Icon name="shoppingCart" />
          <Show when={totals().itemCount}><span class="m-badge">{num(totals().itemCount)}</span></Show>
        </button>
      </Show>

      <aside class={`pos-cart ${cartOpen() ? 'open' : ''}`}>
        <div class="m-cart-head">
            <div class="m-cart-title">
              <Icon name="shoppingCart" size={20} />
              <b>Keranjang</b>
              <span>({num(totals().itemCount)})</span>
              <span class="spacer" />
              <button class="btn text sm" disabled={!cart.lines.length} onClick={() => confirm('Kosongkan keranjang?') && clearCart()}>
                <Icon name="deleteSweep" size={18} />Kosongkan
              </button>
              <button class="m-icon-btn sm d-cart-min" title="Minimalkan keranjang" aria-label="Minimalkan keranjang" onClick={() => setCartMin(true)}>
                <Icon name="collapseRight" size={20} />
              </button>
            </div>
            <button class="m-cart-cust" title="Pilih pelanggan (F4)" onClick={() => setDialog({ kind: 'customer' })}>
              <Icon name="personOutline" size={20} />
              <Show when={customer()} fallback={<span class="mut">Pilih pelanggan (untuk hutang)</span>}>
                <b>{String(customer()!.name)}</b>
                <Show when={Number(customer()!.debtBalance ?? 0) > 0}><span class="small bad-t">Hutang {rp(Number(customer()!.debtBalance))}</span></Show>
              </Show>
              <span class="spacer" />
              <Show when={customer()} fallback={<Icon name="chevronRight" />}>
                <span class="m-icon-btn sm" role="button" title="Hapus pelanggan" onClick={(e) => { e.stopPropagation(); setCustomer(null); }}><Icon name="close" size={18} /></span>
              </Show>
            </button>
          </div>
        <div class="lines">
          <For each={totals().lineResults} fallback={<div class="m-empty"><Icon name="removeShoppingCart" size={48} /><span>Keranjang kosong</span><span class="small">Ketuk produk untuk menambah</span></div>}>
            {(r) => {
              const k = lineKey(r.line);
              const over = () => !r.line.ppob && !settings().allowNegative && r.line.qty > r.line.availableStock;
              return (
                <div class="m-line">
                    <div class="m-line-r1">
                      <button class="m-line-name" onClick={() => setDialog({ kind: 'line', key: k })}>{r.line.nameSnapshot}</button>
                      <button class="m-icon-btn sm" aria-label="Hapus item" onClick={() => removeLine(k)}><Icon name="close" size={18} /></button>
                    </div>
                    <div class="m-line-r2">
                      <span class="small">
                        {rp(r.effectiveUnitPrice)}
                        <Show when={r.appliedWholesale}> <span class="m-grosir">Grosir</span></Show>
                      </span>
                      <Show when={over()}><span class="small bad-t">Stok tinggal {r.line.availableStock}</span></Show>
                      <span class="spacer" />
                      <Show when={!r.line.ppob} fallback={<span class="m-ppob-tag"><Icon name="bolt" size={16} />PPOB</span>}>
                        <button class="m-step" aria-label="Kurangi" onClick={() => setQty(k, r.line.qty - 1)}><Icon name="remove" size={18} /></button>
                        <b class="m-qty">{num(r.line.qty)}</b>
                        <button class="m-step" aria-label="Tambah" onClick={() => setQty(k, r.line.qty + 1)}><Icon name="add" size={18} /></button>
                      </Show>
                    </div>
                    <div class="m-line-r3">
                      <button class="m-disc-btn" onClick={() => setDialog({ kind: 'line', key: k })}>
                        <Icon name="localOffer" size={16} />{r.discount ? `Diskon -${rp(r.discount)}` : 'Diskon'}
                      </button>
                      <b>{rp(r.lineTotal)}</b>
                    </div>
                  </div>
              );
            }}
          </For>
        </div>
        <div class="sum">
          <div class="kv"><span>Subtotal</span><span>{rp(totals().subtotal)}</span></div>
          <button class="kv link" onClick={() => setDialog({ kind: 'txDiscount' })}>
            <span><Icon name="discount" size={16} /> Diskon transaksi</span>
            <span class="m-ink">{totals().discountTotal ? `-${rp(totals().discountTotal)}` : 'Rp0'}</span>
          </button>
          <Show when={totals().taxTotal}><div class="kv"><span>Pajak{totals().grandTotalBeforeRounding === totals().subtotal - totals().discountTotal ? ' (termasuk)' : ''}</span><span>{rp(totals().taxTotal)}</span></div></Show>
          <Show when={totals().roundingAdjustment}><div class="kv"><span>Pembulatan</span><span>{rp(totals().roundingAdjustment)}</span></div></Show>
          <div class="kv total"><span>Total</span><span>{rp(totals().grandTotal)}</span></div>
          <input class="note" placeholder="Catatan (opsional)" value={cart.note} onChange={(e) => setNote(e.currentTarget.value)} maxlength="200" />
          <div class="m-cart-actions">
              <button class="btn big" title="Tunda (F9)" disabled={!cart.lines.length} onClick={() => void hold()}><Icon name="pauseCircle" size={18} />Tunda</button>
              <button class="btn primary big" title="Bayar (F8)" disabled={!cart.lines.length} onClick={startPay}><Icon name="payments" size={18} />Bayar&nbsp; {rp(totals().grandTotal)}</button>
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
              return <DoneDialog result={d.result} receipt={d.receipt} outcomes={d.outcomes} onClose={close} />;
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

function DoneDialog(props: { result: CommitResult | null; receipt: ReceiptData | null; outcomes: PpobOutcome[]; onClose: () => void }) {
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
  const dropped = () => props.outcomes.filter((o) => o.kind === 'failed' || o.kind === 'pending');
  const processing = () => props.outcomes.filter((o) => o.kind === 'accepted');
  return (
    <Modal title={props.result ? 'Transaksi berhasil' : 'PPOB tidak terjual'} onClose={props.onClose} wide>
      <div class="done">
        <div class="done-main">
          <Show when={dropped().length}>
            <div class="alert warn small">
              <b>Tidak masuk nota (jangan tagih ke pembeli):</b>
              <ul><For each={dropped()}>{(o) => <li>{o.line.productName} {o.line.customerNo} — {o.message}</li>}</For></ul>
            </div>
          </Show>
          <Show when={processing().length}>
            <div class="alert ok small">
              <b>Sedang diproses (tetap di nota):</b>
              <ul><For each={processing()}>{(o) => <li>{o.line.productName} {o.line.customerNo} — {o.message} Cek di menu PPOB → Riwayat.</li>}</For></ul>
            </div>
          </Show>
          <Show when={props.result}>
            {(r) => (
              <>
                <div class="mut">{r().invoiceNo}</div>
                <div class="kv big"><span>Total</span><b>{rp(r().grandTotal)}</b></div>
                <Show when={r().change > 0}><div class="kv change big"><span>Kembalian</span><b>{rp(r().change)}</b></div></Show>
              </>
            )}
          </Show>
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


/** Panel jual PPOB (PpobSellPanel): kategori → nomor (PLN: cek nama) → pilih produk → masuk keranjang. */
/**
 * Tab PPOB di Kasir (PpobSellPanel aplikasi): pilih kategori → isi nomor → ketuk nominal → masuk
 * keranjang (dibeli saat Bayar). Nomor HP (pulsa/data) & nomor meter (token) disimpan terpisah agar
 * pindah kategori tak membawa nomor yang salah jenis. Nominal hanya bisa ditambahkan bila nomor
 * tujuan valid; token listrik dicek dulu ke PLN.
 */
function PpobPanel(props: { onAdded: (msg: string) => void }) {
  const [cat, setCat] = createSignal<PpobCategory>('pulsa');
  const [phone, setPhone] = createSignal('');
  const [meter, setMeter] = createSignal('');
  const isPln = () => cat() === 'pln';
  const no = () => (isPln() ? meter() : phone());
  const setNo = (v: string) => (isPln() ? setMeter(v) : setPhone(v));
  const [hint, setHint] = createSignal<{ text: string; kind: 'err' | 'warn' } | null>(null);
  const [pln, setPln] = createSignal<{ meter: string; name: string | null; segmentPower: string | null } | null>(null);
  const [checking, setChecking] = createSignal(false);
  let inputEl: HTMLInputElement | undefined;

  const [status, { refetch: retry }] = createResource(
    () => online(),
    () => ppobStatus().catch((e) => {
      setHint({ text: e instanceof ApiError ? e.message : 'PPOB butuh internet.', kind: 'err' });
      return null;
    }),
  );
  // Saring sesuai operator hanya bila nomor HP sudah valid (jeda 500 ms agar tak memanggil server
  // tiap ketikan); selain itu tampilkan semua nominal, seperti aplikasi.
  const [filterNo, setFilterNo] = createSignal<string | null>(null);
  let debounce: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const v = isPln() ? null : normalizePhone(phone());
    clearTimeout(debounce);
    debounce = setTimeout(() => setFilterNo(v), 500);
  });
  onCleanup(() => clearTimeout(debounce));
  const catStatus = () => status()?.categories.find((c) => c.key === cat());
  const [products, { refetch }] = createResource(
    () => (status()?.enabled && catStatus()?.available !== false ? { c: cat(), n: isPln() ? null : filterNo() } : null),
    async ({ c, n }) => ({ c, n, list: await ppobProducts(c, n ?? undefined) }),
  );
  // Hanya daftar milik kategori & nomor yang sedang aktif — saat berpindah kategori, daftar lama
  // tidak boleh tampil (dan diketuk) selama daftar baru dimuat.
  const list = () => {
    if (products.error || products.loading) return [];
    const r = products();
    return r && r.c === cat() && r.n === (isPln() ? null : filterNo()) ? r.list : [];
  };
  const loadError = () => (products.error ? (products.error instanceof ApiError ? products.error.message : 'Gagal memuat produk.') : '');
  const balance = () => status()?.points.balance ?? 0;

  // Ketukan nominal yang masih menunggu (cek meter / riwayat) dibatalkan bila kategori atau nomor
  // berubah — hasil basi tak boleh muncul di tab lain atau menambah item ke keranjang.
  let pickSeq = 0;
  const [busyPick, setBusyPick] = createSignal(false);
  const pickCat = (c: PpobCategory) => {
    pickSeq++;
    setBusyPick(false);
    setCat(c);
    setHint(null);
  };
  const validNo = () => (isPln() ? normalizeMeter(meter()) : normalizePhone(phone()));

  const checkPln = async (m: string) => {
    setChecking(true);
    try {
      const r = await plnInquiry(m);
      setPln({ meter: m, name: r.ok ? r.name : null, segmentPower: r.ok ? r.segmentPower : null });
      return r;
    } finally {
      setChecking(false);
    }
  };
  const onCheck = async () => {
    const m = normalizeMeter(meter());
    if (!m) return setHint({ text: 'Nomor meter / ID pelanggan PLN harus 11–12 digit.', kind: 'err' });
    setHint(null);
    try {
      const r = await checkPln(m);
      if (!r.ok) setHint({ text: r.message ?? 'Nomor meter tidak ditemukan.', kind: 'err' });
    } catch (e) {
      setHint({ text: e instanceof ApiError ? e.message : 'Gagal cek nomor meter.', kind: 'err' });
    }
  };

  const pick = async (p: PpobProduct) => {
    if (!p.available || busyPick()) return;
    setHint(null);
    const target = validNo();
    if (!target) {
      setHint({ text: isPln() ? 'Isi nomor meter / ID pelanggan PLN (11–12 digit) dulu.' : 'Isi nomor HP tujuan dulu (contoh 0812…).', kind: 'err' });
      inputEl?.focus();
      return;
    }
    if (isPln() && /^08/.test(target)) {
      setHint({ text: 'Itu nomor HP, bukan nomor meter PLN. Isi nomor meter / ID pelanggan yang tertera di meteran.', kind: 'err' });
      inputEl?.focus();
      return;
    }
    if (p.price > balance()) {
      setHint({ text: `Poin kurang (modal ${rp(p.price)}). Top-up Poin dulu.`, kind: 'err' });
      return;
    }
    if (cart.lines.some((l) => l.ppob && l.ppob.customerNo === target && l.ppob.category === p.category)) {
      setHint({ text: `Nomor ${target} sudah ada di keranjang.`, kind: 'warn' });
      return;
    }
    const seq = ++pickSeq;
    const catAt = cat();
    const stale = () => seq !== pickSeq || cat() !== catAt || validNo() !== target;
    setBusyPick(true);
    try {
      await addChecked(p, target, stale);
    } finally {
      if (seq === pickSeq) setBusyPick(false);
    }
  };

  const addChecked = async (p: PpobProduct, target: string, stale: () => boolean) => {
    try {
      const pending = (await listOrders()).items.find((o) => o.customerNo === target && ['pending', 'processing', 'waiting_admin'].includes(o.status));
      if (stale()) return;
      if (pending) {
        setHint({ text: 'Nomor ini masih diproses, cek Riwayat PPOB.', kind: 'warn' });
        return;
      }
    } catch {
      /* riwayat tak terbaca → lanjut; server tetap menjaga duplikasi */
    }
    let plnName: string | null = null;
    if (isPln()) {
      try {
        const known = pln()?.meter === target ? pln() : null;
        const r = known ? { ok: !!known.name, name: known.name, message: null as string | null } : await checkPln(target);
        if (stale()) return;
        if (r.ok) plnName = r.name;
        else if (/tidak dikenali|tidak ditemukan/i.test(r.message ?? '')) {
          setHint({ text: r.message ?? 'Nomor meter tidak dikenali PLN.', kind: 'err' });
          return;
        } else if (!confirm(`${r.message ?? 'Nomor meter belum bisa dicek.'}\n\nPastikan nomor ${target} benar. Tetap tambahkan ke keranjang?`)) return;
      } catch {
        if (stale()) return;
        if (!confirm(`Nomor meter belum bisa dicek. Pastikan nomor ${target} benar. Tetap tambahkan ke keranjang?`)) return;
      }
    }
    if (stale()) return;
    addPpob(p, target, plnName);
    props.onAdded(`Masuk keranjang: ${p.name} → ${target}${plnName ? ` (${plnName})` : ''} (dibeli saat Bayar)`);
  };

  const pnav = useNavigate();
  return (
    <div class="ppob-panel">
      <Show
        when={online()}
        fallback={
          <div class="m-empty">
            <Icon name="cloudOff" size={48} />
            <span>Butuh internet untuk jualan PPOB.<br />Tab Fisik tetap bisa dipakai.</span>
            <button type="button" class="btn" onClick={() => void retry()}>Coba lagi</button>
          </div>
        }
      >
        <div class="ppob-head">
          <Icon name="bolt" size={18} />
          <b>Saldo Poin {status() ? rp(balance()) : '…'}</b>
          <span class="spacer" />
          <button type="button" class="btn text sm" onClick={() => pnav('/ppob/riwayat')}><Icon name="history" size={18} />Riwayat PPOB</button>
        </div>
        <Show when={status() && !status()!.enabled}><div class="alert warn">PPOB belum aktif. Nanti pulsa, paket data & token listrik bisa dijual dari sini.</div></Show>
        <Show when={status()?.points.reason}><p class="small mut">{status()!.points.reason}</p></Show>
        <div class="m-chiprow flush" role="tablist">
          <For each={['pulsa', 'data', 'pln'] as PpobCategory[]}>
            {(c) => <button type="button" role="tab" aria-selected={cat() === c} class={`chip ${cat() === c ? 'on' : ''}`} onClick={() => pickCat(c)}>{CATEGORY_LABEL[c]}</button>}
          </For>
        </div>
        <div class="field ppob-no">
          <label for="ppob-no">{isPln() ? 'Nomor meter / ID pelanggan' : 'Nomor HP'}</label>
          <div class="with-action">
            <input
              id="ppob-no"
              ref={inputEl}
              inputmode="numeric"
              autocomplete="off"
              placeholder={isPln() ? '11–12 digit, tertera di meteran' : 'contoh 081234567890'}
              value={no()}
              onInput={(e) => { setNo(e.currentTarget.value.replace(/[^0-9+]/g, '')); setHint(null); if (isPln()) setPln(null); }}
            />
            <Show when={isPln()}><button type="button" class="btn text" disabled={checking() || !normalizeMeter(meter())} onClick={() => void onCheck()}>{checking() ? 'Mengecek…' : 'Cek'}</button></Show>
          </div>
        </div>
        <Show when={isPln() && pln()?.name && pln()!.meter === normalizeMeter(meter())}>
          <p class="ppob-name">Atas nama: <b>{pln()!.name}</b>{pln()!.segmentPower ? ` · ${pln()!.segmentPower}` : ''}</p>
        </Show>
        <Show when={busyPick()}><p class="small mut">{isPln() ? 'Mengecek nomor meter ke PLN…' : 'Memeriksa…'}</p></Show>
        <Show when={hint()}><div class={`alert ${hint()!.kind} small`} role="alert">{hint()!.text}</div></Show>
        <Show
          when={catStatus()?.available !== false}
          fallback={<p class="small mut">{catStatus()?.reason ?? 'Belum tersedia.'}</p>}
        >
          <Show when={products.loading}><p class="mut small">Memuat produk…</p></Show>
          <Show when={loadError()}>
            <div class="alert err small">{loadError()} <button type="button" class="btn text sm" onClick={() => void refetch()}>Coba lagi</button></div>
          </Show>
          <Show when={!products.loading && !loadError() && products() && !list().length}><p class="small mut">Belum ada produk.</p></Show>
          <div class="ppob-list">
            <For each={list()}>
              {(p) => {
                const short = () => p.available && p.price > balance();
                return (
                  <button type="button" class={`m-card ppob-item ${p.available && !short() ? '' : 'off'}`} disabled={!p.available} onClick={() => void pick(p)} title={p.description ?? ''}>
                    <span class="m-row-text">
                      <span class="m-row-title">{p.name}</span>
                      <span class="m-row-sub">
                        {!p.available ? p.unavailableReason ?? 'Sedang tidak tersedia' : short() ? `Poin kurang (modal ${rp(p.price)})` : `${p.brand}${can('viewCostProfit') ? ` · untung ${rp(p.margin)}` : ''}`}
                      </span>
                    </span>
                    <b>{rp(p.sellPrice)}</b>
                  </button>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>
    </div>
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

export function ShiftDialog(props: { bill: Row | null; onClose: () => void; say: (m: string, k?: 'ok' | 'err' | 'warn') => void }) {
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
