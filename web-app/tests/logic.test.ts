import { describe, it, expect } from 'vitest';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { b64decode, b64encode, hashPin, pbkdf2, verifyOfflinePassword, verifyPin } from '../src/lib/crypto';
import { decodePermissions, PERMISSIONS, resolvePermissions, ROLE_DEFAULTS } from '../src/lib/permissions';
import { allows, daysLeft, GRACE_MS, isActive, planFromJson } from '../src/lib/plan';

describe('PIN karyawan — identik dengan PinHasher Flutter', () => {
  // Dibangkitkan dari Dart: PinHasher.encode(salt=[i*7+3 for i<16], PinHasher.pbkdf2('123456', salt)).
  const DART_VECTOR = 'AwoRGB8mLTQ7QklQV15lbA==:JfrQi6FI0KEDZt0M8yCaouObB33S9NBidXQC37le09g=';

  it('verifikasi hash buatan aplikasi HP', async () => {
    expect(await verifyPin('123456', DART_VECTOR)).toBe(true);
    expect(await verifyPin('123457', DART_VECTOR)).toBe(false);
  });

  it('hash buatan web bisa diverifikasi (format saltB64:hashB64, 60.000 iterasi)', async () => {
    const h = await hashPin('2468');
    expect(h).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    const [salt, hash] = h.split(':') as [string, string];
    expect(b64decode(salt)).toHaveLength(16);
    expect(hash).toBe(pbkdf2Sync('2468', Buffer.from(salt, 'base64'), 60_000, 32, 'sha256').toString('base64'));
    expect(await verifyPin('2468', h)).toBe(true);
  });

  it('kredensial rusak / penanda pemilik "!" ditolak', async () => {
    for (const bad of ['!', '', 'abc', 'a:b:c', null, undefined]) expect(await verifyPin('1234', bad)).toBe(false);
  });

  it('PBKDF2 sesuai vektor RFC 7914 (HMAC-SHA256, c=1)', async () => {
    const out = await pbkdf2('passwd', new TextEncoder().encode('salt'), 1, 64);
    expect(Buffer.from(out).toString('hex')).toBe(
      '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783',
    );
  });
});

describe('login offline pemilik (offlineAuth server)', () => {
  const salt = randomBytes(16).toString('base64');
  const oa = { algo: 'pbkdf2-sha256' as const, iterations: 100_000, keyLength: 32, salt, hash: pbkdf2Sync('rahasia123', Buffer.from(salt, 'base64'), 100_000, 32, 'sha256').toString('base64'), updatedAt: 1 };
  it('password benar diterima, salah ditolak', async () => {
    expect(await verifyOfflinePassword('rahasia123', oa)).toBe(true);
    expect(await verifyOfflinePassword('rahasia124', oa)).toBe(false);
    expect(await verifyOfflinePassword('rahasia123', null)).toBe(false);
    expect(await verifyOfflinePassword('rahasia123', { ...oa, algo: 'md5' as never })).toBe(false);
  });
  it('b64 bolak-balik', () => {
    const b = new Uint8Array([0, 1, 254, 255, 128]);
    expect(b64decode(b64encode(b))).toEqual(b);
  });
});

describe('hak akses — sama dengan PermissionResolver', () => {
  it('owner selalu penuh', () => expect(resolvePermissions('owner').size).toBe(PERMISSIONS.length));
  it('default peran', () => {
    expect([...resolvePermissions('cashier')].sort()).toEqual([...ROLE_DEFAULTS.cashier].sort());
    expect(resolvePermissions('cashier').has('viewCostProfit')).toBe(false);
    expect(resolvePermissions('admin').has('userService')).toBe(false);
    expect(resolvePermissions('admin').has('viewCostProfit')).toBe(true);
    expect(resolvePermissions('staff').has('transactionList')).toBe(false);
  });
  it('custom dari JSON; nama asing & JSON rusak diabaikan', () => {
    expect([...resolvePermissions('custom', '["addProduct","bukanIzin","ppobSell"]')].sort()).toEqual(['addProduct', 'ppobSell']);
    expect(resolvePermissions('custom', ['walletView']).has('walletView')).toBe(true);
    expect(decodePermissions('{rusak').size).toBe(0);
    // Wire = array; string lokal HP; dan string ter-encode berlapis (data lama) tetap terbaca.
    expect([...decodePermissions(['transactionList'])]).toEqual(['transactionList']);
    expect([...decodePermissions(JSON.stringify(JSON.stringify(['transactionList'])))]).toEqual(['transactionList']);
    expect(resolvePermissions('sirko_admin').size).toBe(0);
  });
});

describe('paket — sama dengan Entitlement', () => {
  const now = 1_800_000_000_000;
  const jur = planFromJson({ name: 'juragan', period: 'monthly', expiresAt: now + 86_400_000, maxStores: 3, features: ['staff', 'multi_store', 'fitur_baru'], serverTime: now });
  it('fitur tak dikenal diabaikan', () => expect(jur.features).toEqual(['staff', 'multi_store']));
  it('aktif & fitur', () => {
    expect(allows(jur, 'staff', now)).toBe(true);
    expect(allows(jur, 'advanced_reports', now)).toBe(false);
    expect(daysLeft(jur, now)).toBe(1);
  });
  it('tenggang 3 hari setelah habis, lalu terkunci', () => {
    const end = jur.expiresAt!;
    expect(isActive(jur, end + GRACE_MS - 1)).toBe(true);
    expect(isActive(jur, end + GRACE_MS)).toBe(false);
  });
  it('memundurkan jam perangkat tak memperpanjang', () => {
    const lewat = { ...jur, serverTime: jur.expiresAt! + GRACE_MS + 1 };
    expect(isActive(lewat, 0)).toBe(false);
  });
  it('warung tak punya fitur bundle; gating mati → boleh', () => {
    const w = planFromJson(null);
    expect(allows(w, 'staff', now)).toBe(false);
    expect(allows(w, 'staff', now, false)).toBe(true);
  });
});
