import { BACKUP_TABLES } from '@shared/backup-tables';
import { deviceId, type Row, type StoreDb } from '../db/db';
import { recomputeProducts, recomputeVariants, recomputeWallets } from '../db/ledger';

/**
 * Sinkronisasi dua arah — protokol yang sama dengan aplikasi HP (SYNC.md §2–§3, §8):
 *
 * PUSH  baris `_dirty = 1` → POST /v1/backup/push (≤ 500 baris/permintaan, master → header → detail).
 *       Diterima / `skipped STALE` → bersih (bila baris belum diubah lagi sejak dikirim).
 *       `rejected` → `_dirty = 2` + `_syncError` (ditampilkan; tak dikirim ulang terus-menerus).
 * PULL  GET /v1/backup/pull?cursor=… sampai `hasMore = false`. LWW per `updatedAt`; perubahan lokal
 *       yang belum di-push & lebih baru tidak ditimpa. Lalu stok/saldo dihitung ulang dari ledger.
 */

export const APP_VERSION = 'web-0.1.0';
export const SCHEMA_VERSION = 10;
const BATCH = 500;

const KIND = new Map(BACKUP_TABLES.map((t) => [t.wire, t.kind]));
const LOCAL_FIELDS = ['_dirty', '_syncError', 'serverUpdatedAt'];

export type Call = <T>(method: string, path: string, body?: unknown) => Promise<{ data: T; meta?: Record<string, unknown> }>;

interface PushResponse {
  serverTime: number;
  applied: Record<string, number>;
  skipped: Array<{ table: string; id: string; reason: string }>;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
}

const toWire = (r: Row) => {
  const o: Record<string, unknown> = { ...r };
  for (const f of LOCAL_FIELDS) delete o[f];
  return o;
};

export async function push(db: StoreDb, call: Call): Promise<{ sent: number; rejected: number }> {
  let sent = 0;
  let rejected = 0;
  const device = await deviceId();
  for (;;) {
    const batch: Record<string, Row[]> = {};
    let n = 0;
    for (const t of BACKUP_TABLES) {
      if (n >= BATCH) break;
      const rows = await db.t(t.wire).where('_dirty').equals(1).limit(BATCH - n).toArray();
      if (rows.length) {
        batch[t.wire] = rows;
        n += rows.length;
      }
    }
    if (!n) break;
    const body = {
      clientInfo: { deviceId: device, appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION },
      tables: Object.fromEntries(Object.entries(batch).map(([k, rows]) => [k, rows.map(toWire)])),
    };
    const r = (await call<PushResponse>('POST', '/v1/backup/push', body)).data;
    const bad = new Map(r.rejected.map((x) => [`${x.table}:${x.id}`, x]));
    await db.transaction('rw', Object.keys(batch).map((t) => db.t(t)), async () => {
      for (const [table, rows] of Object.entries(batch)) {
        for (const sentRow of rows) {
          const cur = await db.t(table).get(sentRow.id);
          if (!cur || cur.updatedAt !== sentRow.updatedAt || cur._dirty !== 1) continue; // diubah lagi → push berikutnya
          const rej = bad.get(`${table}:${sentRow.id}`);
          if (rej) await db.t(table).update(sentRow.id, { _dirty: 2, _syncError: `${rej.code}: ${rej.message}` });
          else await db.t(table).update(sentRow.id, { _dirty: 0, _syncError: undefined });
        }
      }
    });
    sent += n - r.rejected.length;
    rejected += r.rejected.length;
    if (n < BATCH) break;
  }
  await db.setMeta('lastPushAt', Date.now());
  return { sent, rejected };
}

/** Terapkan satu halaman hasil pull. Mengembalikan jumlah baris yang ditulis. */
export async function applyPulled(db: StoreDb, tables: Record<string, Row[]>): Promise<number> {
  const names = Object.keys(tables).filter((t) => KIND.has(t));
  if (!names.length) return 0;
  let written = 0;
  const touched = { products: new Set<string>(), variants: new Set<string>(), wallets: new Set<string>() };
  const all = [...new Set([...names, 'products', 'product_variants', 'wallets', 'stock_logs', 'wallet_transactions'])];
  await db.transaction('rw', all.map((t) => db.t(t)), async () => {
    for (const table of names) {
      const kind = KIND.get(table);
      for (const remote of tables[table] ?? []) {
        const local = await db.t(table).get(remote.id);
        if (kind === 'append') {
          if (local && local._dirty === 0) continue; // fakta ledger tak berubah
        } else if (local) {
          if (local._dirty === 1 && Number(local.updatedAt) >= Number(remote.updatedAt)) continue; // lokal lebih baru, belum di-push
          if (local._dirty !== 1 && Number(local.updatedAt) > Number(remote.updatedAt)) continue;
        }
        await db.t(table).put({ ...remote, _dirty: 0 });
        written++;
        if (table === 'products') touched.products.add(remote.id);
        if (table === 'product_variants') touched.variants.add(remote.id);
        if (table === 'wallets') touched.wallets.add(remote.id);
        if (table === 'stock_logs') {
          if (remote.variantId) touched.variants.add(String(remote.variantId));
          else if (remote.productId) touched.products.add(String(remote.productId));
        }
        if (table === 'wallet_transactions') {
          if (remote.walletId) touched.wallets.add(String(remote.walletId));
          if (remote.targetWalletId) touched.wallets.add(String(remote.targetWalletId));
        }
      }
    }
    await recomputeProducts(db, touched.products);
    await recomputeVariants(db, touched.variants);
    await recomputeWallets(db, touched.wallets);
  });
  return written;
}

export async function pull(db: StoreDb, call: Call, onPage?: (written: number) => void): Promise<number> {
  let cursor = (await db.meta<string>('syncCursor')) ?? '';
  let total = 0;
  for (let guard = 0; guard < 10_000; guard++) {
    const r = await call<{ serverTime: number; tables: Record<string, Row[]> }>('GET', `/v1/backup/pull?limit=${BATCH}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    const written = await applyPulled(db, r.data.tables ?? {});
    total += written;
    onPage?.(written);
    const next = r.meta?.nextCursor;
    if (typeof next === 'string' && next) {
      cursor = next;
      await db.setMeta('syncCursor', cursor);
    }
    if (!r.meta?.hasMore) break;
  }
  await db.setMeta('lastPullAt', Date.now());
  return total;
}

/** Push lalu pull (konvergen: server lebih baru → didapat lewat pull). */
export async function syncOnce(db: StoreDb, call: Call): Promise<{ sent: number; rejected: number; pulled: number }> {
  const p = await push(db, call);
  const pulled = await pull(db, call);
  return { ...p, pulled };
}
