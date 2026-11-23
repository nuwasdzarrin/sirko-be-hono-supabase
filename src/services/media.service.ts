import { getStorage, type SignUploadResult } from '../lib/storage.js';
import type { SignUploadRequest } from '../schemas/catalog.schema.js';
import { forbidden, validation } from '../lib/errors.js';
import { uuid } from '../lib/uuid.js';

/**
 * Media service — terbitkan signed URL upload (client PUT biner langsung ke S3).
 * scope `catalog` khusus sirko_admin; `product` untuk toko terautentikasi.
 */
export function signUpload(input: SignUploadRequest, isSirkoAdmin: boolean): SignUploadResult {
  if (input.scope === 'catalog' && !isSirkoAdmin) {
    throw forbidden('Upload katalog hanya untuk sirko_admin');
  }
  return getStorage().signUpload({
    scope: input.scope,
    fileName: input.fileName,
    contentType: input.contentType,
  });
}

export const MAX_DIRECT_UPLOAD_BYTES = 400 * 1024;

/**
 * Upload gambar lewat server (web app di browser): CSP `connect-src 'self'` & CORS bucket membuat
 * PUT langsung ke presigned URL tak bisa dari browser. Isi file diperiksa (JPG/PNG/WebP, ≤ 400 KB),
 * lalu server mengunggah ke storage dengan key scope `product` (sama dengan sign-upload aplikasi HP).
 */
export async function uploadProductImage(bytes: Uint8Array, fileName: string): Promise<{ publicUrl: string }> {
  const { sniffImageType } = await import('./catalog-admin.service.js');
  if (!bytes.length) throw validation('Gambar kosong.');
  if (bytes.length > MAX_DIRECT_UPLOAD_BYTES) throw validation(`Gambar ${Math.ceil(bytes.length / 1024)} KB — maksimal 400 KB.`);
  const type = sniffImageType(bytes);
  if (!type) throw validation('Gambar harus JPG, PNG, atau WebP.');
  const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'webp';
  const stem = fileName.replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'foto';
  const key = `product/${uuid()}-${stem}.${ext}`;
  const storage = getStorage();
  const res = await fetch(storage.signPut(key, type), {
    method: 'PUT',
    headers: { 'Content-Type': type },
    body: bytes,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw validation(`Upload gambar gagal (HTTP ${res.status}).`);
  return { publicUrl: storage.publicUrl(key) };
}
