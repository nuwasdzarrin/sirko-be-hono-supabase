# pendukung/

File pendukung yang **tidak dipakai aplikasi saat berjalan** (server tidak membaca folder ini).

| Folder | Isi |
|---|---|
| `kontrak-api/` | Kontrak API untuk aplikasi mobile & agen lain: AKUN-APP, PPOB-APP, API, SYNC, JURAGAN |
| `operasional/` | Runbook deploy & operasional server (DEPLOY.md) |
| `rancangan/` | Dokumen rancangan fitur (spec desain) |
| `brand/` | Sumber logo Sirko: `build-brand.py` (jalankan dari root repo) & hasil `out/` (ikon Play Store, feature graphic, ikon Android, lockup) |
| `seo/` | Rencana & laporan SEO sirkopos.com (`plan/`, `laporan/`) |

Yang tetap di root karena dipakai aplikasi/deploy: `src/`, `tests/`, `public/` (aset situs), `content/` (konten awal situs untuk `npm run seed:site`), `data/` (alur katalog umum), `scripts/update.sh` (deploy).
