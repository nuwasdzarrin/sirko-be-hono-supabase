/**
 * Jenis barcode katalog (sesuai enum skema: EAN13 · EAN8 · UPC · QR · other).
 *
 * Satu sumber untuk server & browser: fungsi ini mandiri (tanpa import/closure) sehingga
 * `detectBarcodeType.toString()` disisipkan apa adanya ke skrip form dashboard.
 *
 * - `scannerFormat` = nama format dari pemindai html5-qrcode (mis. "EAN_13", "UPC_A", "QR_CODE").
 * - Tanpa format (diketik manual): 13/12/8 digit dengan check digit GS1 valid → EAN13/UPC/EAN8;
 *   angka lain atau teks → "other" (QR hanya dari pemindai, karena isinya bisa teks apa saja).
 */
export type BarcodeType = 'EAN13' | 'EAN8' | 'UPC' | 'QR' | 'other';

export function detectBarcodeType(code: string, scannerFormat?: string | null): BarcodeType | null {
  const c = String(code == null ? '' : code).trim();
  if (!c) return null;
  const f = String(scannerFormat || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (f === 'EAN13') return 'EAN13';
  if (f === 'EAN8') return 'EAN8';
  if (f === 'UPCA' || f === 'UPCE' || f === 'UPCEANEXTENSION') return 'UPC';
  if (f === 'QRCODE') return 'QR';
  if (f) return 'other';
  if (!/^\d+$/.test(c)) return 'other';
  if (c.length !== 13 && c.length !== 12 && c.length !== 8) return 'other';
  // Check digit GS1: dari kanan (tanpa check digit) bobot 3,1,3,1…
  // (sengaja tanpa fungsi bernama di dalam — esbuild menyisipkan helper __name yang tak ada di browser)
  let sum = 0;
  for (let i = c.length - 2, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(c[i]) * w;
  if ((10 - (sum % 10)) % 10 !== Number(c[c.length - 1])) return 'other';
  return c.length === 13 ? 'EAN13' : c.length === 12 ? 'UPC' : 'EAN8';
}
