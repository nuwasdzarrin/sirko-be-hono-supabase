# Sirko Backend — Fondasi

Gerbang cloud untuk **Sirko** (POS ritel, Flutter local-first). **Hono @ Vercel + PostgreSQL**.
Fase ini = **Fondasi**: setup proyek, auth self-owned, DB & migrasi, middleware, health/cron.
Fitur 1 (Backup) & Fitur 2 (Katalog) menyusul di atas fondasi ini.

> **Portabilitas mutlak (keputusan inti klien):** hanya bergantung pada **PostgreSQL + protokol S3**.
> **Tidak ada** `@supabase/supabase-js`, Supabase Auth/GoTrue, atau Realtime. Supabase dipakai
> **hanya sebagai Postgres**. Pindah Vercel→VPS = ganti `DATABASE_URL` & `S3_*`, **kode tak berubah**.

## Stack

| Kebutuhan | Pilihan |
|---|---|
| Framework | Hono (Vercel **zero-config** backend framework, Node runtime) |
| DB | `postgres` (postgres.js), SQL-first, koneksi via **pooler** |
| Auth | `bcryptjs` (hash) + `jose` (JWT sendiri, HS256) — **self-owned** |
| Validasi | `zod` |
| Test | `vitest` (unit + contract) |
| Bahasa | TypeScript ESM |

## Prasyarat

- **Node ≥ 20.6** (butuh flag `--env-file`).
- PostgreSQL. Untuk produksi: **Supabase Pooler (Supavisor) mode transaction, port 6543** (`prepare:false`).

## Setup lokal

```bash
cd sirko-backend
npm install
cp .env.example .env          # lalu isi DATABASE_URL & secrets
```

Isi `.env` (lihat `.env.example`). **Wajib:** `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`.
Untuk dev lokal cukup Postgres biasa (boleh `:5432`); pooler `6543` khusus deploy Vercel.

### Migrasi DB (maju-saja, idempotent)

```bash
npm run migrate
```

Menjalankan `src/db/migrations/*.sql` berurutan, mencatat versi di tabel `schema_migrations`.
Aman dijalankan berulang. Portabel ke Postgres mana pun (tanpa tooling Supabase).

### Jalankan server (dev)

```bash
npm run dev        # → http://localhost:3000/v1/health
```

### Test

Ada dua lapis test:

- **Unit** (`tests/unit/`) — murni, tanpa DB/jaringan: `money`, `jwt`, `env`, `permissions`, `cursor`.
- **Integration / contract** (`tests/contract/`) — endpoint nyata via `app.request()` terhadap
  Postgres uji: `auth` (register→login→/me) & `backup` (push/pull/status). Butuh `DATABASE_URL`;
  bila DB tak tersambung, suite contract **di-skip** (bukan gagal) → unit tetap hijau di CI tanpa DB.

```bash
# Unit saja (tanpa DB) — selalu jalan
npx vitest run tests/unit

# Full (unit + integration) — butuh DATABASE_URL ke DB uji
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/sirko_test' npm test
```

`npm test` = `vitest run` (menjalankan unit + contract sekaligus).

#### Menyiapkan DB uji (Postgres lokal, sekali saja)

Contract test menulis ke DB — **jangan** arahkan ke DB produksi. Buat DB throwaway `sirko_test`:

```bash
# butuh superuser lokal (contoh: postgres/postgres @ 5432)
psql -U postgres -h localhost -c "CREATE DATABASE sirko_test;"
```

Migrasi otomatis dijalankan oleh contract test (`beforeAll`), jadi tak perlu `migrate` manual.
Untuk mereset bersih: `psql -U postgres -h localhost -c "DROP DATABASE sirko_test;"` lalu buat lagi.

#### Menjalankan subset / satu file

```bash
# satu file
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/sirko_test' npx vitest run tests/contract/backup.test.ts

# mode watch saat mengembangkan
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/sirko_test' npm run test:watch
```

#### Typecheck

```bash
npm run typecheck   # tsc --noEmit — wajib bersih sebelum commit
```

> Env test (`JWT_SECRET`, `S3_*` dummy untuk uji signed-URL, dll.) di-fallback otomatis oleh
> `tests/setup/env.setup.ts` — cukup sediakan `DATABASE_URL`. File itu juga memuat `.env` bila ada,
> jadi `DATABASE_URL` boleh ditaruh di `.env`.

## Deploy ke Vercel

> **Runbook produksi lengkap (Supabase → migrasi → env → deploy → verifikasi): [DEPLOY.md](DEPLOY.md).**

1. Root project = folder `sirko-backend/`. Vercel **auto-deteksi Hono** (zero-config):
   `src/app.ts` meng-`export default app`, dijalankan sebagai Vercel Function — **tanpa**
   `api/` manual maupun rewrite. `vercel.json` hanya berisi cron.
