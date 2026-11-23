import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { app } from '../../src/app.js';

/** Rute penyaji web app `/app` (SPA). Isi build (public/app) opsional di lingkungan test. */

const built = existsSync('public/app/index.html');

describe('Web app /app', () => {
  it('rute SPA mana pun → index.html (atau 503 bila belum dibangun), CSP ketat, noindex', async () => {
    for (const p of ['/app', '/app/', '/app/masuk', '/app/kasir/123']) {
      const r = await app.request(p);
      expect(r.status).toBe(built ? 200 : 503);
      const csp = r.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(r.headers.get('x-robots-tag')).toBe('noindex');
      if (built) {
        expect(r.headers.get('cache-control')).toBe('no-cache');
        expect(await r.text()).toContain('<div id="root">');
      }
    }
  });

  it.runIf(built)('aset ber-hash di-cache lama; aset hilang → 404 (bukan index.html)', async () => {
    const html = await (await app.request('/app/')).text();
    const js = /\/app\/assets\/[^"]+\.js/.exec(html)![0];
    const r = await app.request(js);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('immutable');
    expect((await app.request('/app/assets/tidak-ada.js')).status).toBe(404);
    const sw = await app.request('/app/sw.js');
    expect(sw.status).toBe(200);
    expect(sw.headers.get('cache-control')).toBe('no-cache');
    expect(sw.headers.get('service-worker-allowed')).toBe('/app');
    // Daftar aset untuk pra-simpan service worker: no-cache & memuat semua chunk (termasuk halaman lazy).
    const list = await app.request('/app/assets.json');
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toBe('no-cache');
    const files = (await list.json()) as string[];
    expect(files).toContain(js);
    expect(files.filter((f) => f.endsWith('.js')).length).toBeGreaterThan(1);
    // Logo (sidebar desktop & halaman Lainnya HP) disajikan sebagai gambar, bukan fallback index.html.
    const logo = await app.request('/app/lockup.png');
    expect(logo.status).toBe(200);
    expect(logo.headers.get('content-type')).toContain('image/png');
    // Ikon PNG untuk pemasangan PWA (Chrome Android "Instal aplikasi").
    for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
      const r = await app.request(`/app/${f}`);
      expect(r.status, f).toBe(200);
      expect(r.headers.get('content-type'), f).toContain('image/png');
    }
  });

  it('API & situs tidak terganggu', async () => {
    expect((await app.request('/v1/health')).status).toBe(200);
  });
});
