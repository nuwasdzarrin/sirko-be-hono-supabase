import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';
import { liveQuery } from 'dexie';

/**
 * Kueri Dexie yang reaktif (otomatis diperbarui saat tabel yang dibaca berubah — mis. setelah
 * penjualan atau sinkron). `dep` = sumber reaktif Solid (mis. DB toko aktif + filter).
 */
export function createLive<D, T>(dep: Accessor<D | null | undefined | false>, query: (d: D) => Promise<T>, initial: T): Accessor<T> {
  const [value, setValue] = createSignal<T>(initial);
  createEffect(() => {
    const d = dep();
    if (!d) {
      setValue(() => initial);
      return;
    }
    const sub = liveQuery(() => query(d)).subscribe({
      next: (v) => setValue(() => v),
      error: (e) => console.error('liveQuery', e),
    });
    onCleanup(() => sub.unsubscribe());
  });
  return value;
}
