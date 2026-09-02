import { getStorage, type SignUploadResult } from '../lib/storage.ts';
import type { SignUploadRequest } from '../schemas/catalog.schema.ts';
import { forbidden } from '../lib/errors.ts';

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
