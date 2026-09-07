/**
 * Helper nama & tipe berkas aset katalog — dipakai bersama oleh export
 * (bundle lokal) dan mirror (upload ke S3). Nama deterministik & mudah dibaca:
 *   <slug-nama-produk>_<barcode>.<ext>   mis. coca_cola_390ml_5449000000996.jpg
 */

export function extOf(url: string): string {
  const m = url.split('?')[0]!.match(/\.(jpg|jpeg|png|webp|gif)$/i);
  return (m ? m[1]! : 'jpg').toLowerCase();
}

export function safeBarcode(bc: string): string {
  return bc.replace(/[^0-9A-Za-z_-]/g, '');
}

export function slugName(name: string | null): string {
  const s = (name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // buang aksen (combining marks)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  return s || 'produk';
}

export function assetFilename(name: string | null, barcode: string, photoUrl: string): string {
  return `${slugName(name)}_${safeBarcode(barcode)}.${extOf(photoUrl)}`;
}

export function contentTypeFor(fileOrExt: string): string {
  const ext = (fileOrExt.split('.').pop() ?? fileOrExt).toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    default:
      return 'image/jpeg';
  }
}
