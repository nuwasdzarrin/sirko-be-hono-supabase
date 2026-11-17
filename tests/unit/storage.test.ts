import { describe, it, expect } from 'vitest';
import { createS3Storage, getStorage } from '../../src/lib/storage.js';
import { env } from '../../src/config/env.js';

/**
 * Unit test presigner SigV4 (zero-dep). Nilai S3 diambil dari env aktif
 * (env.setup.ts memuat .env bila ada, atau fallback dummy). Test memvalidasi
 * STRUKTUR SigV4 — bukan host tertentu — agar tak rapuh terhadap konfigurasi.
 */
describe('storage / SigV4 presigner', () => {
  const storage = getStorage();
  const endpointHost = new URL(process.env.S3_ENDPOINT!).host;
  const bucket = process.env.S3_BUCKET!;
  const region = process.env.S3_REGION!;
  const envDir = env.STORAGE_ENV; // folder lingkungan di bucket (dev/staging/prod)

  it('signed URL berbentuk benar (query SigV4 lengkap)', () => {
    const r = storage.signUpload({ scope: 'catalog', fileName: 'indomie.jpg', contentType: 'image/jpeg' });

    expect(r.method).toBe('PUT');
    expect(r.expiresIn).toBe(300);
    expect(r.headers['Content-Type']).toBe('image/jpeg');

    const url = new URL(r.uploadUrl);
    expect(url.host).toBe(endpointHost);
    expect(url.pathname).toContain(`/${bucket}/${envDir}/catalog/`);
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Credential')).toContain(`${region}/s3/aws4_request`);
    // Signature = 64 hex chars (HMAC-SHA256).
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('key/publicUrl memakai scope + nama file yang disanitasi (tanpa spasi)', () => {
    const r = storage.signUpload({ scope: 'product', fileName: 'foto produk!.jpg', contentType: 'image/jpeg' });
    expect(r.publicUrl).toContain(`/${bucket}/${envDir}/product/`);
    expect(r.publicUrl.endsWith('.jpg')).toBe(true);
    expect(r.publicUrl).not.toMatch(/\s/); // spasi & karakter aneh dibersihkan
    // key = scope/uuid-namafile → ada prefix uuid.
    expect(r.publicUrl).toMatch(new RegExp(`/${envDir}/product/[0-9a-f-]{36}-`));
  });

  it('signature berubah bila konten (key/waktu) berbeda — bukan konstanta', () => {
    const a = storage.signUpload({ scope: 'catalog', fileName: 'a.jpg', contentType: 'image/jpeg' });
    const b = storage.signUpload({ scope: 'catalog', fileName: 'b.jpg', contentType: 'image/jpeg' });
    const sigA = new URL(a.uploadUrl).searchParams.get('X-Amz-Signature');
    const sigB = new URL(b.uploadUrl).searchParams.get('X-Amz-Signature');
    expect(sigA).not.toBe(sigB); // key (uuid) beda → signature beda
  });

  it('STORAGE_ENV default dev di luar production', () => {
    expect(['dev', 'staging', 'prod']).toContain(envDir);
    if (!process.env.STORAGE_ENV && env.APP_ENV !== 'production') expect(envDir).toBe('dev');
  });

  it('signPut, signGet & publicUrl memakai key logis + folder lingkungan yang sama', () => {
    const put = new URL(storage.signPut('site/2026/11/a.jpg', 'image/jpeg'));
    const get = new URL(storage.signGet('site/2026/11/a.jpg'));
    expect(put.pathname.endsWith(`/${bucket}/${envDir}/site/2026/11/a.jpg`)).toBe(true);
    expect(get.pathname).toBe(put.pathname);
    expect(storage.publicUrl('site/2026/11/a.jpg').endsWith(`/${envDir}/site/2026/11/a.jpg`)).toBe(true);
    // signature GET ≠ PUT (method ikut ditandatangani)
    expect(get.searchParams.get('X-Amz-Signature')).not.toBe(put.searchParams.get('X-Amz-Signature'));
  });
});

describe('storage / createS3Storage (R2 & bucket lama)', () => {
  const r2 = createS3Storage({
    endpoint: 'https://acc123.r2.cloudflarestorage.com',
    region: 'auto',
    bucket: 'sirko-media',
    accessKeyId: 'k',
    secretAccessKey: 's',
    publicBaseUrl: 'https://media.example.com/',
    keyPrefix: 'prod',
  });

  it('R2: path-style tanpa base path, region auto, URL publik dari custom domain', () => {
    const u = new URL(r2.signPut('catalog/x.jpg', 'image/jpeg'));
    expect(u.host).toBe('acc123.r2.cloudflarestorage.com');
    expect(u.pathname).toBe('/sirko-media/prod/catalog/x.jpg');
    expect(u.searchParams.get('X-Amz-Credential')).toContain('/auto/s3/aws4_request');
    expect(r2.publicUrl('catalog/x.jpg')).toBe('https://media.example.com/prod/catalog/x.jpg');
  });

  it('tanpa keyPrefix (bucket lama) → key apa adanya', () => {
    const old = createS3Storage({
      endpoint: 'https://ref.storage.supabase.co/storage/v1/s3',
      region: 'ap-southeast-1',
      bucket: 'sirko-media',
      accessKeyId: 'k',
      secretAccessKey: 's',
      publicBaseUrl: 'https://ref.storage.supabase.co/storage/v1/object/public/sirko-media',
    });
    expect(new URL(old.signGet('catalog/x.jpg')).pathname).toBe('/storage/v1/s3/sirko-media/catalog/x.jpg');
    expect(old.publicUrl('catalog/x.jpg')).toBe('https://ref.storage.supabase.co/storage/v1/object/public/sirko-media/catalog/x.jpg');
  });
});
