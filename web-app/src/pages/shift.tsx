import { createResource, createSignal, For, Show } from 'solid-js';
import type { Row } from '../db/db';
import { createLive } from '../lib/live';
import { can, db, user } from '../state';
import { rp } from '../pos/calc';
import { billSummary, openBillFor, PosError, type BillSummary } from '../pos/repo';
import { deleteClosedBill } from '../finance/wallets';
import { fmtDateTime } from '../pos/receipt';
import { Toast } from './ui';
import { ShiftDialog } from './kasir';
import { Icon } from '../ui/icon';

/**
 * Shift / Bill (ShiftsPage aplikasi, menu Lainnya): shift terbuka milik pengguna ini (rekap kas +
 * Tutup Shift) atau tombol Buka Shift, lalu Riwayat Shift.
 */
export function ShiftPage() {
  const [dlg, setDlg] = createSignal(false);
  const [toast, setToast] = createSignal<{ msg: string; kind: 'ok' | 'err' | 'warn' }>({ msg: '', kind: 'ok' });
  const say = (msg: string, kind: 'ok' | 'err' | 'warn' = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast({ msg: '', kind }), 3500);
  };
  const bill = createLive(() => { const d = db(); const u = user(); return d && u ? { d, u: u.id } : null; }, ({ d, u }) => openBillFor(d, u), null as Row | null);
  const [summary] = createResource(() => { const d = db(); const b = bill(); return d && b ? { d, id: b.id } : null; }, ({ d, id }) => billSummary(d, id) as Promise<BillSummary | null>);
  const bills = createLive(db, async (d) => (await d.t('bills').toArray()).filter((b) => b.deletedAt == null && b.status === 'closed').sort((a, b) => Number(b.closedAt ?? 0) - Number(a.closedAt ?? 0)).slice(0, 100), [] as Row[]);
  const names = createLive(db, async (d) => new Map((await d.t('users').toArray()).map((u) => [u.id, String(u.name)])), new Map<string, string>());

  const remove = async (b: Row) => {
    if (!confirm('Hapus catatan shift ini?')) return;
    try {
      await deleteClosedBill(db()!, b.id);
      say('Catatan shift dihapus.');
    } catch (e) {
      say(e instanceof PosError ? e.message : String(e), 'err');
    }
  };

  return (
    <div class="shift-page">
      <Show
        when={bill()}
        fallback={
          <div class="m-card shift-card">
            <p>Tidak ada shift terbuka.</p>
            <button class="btn primary" onClick={() => setDlg(true)}><Icon name="playCircle" size={18} />Buka Shift</button>
          </div>
        }
      >
        {(b) => (
          <div class="m-card shift-card open">
            <div class="m-card-head"><Icon name="playCircle" size={20} /><b>Shift Terbuka</b></div>
            <p class="small">Dibuka: {fmtDateTime(Number(b().openedAt))}</p>
            <Show when={summary()}>
              {(s) => (
                <div class="paysum">
                  <div class="kv"><span>Kas awal</span><span>{rp(s().openingCash)}</span></div>
                  <div class="kv"><span>Penjualan tunai bersih ({s().txCount} nota)</span><span>{rp(s().netCashSales)}</span></div>
                  <div class="kv"><b>Kas seharusnya</b><b>{rp(s().expectedCash)}</b></div>
                </div>
              )}
            </Show>
            <button class="btn primary" onClick={() => setDlg(true)}><Icon name="stopCircle" size={18} />Tutup Shift</button>
          </div>
        )}
      </Show>

      <h2 class="m-section">Riwayat Shift</h2>
      <div class="m-list">
        <For each={bills()} fallback={<p class="m-caption">Belum ada shift yang ditutup.</p>}>
          {(b) => {
            const v = () => Number(b.variance ?? 0);
            return (
              <div class="m-row">
                <span class="m-row-text">
                  <span class="m-row-title">Ditutup: {fmtDateTime(Number(b.closedAt))}</span>
                  <span class="m-row-sub">
                    {names().get(String(b.employeeId)) ?? '—'} • kas awal {rp(Number(b.openingCash ?? 0))} • seharusnya {rp(Number(b.expectedCash ?? 0))} • fisik {rp(Number(b.closingCash ?? 0))}
                  </span>
                </span>
                <span class="m-row-end">
                  <b class={v() ? 'bad-t' : ''}>{v() === 0 ? 'Pas' : `${v() > 0 ? '+' : ''}${rp(v())}`}</b>
                  <Show when={can('deleteClosedBill')}>
                    <button class="btn text sm bad" onClick={() => void remove(b)}>Hapus</button>
                  </Show>
                </span>
              </div>
            );
          }}
        </For>
      </div>
      <Show when={dlg()}>
        <ShiftDialog bill={bill()} onClose={() => setDlg(false)} say={say} />
      </Show>
      <Toast msg={toast().msg} kind={toast().kind} />
    </div>
  );
}
