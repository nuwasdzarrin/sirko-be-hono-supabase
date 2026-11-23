import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../../src/app.js';
import { sql } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { uuid } from '../../src/lib/uuid.js';
import { registerOwnerStore } from '../helpers/owner-store.js';

/**
 * POST /v1/media/upload — unggah foto lewat server (web app di browser: CSP & CORS mencegah PUT
 * langsung ke bucket). Menguji gerbang auth & validasi isi; unggah sungguhan butuh storage (S3/R2).
 */

let dbUp = false;
try {
  await sql`SELECT 1`;
  dbUp = true;
} catch (err) {
  console.warn(`[contract] DB tak tersambung — suite di-skip: ${(err as Error).message}`);
}
const suite = dbUp ? describe : describe.skip;

const upload = (body: Uint8Array | string, token?: string, type = 'image/jpeg') =>
  app.request('/v1/media/upload?fileName=foto-uji', {
    method: 'POST',
    headers: { 'Content-Type': type, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body,
  });

suite('media upload (web app)', () => {
  let token = '';
  beforeAll(async () => {
    await runMigrations(sql);
    const tag = uuid().slice(0, 8);
    const { json } = await registerOwnerStore({
      business: { name: `Toko Upload ${tag}` },
      owner: { name: `U ${tag}`, email: `up-${tag}@toko.id`, password: 'rahasia123' },
    });
    token = json.data.accessToken as string;
  });

  it('tanpa token → 401', async () => {
    expect((await upload(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).status).toBe(401);
  });

  it('bukan gambar (isi diperiksa, bukan header) → 422', async () => {
    const r = await upload('ini bukan gambar', token);
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: { message: string } }).error.message).toContain('JPG, PNG, atau WebP');
  });

  it('lebih dari 400 KB → 422', async () => {
    const big = new Uint8Array(401 * 1024);
    big.set([0xff, 0xd8, 0xff, 0xe0]);
    const r = await upload(big, token);
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: { message: string } }).error.message).toContain('maksimal 400 KB');
  });

  it('kosong → 422', async () => {
    expect((await upload(new Uint8Array(0), token)).status).toBe(422);
  });
});
