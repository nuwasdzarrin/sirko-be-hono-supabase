/**
 * Waktu = epoch MILIDETIK UTC (spec 08 §8). Disimpan sebagai `bigint` di Postgres,
 * dikirim sebagai integer di JSON. Zona waktu ditangani di client.
 */

/** Waktu server sekarang dalam epoch ms UTC. */
export function nowMs(): number {
  return Date.now();
}

/** True bila `v` adalah epoch ms valid (integer aman non-negatif). */
export function isEpochMs(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/**
 * Postgres `bigint` dikembalikan postgres.js sebagai string (agar tak kehilangan
 * presisi > 2^53). Nilai epoch ms kita < 2^53 → aman dikonversi ke Number untuk
 * dikirim di JSON. Menerima number | string | bigint | null.
 */
export function epochMsFromDb(v: string | number | bigint | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`Nilai epoch ms dari DB di luar rentang aman: ${String(v)}`);
  }
  return n;
}
