import { describe, it, expect } from 'vitest';
import { getStorage } from '../../src/lib/storage.ts';

/**
 * Unit test presigner SigV4 (zero-dep). Memakai S3 dummy dari env.setup.ts:
 * endpoint https://s3.test.local/storage/v1/s3, region ap-southeast-1, bucket sirko-media.
 */
describe('storage / SigV4 presigner', () => {
  const storage = getStorage();

  it('signed URL berbentuk benar (query SigV4 lengkap)', () => {
    const r = storage.signUpload({ scope: 'catalog', fileName: 'indomie.jpg', contentType: 'image/jpeg' });

    expect(r.method).toBe('PUT');
    expect(r.expiresIn).toBe(300);
    expect(r.headers['Content-Type']).toBe('image/jpeg');

    const url = new URL(r.uploadUrl);
    expect(url.host).toBe('s3.test.local');
    expect(url.pathname).toContain('/storage/v1/s3/sirko-media/catalog/');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Credential')).toContain('ap-southeast-1/s3/aws4_request');
    // Signature = 64 hex chars (HMAC-SHA256).
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('key/publicUrl memakai scope + nama file yang disanitasi (tanpa spasi)', () => {
    const r = storage.signUpload({ scope: 'product', fileName: 'foto produk!.jpg', contentType: 'image/jpeg' });
    expect(r.publicUrl).toContain('/sirko-media/product/');
    expect(r.publicUrl.endsWith('.jpg')).toBe(true);
    expect(r.publicUrl).not.toMatch(/\s/); // spasi & karakter aneh dibersihkan
    // key = scope/uuid-namafile → ada prefix uuid.
    expect(r.publicUrl).toMatch(/\/product\/[0-9a-f-]{36}-/);
  });

  it('signature berubah bila konten (key/waktu) berbeda — bukan konstanta', () => {
    const a = storage.signUpload({ scope: 'catalog', fileName: 'a.jpg', contentType: 'image/jpeg' });
    const b = storage.signUpload({ scope: 'catalog', fileName: 'b.jpg', contentType: 'image/jpeg' });
    const sigA = new URL(a.uploadUrl).searchParams.get('X-Amz-Signature');
    const sigB = new URL(b.uploadUrl).searchParams.get('X-Amz-Signature');
    expect(sigA).not.toBe(sigB); // key (uuid) beda → signature beda
  });
});
