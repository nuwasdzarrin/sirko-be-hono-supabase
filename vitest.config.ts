import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Contract tests hit a real Postgres; run serially to keep tenant fixtures isolated.
    fileParallelism: false,
    // Memuat .env (bila ada) + fallback secret deterministik SEBELUM modul di-import.
    setupFiles: ['tests/setup/env.setup.ts'],
  },
});
