import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import type { Row } from '../db/db';
import { createLive } from '../lib/live';
import { activeStore, db, syncNow } from '../state';
import { METHOD_LABEL, rp, type PaymentMethod } from '../pos/calc';
import { PosError, voidTransaction } from '../pos/repo';
import { fmtDateTime, loadReceipt, printReceipt, Receipt } from '../pos/receipt';
import { Icon } from '../ui/icon';

/**
 * Riwayat transaksi (sama dengan HP: terbaru dulu, nota yang dibatalkan tersembunyi kecuali diminta)
 * + detail nota: cetak ulang struk & batalkan (void: stok kembali, kas & hutang disesuaikan).
 */

const STATUS: Record<string, [string, string]> = {
  paid: ['Lunas', 'ok'],
  partial: ['Sebagian', 'warn'],
  credit: ['Kasbon', 'warn'],
  void: ['Batal', 'off'],
};

const startOfDay = (offsetDays = 0) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetDays);
  return d.getTime();
};

const RANGES = [
  { key: 'today', label: 'Hari ini', from: () => startOfDay(0) },
  { key: '7', label: '7 hari', from: () => startOfDay(6) },
  { key: '30', label: '30 hari', from: () => startOfDay(29) },
  { key: 'all', label: 'Semua', from: () => 0 },
];

export function TransaksiPage() {
  const params = useParams();
  const nav = useNavigate();
  const [range, setRange] = createSignal('today');
  const [q, setQ] = createSignal('');
  const [showVoid, setShowVoid] = createSignal(false);

  const txs = createLive(
    () => { const d = db(); return d ? { d, from: RANGES.find((r) => r.key === range())!.from() } : null; },
    ({ d, from }) => d.t('transactions').where('datetime').aboveOrEqual(from).reverse().sortBy('datetime'),
    [] as Row[],
  );
  const people = createLive(db, async (d) => {
    const m = new Map<string, string>();
    for (const c of await d.t('customers').toArray()) m.set(c.id, String(c.name));
    for (const u of await d.t('users').toArray()) m.set(u.id, String(u.name));
    return m;
  }, new Map<string, string>());

  const list = createMemo(() => {
    const s = q().trim().toLowerCase();
    return txs()
      .filter((t) => showVoid() || t.deletedAt == null)
      .filter((t) => !s || String(t.invoiceNo).toLowerCase().includes(s) || (people().get(String(t.customerId)) ?? '').toLowerCase().includes(s));
  });
  const summary = createMemo(() => {
    const ok = list().filter((t) => t.status !== 'void' && t.deletedAt == null);
    return { count: ok.length, total: ok.reduce((s, t) => s + Number(t.grandTotal ?? 0), 0) };
  });

  return (
    <div class="split">
      {/* HP: daftar seperti TransactionHistoryScreen aplikasi */}
        <section class="split-list">
          <div class="m-toolbar">
            <input class="pos-search" placeholder="Cari no. nota / pelanggan" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
          </div>
          <div class="m-chiprow">
            <For each={RANGES}>{(r) => <button class={`chip ${range() === r.key ? 'on' : ''}`} onClick={() => setRange(r.key)}>{r.label}</button>}</For>
            <button class={`chip ${showVoid() ? 'on' : ''}`} onClick={() => setShowVoid(!showVoid())}>Dibatalkan</button>
          </div>
          <p class="m-caption">{summary().count} nota · {rp(summary().total)}</p>
          <div class="m-list">
            <For each={list().slice(0, 500)} fallback={<div class="m-empty"><Icon name="receiptLong" size={64} /><b>Belum ada transaksi</b></div>}>
              {(t) => {
                const st = () => String(t.deletedAt != null ? 'void' : t.status);
                return (
                  <button class="m-row" classList={{ sel: params.id === t.id }} onClick={() => nav(`/transaksi/${t.id}`)}>
                    <span class={`m-avatar tx-${st()}`}><Icon name="receiptLong" /></span>
                    <span class="m-row-text">
                      <span class="m-row-title b">{String(t.invoiceNo)}</span>
                      <span class="m-row-sub">
                        {fmtDateTime(Number(t.datetime))} • {STATUS[st()]?.[0] ?? st()}
                        {t.customerId ? ` • ${people().get(String(t.customerId)) ?? ''}` : ''}
                      </span>
                    </span>
                    <span class="m-row-end"><b class={st() === 'void' ? 'mut' : ''}>{rp(Number(t.grandTotal ?? 0))}</b></span>
                  </button>
                );
              }}
            </For>
          </div>
        </section>
      <Show when={params.id} fallback={<aside class="split-detail mut empty">Pilih nota untuk melihat rincian.</aside>}>
        <TxDetail id={params.id!} people={people()} onClose={() => nav('/transaksi')} />
      </Show>
    </div>
  );
}

