/**
 * PBKDF2-HMAC-SHA256 lewat WebCrypto (cepat, native di browser & Node ≥ 20).
 *
 * - PIN karyawan: kredensial `saltB64:hashB64`, 60.000 iterasi, 32 byte — sama persis dengan
 *   `PinHasher` di aplikasi Flutter (lib/features/auth/data/pin_hasher.dart).
 * - Login offline pemilik: `offlineAuth` dari server (KONTRAK akun §5) — iterasi & salt dibaca
 *   dari payload, hasil dibandingkan dengan `hash` (base64).
 */

export const PIN_ITERATIONS = 60_000;
const KEY_LENGTH = 32;

export function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export async function pbkdf2(secret: string, salt: Uint8Array, iterations: number, length = KEY_LENGTH): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, length * 8);
  return new Uint8Array(bits);
}

/** Perbandingan waktu-konstan. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Verifikasi PIN terhadap `saltB64:hashB64` (format PinHasher Flutter). */
export async function verifyPin(pin: string, encoded: string | null | undefined): Promise<boolean> {
  const parts = (encoded ?? '').split(':');
  if (parts.length !== 2) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = b64decode(parts[0]!);
    expected = b64decode(parts[1]!);
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;
  return sameBytes(expected, await pbkdf2(pin, salt, PIN_ITERATIONS, expected.length));
}

/** Hash PIN baru (salt acak 16 byte) → `saltB64:hashB64`. */
export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${b64encode(salt)}:${b64encode(await pbkdf2(pin, salt, PIN_ITERATIONS))}`;
}

export interface OfflineAuth {
  algo: 'pbkdf2-sha256';
  iterations: number;
  keyLength: number;
  salt: string;
  hash: string;
  updatedAt: number | null;
}

/** Cocokkan password dengan `offlineAuth` (login pemilik tanpa internet). */
export async function verifyOfflinePassword(password: string, oa: OfflineAuth | null | undefined): Promise<boolean> {
  if (!oa || oa.algo !== 'pbkdf2-sha256' || !oa.salt || !oa.hash || !(oa.iterations > 0)) return false;
  try {
    const want = b64decode(oa.hash);
    return sameBytes(want, await pbkdf2(password, b64decode(oa.salt), oa.iterations, oa.keyLength || want.length));
  } catch {
    return false;
  }
}

export function uuid(): string {
  return crypto.randomUUID();
}
