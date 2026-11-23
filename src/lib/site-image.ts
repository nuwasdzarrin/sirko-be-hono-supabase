import sharp from 'sharp';

/**
 * Gambar MARKETING situs (sampul blog/halaman, gambar isi artikel) → WebP ringan untuk PageSpeed.
 * Target ≤ 100 KB, batas keras 200 KB. Foto katalog produk TIDAK lewat sini (tetap JPG/PNG/WebP
 * asli karena dipakai juga oleh aplikasi Android).
 *
 * Sampul menghasilkan 3 file dengan nama dasar sama:
 *   <nama>.webp      1200×630  → <img> di halaman (LCP)
 *   <nama>-600.webp  600×315   → srcset HP
 *   <nama>.jpg       1200×630  → og:image (pratinjau WhatsApp/Facebook paling andal dengan JPG)
 */

export const WEBP_TARGET_BYTES = 100 * 1024;
export const WEBP_MAX_BYTES = 200 * 1024;
/** Ukuran file sumber yang boleh diunggah (dikonversi di server). */
export const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

sharp.cache(false); // RAM server terbatas: jangan simpan cache libvips
sharp.concurrency(1);

const QUALITIES = [80, 70, 60, 50, 40];

export class ImageTooLargeError extends Error {}

/** Kompres berulang: kualitas tertinggi yang ≤ target; bila tak ada, yang pertama ≤ batas keras. */
async function encodeUnder(
  render: (q: number) => Promise<Buffer>,
  target = WEBP_TARGET_BYTES,
  max = WEBP_MAX_BYTES,
): Promise<Buffer> {
  let fallback: Buffer | null = null;
  for (const q of QUALITIES) {
    const out = await render(q);
    if (out.length <= target) return out;
    if (!fallback && out.length <= max) fallback = out;
  }
  if (fallback) return fallback;
  throw new ImageTooLargeError(`Gambar tetap di atas ${Math.round(max / 1024)} KB setelah dikompres.`);
}

const base = (input: Buffer) => sharp(input, { failOn: 'error', limitInputPixels: 60_000_000 }).rotate();

/** Potong tengah ke w×h (rasio sampul), latar putih untuk gambar transparan. */
function coverPipe(input: Buffer, w: number, h: number) {
  return base(input).resize(w, h, { fit: 'cover', position: 'attention' }).flatten({ background: '#ffffff' });
}

export interface CoverSet {
  webp: Buffer;
  webp600: Buffer;
  jpg: Buffer;
}

export async function makeCover(input: Buffer): Promise<CoverSet> {
  const webp = await encodeUnder((q) => coverPipe(input, 1200, 630).webp({ quality: q, effort: 4, smartSubsample: true }).toBuffer());
  const webp600 = await encodeUnder((q) => coverPipe(input, 600, 315).webp({ quality: q, effort: 4, smartSubsample: true }).toBuffer(), 40 * 1024);
  const jpg = await encodeUnder((q) => coverPipe(input, 1200, 630).jpeg({ quality: q, mozjpeg: true, progressive: true }).toBuffer());
  return { webp, webp600, jpg };
}

export interface BodyImage {
  webp: Buffer;
  width: number;
  height: number;
}

/** Gambar isi artikel: lebar maks 1600 (tak diperbesar), WebP; transparansi dipertahankan. */
export async function makeBodyImage(input: Buffer, maxW = 1600): Promise<BodyImage> {
  const meta = await base(input).metadata();
  const rotated = (meta.orientation ?? 1) >= 5;
  const srcW = (rotated ? meta.height : meta.width) ?? maxW;
  const srcH = (rotated ? meta.width : meta.height) ?? maxW;
  // Turunkan lebar bertahap bila kualitas minimum pun masih di atas batas.
  const first = Math.min(maxW, srcW);
  for (const w of [...new Set([first, 1200, 960].filter((x) => x <= first))]) {
    try {
      const webp = await encodeUnder((q) =>
        base(input).resize({ width: w, withoutEnlargement: true }).webp({ quality: q, effort: 4, smartSubsample: true }).toBuffer(),
      );
      const width = w;
      return { webp, width, height: Math.round((srcH * width) / srcW) };
    } catch (e) {
      if (!(e instanceof ImageTooLargeError)) throw e;
    }
  }
  throw new ImageTooLargeError('Gambar terlalu rumit untuk dikompres di bawah 200 KB. Coba potong atau pakai gambar lain.');
}