2. **Runtime Node** (bukan Edge, default) — wajib untuk TCP Postgres.
3. **Environment Variables** di dashboard Vercel: `DATABASE_URL` (versi **pooled 6543**,
   `?pgbouncer=true`), `JWT_SECRET`, `JWT_REFRESH_SECRET`, `S3_*`, `APP_ENV=production`.
4. **Migrasi**: jalankan `npm run migrate` dari lokal/CI dengan `DATABASE_URL` produksi
   (koneksi langsung `5432` untuk migrasi lebih andal daripada pooler; runtime tetap `6543`).
5. **Cron anti-sleep**: `vercel.json` sudah mendefinisikan cron harian `GET /v1/health`
   agar Supabase tak idle-pause (spec 08 §13).

> Catatan: build Vercel (`@vercel/node`, esbuild) menangani import ber-ekstensi `.ts`.

## Endpoint

**Fondasi**

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| POST | `/v1/auth/register-business` | — | buat business + akun owner + user owner (atomik) → token |
| POST | `/v1/auth/login` | — | `emailOrPhone` + `password` → token |
| POST | `/v1/auth/refresh` | — | rotasi refresh token → access baru |
| GET | `/v1/me` | Bearer | profil user + business + permission efektif |
| GET | `/v1/health` | — | `{status, db, serverTime}` (dipakai Vercel Cron) |

**Fitur 1 — Backup** (Bearer + konteks toko)

| Method | Path | Keterangan |
|---|---|---|
| POST | `/v1/backup/push` | batch multi-tabel → UPSERT by id (idempotent). `business_id` dari JWT (body diabaikan). Header opsional `Idempotency-Key`. Balikan `{applied, skipped, rejected, serverTime}` |
| GET | `/v1/backup/pull?cursor=&limit=` | restore: baris `server_updated_at` > cursor, keyset paginasi, termasuk tombstone. `meta.nextCursor` + `meta.hasMore` |
| GET | `/v1/backup/status` | ringkasan: `lastBackupAt`, `counts` per entitas |

Idempotency: **LWW** (mutable: master + header transaksi — update bila `updatedAt` lebih baru) & **append-only** (detail-ledger immutable: `*_items`/payments/stock_logs/wallet_transactions/credit_payments). Server **tak pernah menolak** sale yang sudah terjadi — hanya `rejected` untuk payload cacat struktur. Skema tabel di [migrations/0002](src/db/migrations/0002_tenant_backup_tables.sql); registry pemetaan di [backup-tables.ts](src/db/backup-tables.ts).

