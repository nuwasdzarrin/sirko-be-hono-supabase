import { describe, it, expect, afterEach, vi } from 'vitest';
import { app } from '../../src/app.js';
import { TOOLS } from '../../src/site/tools.js';
import { tagSignupLinks, signupUrl } from '../../src/site/layout.js';
import { sql } from '../../src/db/client.js';

/** Alat gratis /alat/* terjadwal + penanda asal ajakan (?dari=). Tanpa DB untuk rute alat. */
async function dbReady(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

describe('Alat gratis /alat/* (terjadwal)', () => {
  afterEach(() => vi.useRealTimers());

  it('sebelum tanggal tayang: 404 & tak ada di sitemap', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-11-25T00:00:00Z'));
    for (const t of TOOLS) expect((await app.request(t.path)).status, t.path).toBe(404);
    if (await dbReady()) {
      const xml = await (await app.request('/sitemap.xml')).text();
      expect(xml).not.toContain('/alat/');
    }
  });

  it('setelah tayang: 200, skrip same-origin, schema FAQ & WebApplication, ajakan ber-penanda, masuk sitemap', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-12-09T00:00:00Z'));
    for (const t of TOOLS) {
      const r = await app.request(t.path);
      expect(r.status, t.path).toBe(200);
      const html = await r.text();
      expect(html).toMatch(/<script src="\/js\/[a-z-]+\.js" defer><\/script>/);
      expect(html).toContain('"FAQPage"');
      expect(html).toContain('"WebApplication"');
      expect(html).toMatch(/href="\/app\/daftar\?dari=alat-[a-z-]+"/);
      expect(html).toContain(`<link rel="canonical" href="https://sirkopos.com${t.path}"`);
    }
    for (const js of ['/js/kalkulator-laba.js', '/js/template-buku-hutang.js']) {
      expect((await app.request(js)).status, js).toBe(200);
    }
    if (await dbReady()) {
      const xml = await (await app.request('/sitemap.xml')).text();
      for (const t of TOOLS) expect(xml).toContain(`https://sirkopos.com${t.path}`);
    }
  });
});

describe('Penanda asal ajakan (?dari=)', () => {
  it('tautan /app/daftar di isi diberi penanda; yang sudah bertanda tak diubah', () => {
    expect(signupUrl('beranda-hero')).toBe('/app/daftar?dari=beranda-hero');
    const out = tagSignupLinks('<a href="/app/daftar">a</a> <a href="/app/daftar?dari=x">b</a>', 'artikel-abc');
    expect(out).toContain('href="/app/daftar?dari=artikel-abc"');
    expect(out).toContain('href="/app/daftar?dari=x"');
  });
});
