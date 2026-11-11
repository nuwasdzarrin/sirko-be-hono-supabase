import { describe, it, expect } from 'vitest';
import { detectBarcodeType } from '../../src/lib/barcode.js';

/** Jenis barcode katalog: dari format pemindai, atau check digit GS1 saat diketik manual. */

describe('detectBarcodeType', () => {
  it('kosong → null', () => {
    expect(detectBarcodeType('')).toBeNull();
    expect(detectBarcodeType('   ')).toBeNull();
  });

  it('diketik: EAN-13 / UPC-A / EAN-8 dengan check digit valid', () => {
    expect(detectBarcodeType('8992753102204')).toBe('EAN13'); // contoh barcode produk Indonesia (899…)
    expect(detectBarcodeType('4006381333931')).toBe('EAN13');
    expect(detectBarcodeType(' 4006381333931 ')).toBe('EAN13');
    expect(detectBarcodeType('036000291452')).toBe('UPC');
    expect(detectBarcodeType('96385074')).toBe('EAN8');
  });

  it('diketik: check digit salah / panjang lain / teks → other', () => {
    expect(detectBarcodeType('8992753102205')).toBe('other');
    expect(detectBarcodeType('036000291453')).toBe('other');
    expect(detectBarcodeType('12345')).toBe('other');
    expect(detectBarcodeType('ABC-123')).toBe('other');
  });

  it('hasil scan: format pemindai html5-qrcode menang', () => {
    expect(detectBarcodeType('8992753102204', 'EAN_13')).toBe('EAN13');
    expect(detectBarcodeType('96385074', 'EAN_8')).toBe('EAN8');
    expect(detectBarcodeType('036000291452', 'UPC_A')).toBe('UPC');
    expect(detectBarcodeType('01234565', 'UPC_E')).toBe('UPC');
    expect(detectBarcodeType('https://contoh.id/p/1', 'QR_CODE')).toBe('QR');
    expect(detectBarcodeType('12345', 'CODE_128')).toBe('other');
    expect(detectBarcodeType('12345', 'ITF')).toBe('other');
  });

  it('source fungsi mandiri (disisipkan ke skrip form dashboard) berjalan tanpa import', () => {
    // Helper bawaan compiler (mis. __name dari esbuild keepNames) tak ada di browser.
    expect(detectBarcodeType.toString()).not.toMatch(/__name|__defProp|require\(/);
    const fn = new Function(`${detectBarcodeType.toString()}; return detectBarcodeType;`)() as typeof detectBarcodeType;
    expect(fn('96385074', null)).toBe('EAN8');
    expect(fn('8992753102205', null)).toBe('other');
    expect(fn('8992753102204', null)).toBe('EAN13');
    expect(fn('036000291452', null)).toBe('UPC');
    expect(fn('x', 'QR_CODE')).toBe('QR');
  });
});
