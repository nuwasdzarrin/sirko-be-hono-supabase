import { For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import type { Row, StoreDb } from '../db/db';
import { METHOD_LABEL, rp, type PaymentMethod } from './calc';
import { storeInfo } from './repo';

/**
 * Struk — tata letak sama dengan struk PDF/thermal aplikasi HP (receipt_pdf.dart): nama toko,
 * alamat, telepon, No & Waktu, item (qty x harga, diskon), Subtotal/Diskon/Pajak/Pembulatan/TOTAL,
 * pembayaran, Bayar/Kembali, footer. Dicetak lewat dialog cetak browser (printer thermal 58/80 mm
 * yang terpasang di komputer, atau PDF).
 */

export interface ReceiptData {
  storeName: string;
  storeAddress: string | null;
  storePhone: string | null;
  invoiceNo: string;
  datetime: number;
  status: string;
  lines: Array<{ name: string; qty: number; unitPrice: number; discount: number; lineTotal: number }>;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  taxInclusive: boolean;
  roundingAdjustment: number;
  grandTotal: number;
  payments: Array<{ method: PaymentMethod; amount: number }>;
  paidTotal: number;
  changeTotal: number;
  customerName: string | null;
  footerText: string;
  paper: 'mm58' | 'mm80';
}

const two = (n: number) => String(n).padStart(2, '0');
export const fmtDateTime = (ms: number) => {
  const d = new Date(ms);
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
};

export async function loadReceipt(db: StoreDb, transactionId: string, fallbackStoreName: string): Promise<ReceiptData | null> {
  const tx = await db.t('transactions').get(transactionId);
  if (!tx) return null;
  const items = (await db.t('transaction_items').where('transactionId').equals(transactionId).toArray()).sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
  const pays = await db.t('payments').where('transactionId').equals(transactionId).toArray();
  const info = await storeInfo(db, fallbackStoreName);
  const preset = (await db.t('receipt_presets').toArray()).filter((p) => p.deletedAt == null).sort((a, b) => Number(b.isDefault === true) - Number(a.isDefault === true))[0];
  const customer: Row | undefined = tx.customerId ? await db.t('customers').get(String(tx.customerId)) : undefined;
  return {
    storeName: info.name,
    storeAddress: info.address,
    storePhone: info.phone,
    invoiceNo: String(tx.invoiceNo),
    datetime: Number(tx.datetime),
    status: String(tx.status),
    lines: items.map((i) => ({ name: String(i.nameSnapshot), qty: Number(i.qty), unitPrice: Number(i.unitPrice), discount: Number(i.discount ?? 0), lineTotal: Number(i.lineTotal) })),
    subtotal: Number(tx.subtotal ?? 0),
    discountTotal: Number(tx.discountTotal ?? 0),
    taxTotal: Number(tx.taxTotal ?? 0),
    taxInclusive: info.config.taxInclusive,
    roundingAdjustment: Number(tx.roundingAdjustment ?? 0),
    grandTotal: Number(tx.grandTotal ?? 0),
    payments: pays.map((p) => ({ method: p.method as PaymentMethod, amount: Number(p.amount) })),
    paidTotal: Number(tx.paidTotal ?? 0),
    changeTotal: Number(tx.changeTotal ?? 0),
    customerName: customer ? String(customer.name) : null,
    footerText: String(preset?.footerText ?? '').trim() || 'Terima kasih',
    paper: preset?.paperSize === 'mm80' ? 'mm80' : 'mm58',
  };
}

const KV = (p: { k: string; v: string; b?: boolean }) => (
  <div class={`r-kv ${p.b ? 'r-b' : ''}`}><span>{p.k}</span><span>{p.v}</span></div>
);

export function Receipt(props: { data: ReceiptData }) {
  const d = () => props.data;
  return (
    <div class={`receipt ${d().paper}`}>
      <div class="r-c r-b r-store">{d().storeName}</div>
      <Show when={d().storeAddress}><div class="r-c">{d().storeAddress}</div></Show>
      <Show when={d().storePhone}><div class="r-c">{d().storePhone}</div></Show>
      <div class="r-hr" />
      <KV k="No" v={d().invoiceNo} />
      <KV k="Waktu" v={fmtDateTime(d().datetime)} />
      <Show when={d().customerName}><KV k="Pelanggan" v={d().customerName!} /></Show>
      <Show when={d().status === 'void'}><div class="r-c r-b">*** DIBATALKAN ***</div></Show>
      <div class="r-hr" />
      <For each={d().lines}>
        {(l) => (
          <>
            <div>{l.name}</div>
            <KV k={`${l.qty} x ${rp(l.unitPrice)}`} v={rp(l.lineTotal + l.discount)} />
            <Show when={l.discount > 0}><KV k="  Diskon" v={`-${rp(l.discount)}`} /></Show>
          </>
        )}
      </For>
      <div class="r-hr" />
      <KV k="Subtotal" v={rp(d().subtotal)} />
      <Show when={d().discountTotal > 0}><KV k="Diskon" v={`-${rp(d().discountTotal)}`} /></Show>
      <Show when={d().taxTotal > 0}><KV k={d().taxInclusive ? 'Pajak (termasuk)' : 'Pajak'} v={rp(d().taxTotal)} /></Show>
      <Show when={d().roundingAdjustment !== 0}><KV k="Pembulatan" v={`${d().roundingAdjustment > 0 ? '+' : ''}${rp(d().roundingAdjustment)}`} /></Show>
      <KV k="TOTAL" v={rp(d().grandTotal)} b />
      <div class="r-hr" />
      <For each={d().payments}>{(p) => <KV k={METHOD_LABEL[p.method] ?? p.method} v={rp(p.amount)} />}</For>
      <KV k="Bayar" v={rp(d().paidTotal)} />
      <Show when={d().paidTotal < d().grandTotal} fallback={<KV k="Kembali" v={rp(d().changeTotal)} />}>
        <KV k="Sisa (hutang)" v={rp(d().grandTotal - d().paidTotal)} b />
      </Show>
      <div class="r-hr" />
      <div class="r-c">{d().footerText}</div>
    </div>
  );
}

/** Cetak struk lewat dialog cetak browser; ukuran halaman = lebar kertas thermal. */
export function printReceipt(data: ReceiptData): void {
  document.getElementById('print-root')?.remove();
  document.getElementById('print-page')?.remove();
  const host = document.createElement('div');
  host.id = 'print-root';
  document.body.appendChild(host);
  const style = document.createElement('style');
  style.id = 'print-page';
  style.textContent = `@page { size: ${data.paper === 'mm80' ? '80mm' : '58mm'} auto; margin: 0; }`;
  document.head.appendChild(style);
  const dispose = render(() => <Receipt data={data} />, host);
  document.body.classList.add('printing-receipt');
  const cleanup = () => {
    document.body.classList.remove('printing-receipt');
    dispose();
    host.remove();
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  requestAnimationFrame(() => window.print());
}
