import Dexie, { type Table } from 'dexie';
import { BACKUP_TABLES } from '@shared/backup-tables';

/**
 * Penyimpanan lokal (IndexedDB via Dexie) — mengikuti aplikasi HP:
 *
 * - `sirko`               : DB global perangkat (id perangkat, sesi akun/toko, pengguna aktif).
 * - `sirko-store-<id>`    : satu DB per toko (seperti satu file SQLite per toko di HP). Tabelnya
 *                           = tabel sync backend (registry `backup-tables.ts`, satu sumber kebenaran),
 *                           baris disimpan dalam bentuk wire (camelCase) + kolom lokal:
 *                             `_dirty`  1 = belum di-push · 0 = sudah · 2 = ditolak server (lihat `_syncError`)
 * - Tabel `_meta` per toko: kursor pull & waktu sync terakhir.
 */

export type Row = Record<string, unknown> & { id: string; updatedAt: number; deletedAt?: number | null; _dirty?: number; _syncError?: string };

export const SYNC_TABLES = BACKUP_TABLES.map((t) => t.wire);
export type SyncTable = string;

/** Indeks tambahan per tabel (kolom relasi & pencarian). */
const EXTRA_INDEX: Record<string, string[]> = {
  products: ['barcode', 'name', 'categoryId'],
  product_variants: ['productId', 'barcode'],
  wholesale_prices: ['productId'],
  customers: ['name', 'phone'],
  users: ['username'],
  transactions: ['datetime', 'invoiceNo', 'customerId', 'cashierId', 'billId'],
  bills: ['employeeId'],
  app_settings: ['key'],
  transaction_items: ['transactionId', 'productId', 'variantId'],
  payments: ['transactionId'],
  installments: ['transactionId'],
  credit_payments: ['transactionId', 'customerId', 'installmentId'],
  stock_logs: ['productId', 'variantId', 'refId'],
  wallet_transactions: ['walletId', 'targetWalletId', 'refId'],
  purchases: ['supplierId'],
  purchase_items: ['purchaseId', 'productId'],
  stock_opname_items: ['opnameId', 'productId'],
};

/** Transaksi tertunda ("Tunda") — KHUSUS perangkat, tak ikut sync (sama dengan HP, schema v9). */
export interface HeldSale {
  id: string;
  label: string;
  cashierId: string | null;
  cart: unknown;
  itemCount: number;
  total: number;
  createdAt: number;
}

export class StoreDb extends Dexie {
  _meta!: Table<{ key: string; value: unknown }, string>;
  held_sales!: Table<HeldSale, string>;

  constructor(readonly businessId: string) {
    super(`sirko-store-${businessId}`);
    const schema: Record<string, string> = { _meta: '&key' };
    for (const t of SYNC_TABLES) schema[t] = ['&id', 'updatedAt', '_dirty', ...(EXTRA_INDEX[t] ?? [])].join(', ');
    schema.held_sales = '&id, createdAt';
    // v2 (Fase 2): + held_sales, indeks billId/employeeId/key. Belum pernah rilis v1 ke produksi.
    this.version(2).stores(schema);
  }

  t(name: SyncTable): Table<Row, string> {
    return this.table(name);
  }

  async meta<T>(key: string): Promise<T | undefined> {
    return (await this._meta.get(key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this._meta.put({ key, value });
  }

  /** Jumlah baris yang belum tersinkron (dan yang ditolak server). */
  async pending(): Promise<{ dirty: number; rejected: number }> {
    let dirty = 0;
    let rejected = 0;
    for (const t of SYNC_TABLES) {
      dirty += await this.t(t).where('_dirty').equals(1).count();
      rejected += await this.t(t).where('_dirty').equals(2).count();
    }
    return { dirty, rejected };
  }
}

const stores = new Map<string, StoreDb>();

export function storeDb(businessId: string): StoreDb {
  let db = stores.get(businessId);
  if (!db) {
    db = new StoreDb(businessId);
    stores.set(businessId, db);
  }
  return db;
}

/** Hapus seluruh data satu toko dari browser. */
export async function deleteStoreDb(businessId: string): Promise<void> {
  const db = stores.get(businessId);
  if (db) {
    db.close();
    stores.delete(businessId);
  }
  await Dexie.delete(`sirko-store-${businessId}`);
}

/** Semua DB toko yang ada di browser ini. */
export async function listStoreDbIds(): Promise<string[]> {
  const names = await Dexie.getDatabaseNames();
  return names.filter((n) => n.startsWith('sirko-store-')).map((n) => n.slice('sirko-store-'.length));
}

// ── DB global perangkat ──────────────────────────────────────────────────────

class DeviceDb extends Dexie {
  kv!: Table<{ key: string; value: unknown }, string>;
  constructor() {
    super('sirko');
    this.version(1).stores({ kv: '&key' });
  }
}

export const deviceDb = new DeviceDb();

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await deviceDb.kv.get(key))?.value as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  if (value === undefined) await deviceDb.kv.delete(key);
  else await deviceDb.kv.put({ key, value });
}

/** Id perangkat tetap per browser (dikirim di `clientInfo.deviceId`). */
export async function deviceId(): Promise<string> {
  let id = await kvGet<string>('deviceId');
  if (!id) {
    id = crypto.randomUUID();
    await kvSet('deviceId', id);
  }
  return id;
}