**Fitur 2 — Katalog Produk Umum (GLOBAL) + Media**

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/v1/catalog/lookup?barcode=` | Bearer (semua toko) | 1 produk atau **404** — auto-fill saat scan |
| GET | `/v1/catalog/search?q=&cursor=&limit=` | Bearer (semua toko) | cari name/brand/keywords (trigram), urut relevansi, paginasi (`limit` maks 50) |
| POST | `/v1/catalog` | **sirko_admin** | buat produk katalog → 201 |
| PUT | `/v1/catalog/:id` | **sirko_admin** | update sebagian → 200 |
| DELETE | `/v1/catalog/:id` | **sirko_admin** | soft delete → `{id, deleted:true}` |
| POST | `/v1/media/sign-upload` | Bearer | signed URL S3 (PUT langsung ke storage). scope `catalog` khusus sirko_admin |

`public_products` = tabel **GLOBAL** (tanpa `business_id`, **tanpa harga/stok**), dibaca semua toko, ditulis hanya `sirko_admin`. Pencarian pakai `pg_trgm` (GIN pada name/brand + keywords). Skema di [migrations/0003](src/db/migrations/0003_catalog.sql). Storage lewat **presigner SigV4 zero-dependency** ([lib/storage.ts](src/lib/storage.ts)) — portabel Supabase Storage ↔ MinIO/VPS via env `S3_*` + `S3_PUBLIC_BASE_URL`. Tak ada SDK Supabase.

**Dashboard admin (HTML/EJS)** — lintas-tenant, Basic Auth opsional

| Path | Keterangan |
|---|---|
| `/dashboard` | **Ringkasan**: KPI + breakdown kategori katalog + highlight katalog terbaru + tautan ke halaman detail |
| `/dashboard/catalog?page=&q=` | Katalog **berpaginasi** (24/hal) + **foto** produk + kotak **cari** (nama/brand/barcode) |
| `/dashboard/businesses?page=` | Daftar toko berpaginasi (20/hal) |
| `/dashboard/transactions?page=` | Daftar transaksi berpaginasi (20/hal) |
| `/` | redirect ke `/dashboard` |

Cikal-bakal Panel Admin Sirko. Template EJS di-embed sebagai string ([views/dashboard.view.ts](src/views/dashboard.view.ts)) → aman di serverless (tak baca file `.ejs` dari disk). Digerbang **Basic Auth** bila `DASHBOARD_USER` & `DASHBOARD_PASSWORD` diisi; kosong = terbuka (dev). Hanya-baca.

### Seed Katalog Umum

Isi `public_products` dari data **terbuka Open Food Facts / Open Beauty Facts** (produk beredar di Indonesia) — via API resmi (bukan scraping), dedupe by barcode, idempotent (`ON CONFLICT DO NOTHING`).

```bash
npm run seed:catalog         # ke DB di .env
npm run seed:catalog:prod    # ke DB di .env.production.local
# opsi: OFF_PAGES, BEAUTY_PAGES, PAGE_SIZE, BUDGET_MS
```

Strategi: banyak query **dangkal** per-brand & per-kategori (Indomie, Mayora, Wings, mie instan, biskuit, dll.) untuk menghindari blok deep-pagination + memperluas cakupan; wajib ada nama & foto; enrich net size, negara asal (prefix `899`=Indonesia), keywords. Aman diulang (menambah yang baru saja). Script: [db/seed-catalog.ts](src/db/seed-catalog.ts).

**Kategori** dipetakan ke taksonomi Bahasa Indonesia ala toko kelontong/ritel (Sembako, Mie Instan, Makanan Ringan, Minuman, Kopi & Teh, Susu & Olahan Susu, Bumbu & Bahan Masak, Perawatan Tubuh, dll. — lihat [lib/catalog-category.ts](src/lib/catalog-category.ts)) lewat classifier berbasis kata kunci. Seed sudah otomatis mengklasifikasi; untuk memetakan ulang data lama: `npm run reclassify:catalog[:prod]`.

### Ekspor bundle untuk Mobile App

Ekspor katalog jadi **produk default/starter** yang di-bundle ke app (offline, tanpa dependensi server):

```bash
npm run export:catalog:prod   # → data/public_product.json + data/assets/public_products/*.jpg
```

Menulis `data/public_product.json` (semua produk) lalu **mengunduh foto** ke `data/assets/public_products/<slug-nama>_<barcode>.jpg` (resumable). Output di `data/` (ikut di-commit ke repo — dibundel untuk mobile). Panduan format untuk mobile devs ada di [data/README.md](data/README.md). Script: [db/export-catalog-assets.ts](src/db/export-catalog-assets.ts).

> **Kuota Supabase (gratis):** Storage 1 GB, egress ~10 GB/bln. 2.400 foto ≈ 54 MB → muat di storage; namun untuk **produk default** lebih hemat & andal di-bundle ke app (nol egress, offline).

### Mirror foto ke bucket sendiri (sirko-media)

Unggah foto katalog ke bucket S3 sendiri lalu set `photo_url` DB ke URL publik bucket → **tak bergantung server pihak ketiga**:

```bash
npm run mirror:catalog:prod   # env opsional: CONCURRENCY, MIRROR_LIMIT (uji subset)
```

Sumber byte = berkas bundle `data/assets/public_products/` (fallback: unduh dari `photo_url`). Key S3 deterministik `catalog/<slug-nama>_<barcode>.<ext>` → **idempotent** (re-run menimpa objek & URL sama), update `photo_url` per-batch. Butuh `signPut()`/`publicUrl()` di [lib/storage.ts](src/lib/storage.ts). Script: [db/mirror-catalog-photos.ts](src/db/mirror-catalog-photos.ts).

> **Atribusi & lisensi:** data & foto berasal dari Open Food Facts / Open Beauty Facts di bawah **Open Database License (ODbL)**; produk individual difoto oleh kontributor komunitas. Simpan atribusi bila menampilkan foto ke publik. Baris hasil seed ditandai `source='crowdsource'`, `verified=false`.

Semua respons memakai **envelope**: sukses `{ data, meta? }`, error `{ error: { code, message, details? } }`.
Bentuk payload persis mengikuti `spec/10-api-contract.md`.

## Struktur folder

```
src/
  app.ts                init Hono + middleware global + `export default app` (entry Vercel zero-config)
  config/env.ts         validasi env (zod), fail-fast
  db/
    client.ts           postgres.js module-scope, pooled, prepare:false
    migrate.ts          runner migrasi (fungsi, tanpa efek samping)
    migrate-cli.ts      CLI `npm run migrate`
    migrations/         SQL bernomor (0001_init.sql)
    repositories/       akses data — TenantRepository MEMAKSA filter business_id
  middleware/           auth (verify JWT), rbac, tenant, error, logger
  routes/ handlers/ services/ schemas/ lib/
tests/ unit/ contract/
```

## Prinsip non-negosiasi (diterapkan)

- `business_id` **selalu** dari JWT terverifikasi, **tak pernah** dari body.
- Setiap query tenant lewat `TenantRepository` yang menyisipkan `WHERE business_id = …`.
- Uang = integer, waktu = epoch ms UTC, id = UUID.
- Pooler transaction-mode (`prepare:false`), koneksi module-scope (reuse saat warm).
- Auth self-owned (bcryptjs + jose). **Tanpa** SDK/fitur proprietary Supabase.
