import { describe, it, expect } from 'vitest';
import {
  MAX_PHOTO_BYTES,
  sniffImageType,
  photoFileName,
  assertDisplayablePhotoUrl,
} from '../../src/services/catalog-admin.service.js';

/** Foto katalog dashboard: maks 200 KB, hanya JPG/PNG/WebP (tampil di app Flutter), nama berpola. */

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

describe('foto katalog', () => {
  it('batas ukuran 200 KB', () => {
    expect(MAX_PHOTO_BYTES).toBe(204_800);
  });

  it('format dikenali dari isi file, bukan ekstensi', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffImageType(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')))).toBe('image/webp');
    // Tidak didukung decoder Flutter / bukan foto → ditolak.
    expect(sniffImageType(bytes(0, 0, 0, 0x18, ...ascii('ftypheic')))).toBeNull(); // HEIC
    expect(sniffImageType(bytes(0, 0, 0, 0x1c, ...ascii('ftypavif')))).toBeNull(); // AVIF
    expect(sniffImageType(bytes(...ascii('GIF89a')))).toBeNull();
    expect(sniffImageType(bytes(...ascii('<svg xmlns')))).toBeNull();
    expect(sniffImageType(bytes(...ascii('BM')))).toBeNull();
  });

  it('nama: <nama-asli>-<6 a-z0-9>.<ext>', () => {
    // Nama dari browser yang sudah berpola dipakai apa adanya.
    expect(photoFileName('indomie-goreng-k3f9x2.jpg', 'jpg')).toBe('indomie-goreng-k3f9x2.jpg');
    // Nama mentah dibentuk ulang: slug + 6 acak + ekstensi sesuai format asli.
    const n = photoFileName('Foto Indomie Goreng (1).PNG', 'webp');
    expect(n).toMatch(/^foto-indomie-goreng-1-[a-z0-9]{6}\.webp$/);
    expect(photoFileName('', 'jpg')).toMatch(/^produk-[a-z0-9]{6}\.jpg$/);
    // Acak berbeda tiap unggahan.
    expect(photoFileName('a.jpg', 'jpg')).not.toBe(photoFileName('a.jpg', 'jpg'));
  });

  it('URL foto manual: format yang tak tampil di app ditolak', () => {
    expect(() => assertDisplayablePhotoUrl('https://x.com/a.jpg')).not.toThrow();
    expect(() => assertDisplayablePhotoUrl('https://x.com/a.webp?v=1')).not.toThrow();
    expect(() => assertDisplayablePhotoUrl(null)).not.toThrow();
    for (const ext of ['heic', 'avif', 'svg', 'gif', 'bmp', 'tiff']) {
      expect(() => assertDisplayablePhotoUrl(`https://x.com/foto.${ext}`)).toThrow(/JPG, PNG, atau WebP/);
    }
  });
});
