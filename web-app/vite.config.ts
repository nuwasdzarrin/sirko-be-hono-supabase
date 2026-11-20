import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { fileURLToPath } from 'node:url';

/**
 * Sirko web app disajikan backend di https://sirkopos.com/app (lihat src/routes/web-app.ts).
 * Hasil build → ../public/app (di-gitignore; dibangun scripts/update.sh di VPS).
 * `@shared/*` = kode backend tanpa dependensi yang dipakai bersama (registry tabel sync).
 */
/** Tulis `assets.json` (daftar semua aset build) → service worker menyimpan semuanya saat dipasang. */
const assetManifest = {
  name: 'sirko-asset-manifest',
  generateBundle(_: unknown, bundle: Record<string, unknown>) {
    const files = Object.keys(bundle).filter((f) => f.startsWith('assets/')).map((f) => `/app/${f}`);
    (this as unknown as { emitFile: (f: object) => void }).emitFile({ type: 'asset', fileName: 'assets.json', source: JSON.stringify(files) });
  },
};

export default defineConfig({
  base: '/app/',
  plugins: [solid(), assetManifest],
  // Id build → URL service worker berubah tiap rilis → browser memasang SW baru & menyimpan aset baru.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../src/db', import.meta.url)) },
  },
  server: {
    port: 5180,
    fs: { allow: ['..'] },
    // Dev: API ke backend lokal.
    proxy: { '/v1': 'http://localhost:47321' },
  },
  build: {
    outDir: '../public/app',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as never);