function TxDetail(props: { id: string; people: Map<string, string>; onClose: () => void }) {
  const [msg, setMsg] = createSignal<{ t: string; err?: boolean }>({ t: '' });
  const data = createLive(
    () => { const d = db(); return d ? { d, id: props.id } : null; },
    async ({ d, id }) => {
      const tx = await d.t('transactions').get(id);
      if (!tx) return null;
      const items = (await d.t('transaction_items').where('transactionId').equals(id).toArray()).sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
      const pays = await d.t('payments').where('transactionId').equals(id).toArray();
      const creditPaid = (await d.t('credit_payments').where('transactionId').equals(id).toArray()).filter((c) => c.deletedAt == null).reduce((s, c) => s + Number(c.amount ?? 0), 0);
      return { tx, items, pays, creditPaid };
    },
    null as null | { tx: Row; items: Row[]; pays: Row[]; creditPaid: number },
  );
  const [receipt] = createResource(() => [db(), props.id, data()?.tx.updatedAt] as const, ([d, id]) => (d ? loadReceipt(d, id, activeStore()?.name ?? 'Toko') : null));

  const doVoid = async () => {
    const d = db();
    if (!d) return;
    if (!confirm('Batalkan transaksi ini?\n\nStok akan dikembalikan. Bila transaksi kredit, hutang pelanggan juga disesuaikan. Nota disimpan sebagai jejak audit.')) return;
    try {
      const r = await voidTransaction(d, props.id);
      setMsg({ t: r.debtReversed > 0 ? `Transaksi dibatalkan. Hutang berkurang ${rp(r.debtReversed)}.` : 'Transaksi dibatalkan, stok dikembalikan.' });
      void syncNow();
    } catch (e) {
      setMsg({ t: `Gagal membatalkan: ${e instanceof PosError ? e.message : (e as Error).message}`, err: true });
    }
  };

  return (
    <aside class="split-detail">
      <Show when={data()} fallback={<p class="mut">Memuat…</p>}>
        {(x) => {
          const t = () => x().tx;
          const remaining = () => Math.max(0, Number(t().grandTotal) - Number(t().paidTotal) - x().creditPaid);
          return (
            <>
              <div class="row-btns">
                <h2 style={{ margin: 0 }}>{String(t().invoiceNo)}</h2>
                <span class={`badge ${STATUS[String(t().status)]?.[1] ?? ''}`}>{STATUS[String(t().status)]?.[0]}</span>
                <span class="spacer" />
                <button class="x" aria-label="Tutup" onClick={props.onClose}>×</button>
              </div>
              <p class="mut small">
                {fmtDateTime(Number(t().datetime))} · Kasir: {props.people.get(String(t().cashierId)) ?? '—'} · Pelanggan: {t().customerId ? props.people.get(String(t().customerId)) ?? '—' : 'Umum'}
                <Show when={t()._dirty === 1}> · <span class="bad-t">belum tersinkron</span></Show>
              </p>
              <Show when={msg().t}><div class={`alert ${msg().err ? 'err' : 'ok'}`}>{msg().t}</div></Show>
              <table class="list">
                <tbody>
                  <For each={x().items}>
                    {(i) => (
                      <tr>
                        <td>{String(i.nameSnapshot)}<div class="small mut">{Number(i.qty)} × {rp(Number(i.unitPrice))}{Number(i.discount) ? ` · diskon ${rp(Number(i.discount))}` : ''}</div></td>
                        <td class="num">{rp(Number(i.lineTotal))}</td>
                      </tr>
                    )}
                  </For>
                  <tr><td>Subtotal</td><td class="num">{rp(Number(t().subtotal))}</td></tr>
                  <Show when={Number(t().discountTotal)}><tr><td>Diskon</td><td class="num">-{rp(Number(t().discountTotal))}</td></tr></Show>
                  <Show when={Number(t().taxTotal)}><tr><td>Pajak</td><td class="num">{rp(Number(t().taxTotal))}</td></tr></Show>
                  <Show when={Number(t().roundingAdjustment)}><tr><td>Pembulatan</td><td class="num">{rp(Number(t().roundingAdjustment))}</td></tr></Show>
                  <tr class="strong"><td>Total</td><td class="num">{rp(Number(t().grandTotal))}</td></tr>
                  <For each={x().pays}>{(p) => <tr><td class="mut">{METHOD_LABEL[p.method as PaymentMethod] ?? String(p.method)}</td><td class="num">{rp(Number(p.amount))}</td></tr>}</For>
                  <Show when={Number(t().changeTotal)}><tr><td class="mut">Kembalian</td><td class="num">{rp(Number(t().changeTotal))}</td></tr></Show>
                  <Show when={t().status === 'credit' || t().status === 'partial'}>
                    <Show when={x().creditPaid}><tr><td class="mut">Sudah dicicil</td><td class="num">{rp(x().creditPaid)}</td></tr></Show>
                    <tr class="strong"><td>Sisa hutang</td><td class="num bad-t">{rp(remaining())}</td></tr>
                  </Show>
                </tbody>
              </table>
              <Show when={t().note}><p class="small"><b>Catatan:</b> {String(t().note)}</p></Show>
              <div class="row-btns" style={{ 'margin-top': '14px' }}>
                <Show when={receipt()}><button class="btn" onClick={() => printReceipt(receipt()!)}>Cetak ulang struk</button></Show>
                <span class="spacer" />
                <Show when={t().status !== 'void'}><button class="btn bad" onClick={doVoid}>Batalkan transaksi</button></Show>
              </div>
              <Show when={receipt()}><details style={{ 'margin-top': '14px' }}><summary class="small mut">Pratinjau struk</summary><Receipt data={receipt()!} /></details></Show>
            </>
          );
        }}
      </Show>
    </aside>
  );
}
