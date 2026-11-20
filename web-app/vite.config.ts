import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { fileURLToPath } from 'node:url';

/**
 * Sirko web app disajikan backend di https://sirkopos.com/app (lihat src/routes/web-app.ts).
 * Hasil build → ../public/app (di-gitignore; dibangun scripts/update.sh di VPS).
 * `@shared/*` = kode backend tanpa dependensi yang dipakai bersama (registry tabel sync).
 */
export default defineConfig({
  base: '/app/',
  plugins: [solid()],
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
