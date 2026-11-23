import { describe, it, expect, afterEach, vi } from 'vitest';
import sharp from 'sharp';
import { app } from '../../src/app.js';
import { sql } from '../../src/db/client.js';

/**
 * Dashboard → Website → unggah gambar: server mengonversi gambar marketing ke WebP ≤ 200 KB
 * (target 100 KB). PUT ke storage dicegat (tanpa R2 sungguhan).
 */
let dbUp = false;
try {
  await sql`SELECT 1`;
  dbUp = true;
} catch {
  /* skip */
}
const authOn = Boolean(process.env.DASHBOARD_USER && process.env.DASHBOARD_PASSWORD);
const suite = dbUp && authOn ? describe : describe.skip;

async function login(): Promise<string> {
  const res = await app.request('/dashboard/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ user: process.env.DASHBOARD_USER!, password: process.env.DASHBOARD_PASSWORD!, next: '/dashboard' }).toString(),
  });
  return (res.headers.get('set-cookie') ?? '').split(';')[0]!;
}

async function photo(w: number, h: number): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = ((i * 2654435761) >>> 24) ^ (i % 251);
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).blur(1.2).jpeg({ quality: 95 }).toBuffer();
}

function capturePuts() {
  const puts: { path: string; type: string; size: number }[] = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (init?.method === 'PUT') {
      const body = init.body as Buffer;
      puts.push({ path: new URL(String(input)).pathname, type: new Headers(init.headers).get('Content-Type') ?? '', size: body.length });
      return new Response(null, { status: 200 });
    }
    return real(input, init);
  });
  return puts;
}

async function upload(cookie: string, file: Buffer, kind: 'cover' | 'body', name = 'Foto Warung.jpg') {
  const fd = new FormData();
  fd.append('file', new File([file], name, { type: 'image/jpeg' }));
  fd.append('kind', kind);
  return app.request('/dashboard/site/upload', { method: 'POST', headers: { Cookie: cookie }, body: fd });
}

suite('Dashboard → unggah gambar situs (WebP)', { timeout: 30_000 }, () => {
  afterEach(() => vi.restoreAllMocks());

  it('sampul → .webp + -600.webp + .jpg (og), semua ≤ 200 KB; URL disimpan .webp', async () => {
    const cookie = await login();
    const puts = capturePuts();
    const r = await upload(cookie, await photo(2400, 1600), 'cover');
    expect(r.status).toBe(200);
    const j = (await r.json()) as { url: string; width: number; height: number };
    expect(j.url).toMatch(/\/site\/\d{4}\/\d{2}\/foto-warung-[a-z0-9]{6}\.webp$/);
    expect([j.width, j.height]).toEqual([1200, 630]);
    const base = j.url.replace(/\.webp$/, '').split('/site/')[1]!;
    expect(puts.map((p) => p.path.split('/site/')[1]).sort()).toEqual([`${base}-600.webp`, `${base}.jpg`, `${base}.webp`].sort());
    for (const p of puts) {
      expect(p.size).toBeLessThanOrEqual(200 * 1024);
      expect(p.type).toBe(p.path.endsWith('.jpg') ? 'image/jpeg' : 'image/webp');
    }
  });

  it('gambar isi → satu .webp, lebar ≤ 1600, dimensi dikembalikan', async () => {
    const cookie = await login();
    const puts = capturePuts();
    const r = await upload(cookie, await photo(3000, 2000), 'body');
    const j = (await r.json()) as { url: string; width: number; height: number };
    expect(r.status).toBe(200);
    expect(j.url).toMatch(/\.webp$/);
    expect(j.width).toBeLessThanOrEqual(1600);
    expect(j.height).toBe(Math.round((2000 * j.width) / 3000));
    expect(puts).toHaveLength(1);
    expect(puts[0]!.size).toBeLessThanOrEqual(200 * 1024);
  });

  it('bukan gambar → 422; tanpa sesi → tidak diproses', async () => {
    const cookie = await login();
    const r = await upload(cookie, Buffer.from('bukan gambar'), 'cover');
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: string }).error).toContain('JPG, PNG, atau WebP');
    const anon = await upload('', await photo(100, 100), 'cover');
    expect(anon.status).not.toBe(200);
  });
});
