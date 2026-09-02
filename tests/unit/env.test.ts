import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * env.ts memvalidasi & gagal-cepat saat import. Diuji lewat dynamic import
 * setelah memodifikasi process.env (vi.resetModules agar tak kena cache).
 */
describe('config/env', () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...original };
  });
  afterEach(() => {
    process.env = original;
  });

  it('gagal bila DATABASE_URL kosong', async () => {
    delete process.env.DATABASE_URL;
    await expect(import('../../src/config/env.ts')).rejects.toThrow(/DATABASE_URL/);
  });

  it('gagal bila JWT_SECRET terlalu pendek', async () => {
    process.env.DATABASE_URL = 'postgresql://x/y';
    process.env.JWT_SECRET = 'pendek';
    await expect(import('../../src/config/env.ts')).rejects.toThrow(/JWT_SECRET/);
  });

  it('gagal di production bila S3 tak lengkap', async () => {
    process.env.DATABASE_URL = 'postgresql://x/y';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.APP_ENV = 'production';
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_BUCKET;
    await expect(import('../../src/config/env.ts')).rejects.toThrow(/S3/);
  });

  it('sukses dengan env development valid', async () => {
    process.env.DATABASE_URL = 'postgresql://x/y';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.APP_ENV = 'development';
    const mod = await import('../../src/config/env.ts');
    expect(mod.env.APP_ENV).toBe('development');
    expect(mod.ACCESS_TOKEN_TTL_SECONDS).toBe(3600);
  });
});
