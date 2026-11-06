import { app } from '../../src/app.js';
import { uuid } from '../../src/lib/uuid.js';

/**
 * Helper test: buat PEMILIK + TOKO lewat alur akun baru (pengganti endpoint lama
 * `register-business` yang sudah dihapus): register → verify-email (devCode, karena
 * setup test menyalakan AUTH_DEV_OTP_ECHO) → POST /v1/businesses.
 *
 * Menerima body format lama `{ business: {name, businessType?}, owner: {name, email?, phone?, password} }`
 * dan mengembalikan `{ status, json }` berbentuk sama dengan respons lama (201 + objek sesi toko),
 * supaya test lama cukup mengganti pemanggilnya. Error daftar (409/422/…) diteruskan apa adanya.
 */

let seq = 0;

function randomIp(): string {
  const b = crypto.getRandomValues(new Uint8Array(3));
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}

async function call(method: string, path: string, body: unknown, token?: string) {
  const res = await app.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      // IP acak per panggilan: batas daftar per IP (10/jam) tak terpicu oleh test — modul ini
      // dimuat ulang per file test (penghitung mulai 0 lagi), jadi jangan pakai urutan.
      'cf-connecting-ip': randomIp(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

export interface LegacyRegisterBody {
  business?: { name?: string; businessType?: string | null };
  owner?: { name?: string; email?: string | null; phone?: string | null; password?: string };
}

/** Nomor WA unik untuk test (format 08…). */
export function uniquePhone(): string {
  const rnd = crypto.getRandomValues(new Uint32Array(1))[0]! % 100_000;
  const digits = (String(rnd).padStart(5, '0') + String(++seq).padStart(4, '0')).slice(-9);
  return `0857${digits}`;
}

export async function registerOwnerStore(body: LegacyRegisterBody): Promise<{ status: number; json: any }> {
  const owner = body.owner ?? {};
  const reg = await call('POST', '/v1/auth/register', {
    name: owner.name,
    email: owner.email ?? `pemilik-${uuid().slice(0, 8)}@toko.id`,
    phone: owner.phone ?? uniquePhone(),
    password: owner.password,
  });
  if (reg.status !== 201) return reg;
  const ver = await call('POST', '/v1/auth/verify-email', { email: reg.json.data.email, code: reg.json.data.devCode });
  if (ver.status !== 200) return ver;
  if (!body.business) return ver;
  return call(
    'POST',
    '/v1/businesses',
    { name: body.business.name, ...(body.business.businessType ? { businessType: body.business.businessType } : {}) },
    ver.json.data.accessToken,
  );
}
