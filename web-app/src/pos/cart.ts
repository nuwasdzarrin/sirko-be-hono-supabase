import { createMemo, createRoot, createSignal } from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import type { Row, StoreDb } from '../db/db';
import { calculate, lineKey, NO_CONFIG, type CartLine, type DiscountType, type PosConfig, type WholesaleTier } from './calc';
import type { CartSnapshot } from './repo';

/**
 * Keranjang kasir aktif (sama dengan `CartController` di HP). Disimpan per toko di `_meta.cart`
 * agar tidak hilang saat pindah halaman / muat ulang. Dikosongkan saat bayar sukses, Tunda, atau
 * Kosongkan.
 */

const EMPTY: CartSnapshot = { lines: [], txDiscountType: 'nominal', txDiscountValue: 0, customerId: null, note: '' };

const root = createRoot(() => {
  const [cart, setCart] = createStore<CartSnapshot>(structuredClone(EMPTY));
  const [config, setConfig] = createSignal<PosConfig>(NO_CONFIG);
  const totals = createMemo(() => calculate(cart.lines, cart.txDiscountType, cart.txDiscountValue, config()));
  return { cart, setCart, config, setConfig, totals };
});

export const cart = root.cart;
export const totals = root.totals;
export const setPosConfig = root.setConfig;

let boundDb: StoreDb | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function persist() {
  const d = boundDb;
  if (!d) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void d.setMeta('cart', JSON.parse(JSON.stringify(cart))).catch(() => undefined), 150);
}

const update = (fn: (c: CartSnapshot) => void) => {
  root.setCart(produce(fn));
  persist();
};

/** Muat keranjang tersimpan milik toko ini (dipanggil saat halaman kasir dibuka / pindah toko). */
export async function bindCart(d: StoreDb): Promise<void> {
  if (boundDb === d) return;
  boundDb = d;
  const saved = await d.meta<CartSnapshot>('cart');
  root.setCart(reconcile(saved && Array.isArray(saved.lines) ? { ...EMPTY, ...saved } : structuredClone(EMPTY)));
}

export type AddResult = 'ok' | 'needs_price';

export function addProduct(p: Row, tiers: WholesaleTier[], variant?: Row): AddResult {
  if (!variant && p.needsPrice === true) return 'needs_price';
  const key = lineKey({ productId: p.id, variantId: variant?.id });
  update((c) => {
    const ex = c.lines.find((l) => lineKey(l) === key);
    if (ex) {
      ex.qty += 1;
      return;
    }
    c.lines.push({
      productId: p.id,
      variantId: variant?.id ?? null,
      nameSnapshot: variant ? `${p.name} — ${variant.name}` : String(p.name),
      unitPrice: Number((variant ?? p).sellingPrice ?? 0),
      wholesaleTiers: tiers,
      costPriceSnapshot: Number((variant ?? p).costPrice ?? 0),
      qty: 1,
      discountType: 'nominal',
      discountValue: 0,
      availableStock: Number((variant ?? p).stock ?? 0),
      unitName: null,
    });
  });
  return 'ok';
}

export function setQty(key: string, qty: number) {
  if (!Number.isFinite(qty)) return;
  if (qty <= 0) return removeLine(key);
  update((c) => {
    const l = c.lines.find((x) => lineKey(x) === key);
    if (l) l.qty = Math.min(Math.floor(qty), 99999);
  });
}

export function setLineDiscount(key: string, type: DiscountType, value: number) {
  update((c) => {
    const l = c.lines.find((x) => lineKey(x) === key);
    if (l) {
      l.discountType = type;
      l.discountValue = Math.max(0, value);
    }
  });
}

export const removeLine = (key: string) => update((c) => void (c.lines = c.lines.filter((l) => lineKey(l) !== key)));
export const setTxDiscount = (type: DiscountType, value: number) =>
  update((c) => {
    c.txDiscountType = type;
    c.txDiscountValue = Math.max(0, value);
  });
export const setCustomer = (id: string | null) => update((c) => void (c.customerId = id));
export const setNote = (note: string) => update((c) => void (c.note = note));
export const clearCart = () => {
  root.setCart(reconcile(structuredClone(EMPTY)));
  persist();
};
export const restoreCart = (s: CartSnapshot) => {
  root.setCart(reconcile({ ...EMPTY, ...s }));
  persist();
};
export const snapshot = (): CartSnapshot => JSON.parse(JSON.stringify(cart));
export { lineKey, type CartLine };
