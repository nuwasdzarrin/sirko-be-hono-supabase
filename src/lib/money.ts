/**
 * Uang = INTEGER rupiah (spec 08 §8, §14.5). Tak pernah float.
 * Aman di rentang Number JS (< 2^53).
 */

/** Batas aman integer di JSON/JS (Number.MAX_SAFE_INTEGER). */
export const MAX_MONEY = Number.MAX_SAFE_INTEGER;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** True bila `v` adalah nilai uang valid: integer aman & non-negatif. */
export function isMoney(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/**
 * Validasi & normalisasi nilai uang. Lempar {@link MoneyError} bila bukan
 * integer aman non-negatif. Gunakan di batas input server.
 */
export function money(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new MoneyError(`Uang harus angka, diterima: ${typeof v}`);
  }
  if (!Number.isInteger(v)) {
    throw new MoneyError(`Uang harus integer (rupiah), diterima: ${v}`);
  }
  if (!Number.isSafeInteger(v)) {
    throw new MoneyError(`Uang di luar rentang aman: ${v}`);
  }
  if (v < 0) {
    throw new MoneyError(`Uang tak boleh negatif: ${v}`);
  }
  return v;
}

/** Penjumlahan aman — memvalidasi tiap suku & hasil. */
export function addMoney(...values: number[]): number {
  const total = values.reduce((acc, v) => acc + money(v), 0);
  return money(total);
}
