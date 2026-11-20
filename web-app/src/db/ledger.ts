import type { StoreDb, Row } from './db';

/**
 * Saldo turunan dihitung ulang dari ledger (SYNC.md §8.6) — stok & saldo kas BUKAN sumber
 * kebenaran, ledger-lah sumbernya. Dua kasir yang offline bersamaan konvergen setelah sync.
 *
 * | products.stock         | Σ stock_logs.qtyChange (productId = id, variantId kosong)
 * | product_variants.stock | Σ stock_logs.qtyChange (variantId = id)
 * | wallets.balance        | Σ in − Σ out − Σ transfer keluar + Σ transfer masuk
 *
 * Hanya baris ledger yang tak terhapus. Kolom saldo ditulis hanya bila berbeda, TANPA menandai
 * dirty (hasil hitungan, bukan perubahan pengguna — tak di-push balik).
 */

const live = (r: Row) => r.deletedAt == null;

export async function recomputeProducts(db: StoreDb, ids: Iterable<string>): Promise<number> {
  let changed = 0;
  for (const id of new Set(ids)) {
    const p = await db.t('products').get(id);
    if (!p) continue;
    const logs = await db.t('stock_logs').where('productId').equals(id).toArray();
    const stock = logs.filter((l) => live(l) && !l.variantId).reduce((s, l) => s + Number(l.qtyChange ?? 0), 0);
    if (logs.length && Number(p.stock ?? 0) !== stock) {
      await db.t('products').update(id, { stock });
      changed++;
    }
  }
  return changed;
}

export async function recomputeVariants(db: StoreDb, ids: Iterable<string>): Promise<number> {
  let changed = 0;
  for (const id of new Set(ids)) {
    const v = await db.t('product_variants').get(id);
    if (!v) continue;
    const logs = await db.t('stock_logs').where('variantId').equals(id).toArray();
    const stock = logs.filter(live).reduce((s, l) => s + Number(l.qtyChange ?? 0), 0);
    if (logs.length && Number(v.stock ?? 0) !== stock) {
      await db.t('product_variants').update(id, { stock });
      changed++;
    }
  }
  return changed;
}

export async function recomputeWallets(db: StoreDb, ids: Iterable<string>): Promise<number> {
  let changed = 0;
  for (const id of new Set(ids)) {
    const w = await db.t('wallets').get(id);
    if (!w) continue;
    const own = (await db.t('wallet_transactions').where('walletId').equals(id).toArray()).filter(live);
    const incoming = (await db.t('wallet_transactions').where('targetWalletId').equals(id).toArray()).filter(live);
    if (!own.length && !incoming.length) continue;
    let bal = 0;
    for (const t of own) {
      const a = Number(t.amount ?? 0);
      if (t.type === 'in') bal += a;
      else bal -= a; // out & transfer keluar
    }
    for (const t of incoming) if (t.type === 'transfer') bal += Number(t.amount ?? 0);
    if (Number(w.balance ?? 0) !== bal) {
      await db.t('wallets').update(id, { balance: bal });
      changed++;
    }
  }
  return changed;
}
