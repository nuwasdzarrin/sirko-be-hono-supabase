import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { makeCover, makeBodyImage, WEBP_MAX_BYTES, WEBP_TARGET_BYTES } from '../../src/lib/site-image.js';
import { coverSrcset, shareImage } from '../../src/site/pages.js';

/** Foto "berat" (derau acak) agar kompresi benar-benar diuji, bukan gambar polos. */
async function noisy(w: number, h: number, format: 'jpeg' | 'png' = 'jpeg'): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24 ^ (i % 251);
  const img = sharp(raw, { raw: { width: w, height: h, channels: 3 } }).blur(1.2);
  return format === 'png' ? img.png().toBuffer() : img.jpeg({ quality: 95 }).toBuffer();
}

describe('Gambar marketing → WebP ringan', { timeout: 30_000 }, () => {
  it('sampul: 1200×630 & 600×315 WebP ≤ 200 KB + JPG og ≤ 200 KB', async () => {
    const set = await makeCover(await noisy(2752, 1536));
    const big = await sharp(set.webp).metadata();
    const small = await sharp(set.webp600).metadata();
    const jpg = await sharp(set.jpg).metadata();
    expect([big.format, big.width, big.height]).toEqual(['webp', 1200, 630]);
    expect([small.format, small.width, small.height]).toEqual(['webp', 600, 315]);
    expect([jpg.format, jpg.width, jpg.height]).toEqual(['jpeg', 1200, 630]);
    for (const b of [set.webp, set.webp600, set.jpg]) expect(b.length).toBeLessThanOrEqual(WEBP_MAX_BYTES);
  });

  it('sampul ilustrasi biasa ≤ 100 KB', async () => {
    const flat = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#0F7B5F' } }).png().toBuffer();
    const set = await makeCover(flat);
    expect(set.webp.length).toBeLessThanOrEqual(WEBP_TARGET_BYTES);
  });

  it('gambar isi: lebar maks 1600, tak diperbesar, PNG → WebP', async () => {
    const wide = await makeBodyImage(await noisy(3000, 2000));
    expect(wide.width).toBeLessThanOrEqual(1600);
    expect(wide.webp.length).toBeLessThanOrEqual(WEBP_MAX_BYTES);
    expect((await sharp(wide.webp).metadata()).format).toBe('webp');
    const tiny = await makeBodyImage(await noisy(400, 300, 'png'));
    expect([tiny.width, tiny.height]).toEqual([400, 300]);
  });

  it('srcset & gambar share: WebP milik Sirko → -600.webp & kembaran .jpg; URL luar tak diubah', () => {
    expect(coverSrcset('/img/blog/a.webp')).toBe('/img/blog/a-600.webp 600w, /img/blog/a.webp 1200w');
    expect(coverSrcset('https://media.sirkopos.com/prod/site/2026/11/a-x1y2z3.webp')).toContain('a-x1y2z3-600.webp 600w');
    expect(coverSrcset('/img/blog/lama.jpg')).toBe('/img/blog/lama-600.jpg 600w, /img/blog/lama.jpg 1200w');
    expect(shareImage('/img/blog/a.webp')).toBe('/img/blog/a.jpg');
    expect(shareImage('https://contoh.com/a.webp')).toBe('https://contoh.com/a.webp');
    expect(coverSrcset('https://contoh.com/a.webp')).toBeNull();
  });
});
