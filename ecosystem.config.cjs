// PM2 Ecosystem Config — Sirko Hono (VPS)
//
// Cara pakai (di folder proyek):
//   pm2 start ecosystem.config.cjs
//   pm2 reload sirko-hono            (setelah deploy kode baru)
//   pm2 save                         (agar bertahan reboot)
//
// .cjs karena PM2 mem-require() file ini secara CommonJS.
// Env (DATABASE_URL, JWT_*, PORT, HOST, S3_*) dimuat dari .env lewat --env-file.

module.exports = {
  apps: [
    {
      name: 'sirko-hono',
      script: 'src/server.ts',
      interpreter: '/root/.nvm/versions/node/v24.15.0/bin/node',
      node_args: '--env-file=.env --import tsx',
      instances: 1,
      exec_mode: 'fork',
      // RAM VPS terbatas (2 GB bersama app lain) — restart bila bocor.
      max_memory_restart: '300M',
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      time: true,
    },
  ],
};
