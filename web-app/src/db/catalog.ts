import Dexie, { type Table } from 'dexie';
import { createSignal } from 'solid-js';
import { searchCatalog, type CatalogItem } from '../cloud/catalog';

/**
 * Cache Katalog Umum di browser — padanan tabel `public_products` aplikasi HP. Data publik (bukan
 * milik toko): DB terpisah, tidak di-push, tidak ikut dihapus saat keluar akun.
 */
class CatalogDb extends Dexie {
  products!: Table<CatalogItem, string>;
  meta!: Table<{ key: string; value: unknown }, string>;
  constructor() {
    super('sirko-catalog');
    this.version(1).stores({ products: '&id, barcode, name', meta: '&key' });
  }
}

export const catalogDb = new CatalogDb();

/** Upsert by id (fallback barcode) — sama dengan upsertItems aplikasi. */
export async function upsertCatalog(items: CatalogItem[]): Promise<void> {
  if (!items.length) return;
  await catalogDb.products.bulkPut(items.map((i) => ({ ...i, id: i.id || i.barcode || crypto.randomUUID() })));
}

export async function findCachedByBarcode(barcode: string): Promise<CatalogItem | null> {
  const code = barcode.trim();
  if (!code) return null;
  return (await catalogDb.products.where('barcode').equals(code).first()) ?? null;
}

/** Cari di cache: nama, barcode, atau kata kunci mengandung `q` (seperti LIKE %q% di aplikasi), maks 100. */
export async function searchCache(q: string, limit = 100): Promise<CatalogItem[]> {
  const s = q.trim().toLowerCase();
  const rows = s
    ? await catalogDb.products
        .filter((p) => p.name.toLowerCase().includes(s) || (p.barcode ?? '').includes(s) || p.keywords.some((k) => k.toLowerCase().includes(s)))
        .toArray()
    : await catalogDb.products.toArray();
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'id')).slice(0, limit);
}

export const cacheCount = () => catalogDb.products.count();
export const lastSyncAt = async () => ((await catalogDb.meta.get('lastSyncAt'))?.value as number | undefined) ?? 0;

// ── Sync penuh: search(q:'', limit 50) per halaman kursor, maks 400 halaman ──────────────────

const [syncing, setSyncing] = createSignal(false);
const [syncProcessed, setSyncProcessed] = createSignal(0);
/** Versi cache — naik tiap sync selesai agar daftar Cache memuat ulang. */
const [cacheVersion, setCacheVersion] = createSignal(0);
export { syncing, syncProcessed, cacheVersion };
export const bumpCache = () => setCacheVersion(cacheVersion() + 1);

/** Jalan di latar (tetap lanjut walau halaman Katalog ditutup). Mengembalikan jumlah produk. */
export async function syncCatalog(): Promise<number> {
  if (syncing()) return syncProcessed();
  setSyncing(true);
  setSyncProcessed(0);
  let processed = 0;
  try {
    let cursor: string | null = null;
    for (let page = 0; page < 400; page++) {
      const r = await searchCatalog('', cursor, 50);
      await upsertCatalog(r.items);
      processed += r.items.length;
      setSyncProcessed(processed);
      if (!r.hasMore || !r.nextCursor) break;
      cursor = r.nextCursor;
    }
    await catalogDb.meta.put({ key: 'lastSyncAt', value: Date.now() });
    return processed;
  } finally {
    setSyncing(false);
    bumpCache();
  }
}
