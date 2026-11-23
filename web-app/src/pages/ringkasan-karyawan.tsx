import { createResource, createSignal, For, Show } from 'solid-js';
import { can, db, sync } from '../state';
import { rp } from '../pos/calc';
import { employeeSummary, makeRange, type DateRange } from '../finance/report';
import { RangeBar } from './laporan';

/** Ringkasan Karyawan (EmployeeSummaryPage aplikasi, menu Lainnya): transaksi & omzet per kasir. */
export function RingkasanKaryawanPage() {
  const [range, setRange] = createSignal<DateRange>(makeRange('today'));
  const [rows] = createResource(() => { const d = db(); return d ? { d, r: range(), at: sync.lastAt, dirty: sync.dirty } : null; }, ({ d, r }) => employeeSummary(d, r));
  const seeProfit = () => can('viewCostProfit');
  return (
    <div class="report">
      <RangeBar range={range()} onChange={setRange} />
      <div class="m-list">
        <For each={rows()} fallback={<p class="m-caption">Belum ada transaksi pada rentang ini.</p>}>
          {(r) => (
            <div class="m-row">
              <span class="m-avatar">{r.name.trim().charAt(0).toUpperCase() || '?'}</span>
              <span class="m-row-text">
                <span class="m-row-title">{r.name}</span>
                <span class="m-row-sub">{r.count} transaksi<Show when={seeProfit()}> • laba {rp(r.profit)}</Show></span>
              </span>
              <span class="m-row-end"><b>{rp(r.revenue)}</b></span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
