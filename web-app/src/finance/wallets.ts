import type { Row, StoreDb } from '../db/db';
import { uuid } from '../lib/crypto';
import { PosError } from '../pos/repo';

/**
 * Kas & dompet — salinan WalletRepository (lib/features/wallets/data/wallet_repository.dart).
 * Saldo = Σ mutasi (in − out − transfer keluar + transfer masuk), setiap perubahan saldo disertai
 * baris wallet_transactions dalam satu transaksi.
 */

export type WalletType = 'cash' | 'bank' | 'ewallet';
export const WALLET_TYPE_LABEL: Record<WalletType, string> = { cash: 'Tunai', bank: 'Bank', ewallet: 'E-Wallet' };

const fresh = (now: number, cols: Record<string, unknown>): Row => ({ id: uuid(), createdAt: now, updatedAt: now, deletedAt: null, ...cols, _dirty: 1 });
const touch = (now: number, patch: Record<string, unknown>) => ({ ...patch, updatedAt: now, _dirty: 1 });
const blank = (s?: string | null) => (s?.trim() ? s.trim() : null);
const T = ['wallets', 'wallet_transactions'];

function mutation(now: number, c: { walletId: string; type: 'in' | 'out' | 'transfer'; amount: number; targetWalletId?: string | null; category?: string | null; refType?: string | null; note?: string | null }) {
  return fresh(now, { walletId: c.walletId, type: c.type, amount: c.amount, targetWalletId: c.targetWalletId ?? null, category: blank(c.category), refType: c.refType ?? null, refId: null, note: blank(c.note), datetime: now });
}

export async function createWallet(db: StoreDb, name: string, type: WalletType, openingBalance = 0, note?: string): Promise<string> {
  if (!name.trim()) throw new PosError('Nama wallet wajib diisi.');
  if (openingBalance < 0) throw new PosError('Saldo awal tak boleh negatif.');
  return db.transaction('rw', T.map((t) => db.table(t)), async () => {
    const now = Date.now();
    const w = fresh(now, { name: name.trim(), type, balance: openingBalance });
    await db.t('wallets').put(w);
    if (openingBalance > 0) await db.t('wallet_transactions').put(mutation(now, { walletId: w.id, type: 'in', amount: openingBalance, category: 'modal', note: note || 'Saldo awal' }));
    return w.id;
  });
}

export async function renameWallet(db: StoreDb, id: string, name: string, type: WalletType): Promise<void> {
  if (!name.trim()) throw new PosError('Nama wallet wajib diisi.');
  await db.t('wallets').update(id, touch(Date.now(), { name: name.trim(), type }));
}

export async function deleteWallet(db: StoreDb, id: string): Promise<void> {
  const w = await db.t('wallets').get(id);
  if (!w) return;
  if (Number(w.balance ?? 0) !== 0) throw new PosError('Wallet masih punya saldo. Kosongkan dulu sebelum menghapus.');
  const now = Date.now();
  await db.t('wallets').update(id, touch(now, { deletedAt: now }));
}

export async function deposit(db: StoreDb, walletId: string, amount: number, category?: string, note?: string): Promise<void> {
  if (amount <= 0) throw new PosError('Nominal harus lebih dari 0.');
  await db.transaction('rw', T.map((t) => db.table(t)), async () => {
    const now = Date.now();
    const w = await db.t('wallets').get(walletId);
    if (!w) throw new PosError('Wallet tak ditemukan.');
    await db.t('wallets').update(walletId, touch(now, { balance: Number(w.balance ?? 0) + amount }));
    await db.t('wallet_transactions').put(mutation(now, { walletId, type: 'in', amount, category, note }));
  });
}

export async function withdraw(db: StoreDb, walletId: string, amount: number, category?: string, note?: string): Promise<void> {
  if (amount <= 0) throw new PosError('Nominal harus lebih dari 0.');
  await db.transaction('rw', T.map((t) => db.table(t)), async () => {
    const now = Date.now();
    const w = await db.t('wallets').get(walletId);
    if (!w) throw new PosError('Wallet tak ditemukan.');
    const bal = Number(w.balance ?? 0);
    if (bal < amount) throw new PosError(`Saldo tak cukup (tersedia ${bal}, diminta ${amount}).`);
    await db.t('wallets').update(walletId, touch(now, { balance: bal - amount }));
    await db.t('wallet_transactions').put(mutation(now, { walletId, type: 'out', amount, category, note }));
  });
}

export async function transfer(db: StoreDb, fromId: string, toId: string, amount: number, note?: string): Promise<void> {
  if (fromId === toId) throw new PosError('Wallet asal & tujuan tidak boleh sama.');
  if (amount <= 0) throw new PosError('Nominal harus lebih dari 0.');
  await db.transaction('rw', T.map((t) => db.table(t)), async () => {
    const now = Date.now();
    const from = await db.t('wallets').get(fromId);
    const to = await db.t('wallets').get(toId);
    if (!from || !to) throw new PosError('Wallet asal/tujuan tak ditemukan.');
    const fb = Number(from.balance ?? 0);
    if (fb < amount) throw new PosError(`Saldo "${from.name}" tak cukup untuk transfer (tersedia ${fb}, diminta ${amount}).`);
    await db.t('wallets').update(fromId, touch(now, { balance: fb - amount }));
    await db.t('wallets').update(toId, touch(now, { balance: Number(to.balance ?? 0) + amount }));
    await db.t('wallet_transactions').put(mutation(now, { walletId: fromId, type: 'transfer', amount, targetWalletId: toId, category: 'transfer', refType: 'transfer', note }));
  });
}

/** Hapus shift yang sudah ditutup (izin deleteClosedBill; BillRepository.deleteClosedBill). */
export async function deleteClosedBill(db: StoreDb, id: string): Promise<void> {
  const b = await db.t('bills').get(id);
  if (!b) return;
  if (b.status !== 'closed') throw new PosError('Hanya bill yang sudah ditutup bisa dihapus.');
  const now = Date.now();
  await db.t('bills').update(id, touch(now, { deletedAt: now }));
}
