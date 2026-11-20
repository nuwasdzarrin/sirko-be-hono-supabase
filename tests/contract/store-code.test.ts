import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { storeCodeOf } from '../../src/db/repositories/business.repository.js';
import { register, makeJuragan, req } from './juragan-helpers.js';

/**
 * Kode toko per akun (J12, migrasi 0017): toko pertama A, cabang B, C; ikut di sesi, /me, daftar
 * toko & switch-business; tak dipakai ulang walau toko dihapus; tak bisa ditimpa push backup app.
 */

let dbUp = false;
try {
  await sql`SELECT 1`;
  dbUp = true;
} catch (err) {
  console.warn(`[contract] DB tak tersambung — suite di-skip: ${(err as Error).message}`);
}
const suite = dbUp ? describe : describe.skip;

describe('storeCodeOf', () => {
  it('1→A … 26→Z, 27→AA, 52→AZ, 53→BA', () => {
    expect([1, 2, 26, 27, 28, 52, 53].map(storeCodeOf)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });
});

suite('Kode toko (J12)', () => {
  const created: string[] = [];

  beforeAll(async () => {
    await runMigrations(sql);
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('toko pertama A; cabang B lalu C; tampil di sesi, /me, daftar toko & switch-business', async () => {
    const o = await register('kode');
    created.push(o.businessId);
    expect(o.data.business.storeCode).toBe('A');
    expect(o.data.businesses).toEqual([expect.objectContaining({ id: o.businessId, storeCode: 'A' })]);

    await makeJuragan(o.token);
    const b = await req('POST', '/v1/businesses', { name: 'Cabang Pasar' }, o.token);
    expect(b.status).toBe(201);
    expect(b.json.data.business.storeCode).toBe('B');
    const c = await req('POST', '/v1/businesses', { name: 'Cabang Terminal' }, b.json.data.accessToken);
    expect(c.json.data.business.storeCode).toBe('C');
    expect(Object.fromEntries(c.json.data.businesses.map((x: { name: string; storeCode: string }) => [x.name, x.storeCode]))).toMatchObject({
      'Cabang Pasar': 'B',
      'Cabang Terminal': 'C',
    });

    const me = await req('GET', '/v1/me', undefined, c.json.data.accessToken);
    expect(me.json.data.business.storeCode).toBe('C');
    const sw = await req('POST', '/v1/auth/switch-business', { businessId: b.json.data.business.id }, c.json.data.accessToken);
    expect(sw.json.data.business.storeCode).toBe('B');

    // Push backup dari app tak bisa menimpa kode toko (kolom tak ada di daftar backup).
    const push = await req(
      'POST',
      '/v1/backup/push',
      {
        clientInfo: { deviceId: 'uji-kode-toko', appVersion: '1.4.0', schemaVersion: 3 },
        tables: { business: [{ id: b.json.data.business.id, name: 'Cabang Pasar Baru', storeCode: 'Z', store_code: 'Z', updatedAt: Date.now() + 1000 }] },
      },
      sw.json.data.accessToken,
    );
    expect(push.status).toBe(200);
    const row = (await sql`SELECT name, store_code FROM businesses WHERE id = ${b.json.data.business.id}`)[0]!;
    expect(row.name).toBe('Cabang Pasar Baru'); // push memang diterapkan…
    expect(row.store_code).toBe('B'); // …tapi kode toko tetap

    // Toko C dihapus → toko baru TIDAK memakai ulang C (invoice lama tetap unik).
    await sql`UPDATE businesses SET deleted_at = ${Date.now()} WHERE id = ${c.json.data.business.id}`;
    const d = await req('POST', '/v1/businesses', { name: 'Cabang Baru' }, sw.json.data.accessToken);
    expect(d.status).toBe(201);
    expect(d.json.data.business.storeCode).toBe('D');
  });

  it('akun lain mulai dari A lagi', async () => {
    const o = await register('kode2');
    expect(o.data.business.storeCode).toBe('A');
  });
});
