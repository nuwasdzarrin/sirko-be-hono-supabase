# JURAGAN.md — Desain Paket Juragan (multi-toko)

> **Untuk:** agen/engineer backend yang mengerjakan kode backend paket Juragan.
> **Status:** desain disetujui arahnya; kode backend **belum** dikerjakan.
> **Dokumen terkait:** `SYNC.md` (kontrak sync — wajib dibaca), `API.md`.
> **Tanggal:** 2026-11-02.

Paket Juragan = paket tertinggi: **satu owner punya beberapa toko** dan bisa
**pindah-pindah toko di satu aplikasi** (HP & dashboard web).

---

## 1. Keputusan arsitektur (ringkas)

| # | Keputusan | Alasan |
|---|---|---|
| K1 | **`business_id` tetap kunci partisi sync per toko.** Satu toko = satu `business_id` = satu aliran sync. | Sudah benar sejak awal: `id` baris = UUID global (PK), `business_id` = tenant. Cursor pull, guard LWW, isolasi semuanya per toko. Tidak perlu diubah. |
| K2 | **Access token tetap untuk SATU toko.** Pindah toko = minta token baru lewat `POST /v1/auth/switch-business`. | Semua endpoint (`/backup/*`, `/me`, dashboard) sudah memakai `auth.businessId` dari token. Guard tenant tak perlu disentuh. |
| K3 | **Keanggotaan = baris `users` per (akun, toko).** Owner punya satu baris `users` di setiap tokonya, semua menunjuk `account_id` yang sama. | Perubahan skema minimal (ganti satu unique index). Refresh token tetap terikat `user_id` → otomatis per toko. |
| K4 | **Aplikasi HP: satu file SQLite per toko** (sudah disiapkan, lihat §4). | Tabel lokal tak punya `business_id`; isolasi dijamin oleh file. Tak ada query aplikasi yang perlu diubah. |
| K5 | **Fitur lintas-toko (laporan gabungan, salin produk, mutasi stok) dikerjakan di SERVER**, bukan di HP. | Server sudah memegang data semua toko; HP hanya membuka satu toko sekaligus. |

**Ditolak:** menambah `business_id` ke semua tabel lokal di HP (ratusan query
harus difilter; satu yang lupa = data bocor antar-toko).

---

## 2. Kondisi sekarang (fakta, sebelum Juragan)

- `accounts` (email/phone + password) → `users` (per toko) → `businesses`.
- **Hambatan utama:** `CREATE UNIQUE INDEX uq_users_account ON users (account_id)`
  (`src/db/migrations/0001_init.sql`) → satu akun hanya bisa punya satu baris
  `users` = satu toko.
- `login` (`src/services/auth.service.ts`) memakai
  `UserRepository.findByAccountIdForAuth` (`LIMIT 1`) → token berisi satu
  `businessId`.
- `register-business` selalu membuat **akun baru** → email yang sama tak bisa
  mendaftarkan toko kedua (409).
- `refresh`: refresh token membawa `userId` + `jti` (tabel `refresh_tokens`),
  lalu `findByIdForAuth(userId)` → businessId dari baris user itu. **Sudah
  per-toko dengan sendirinya** bila keanggotaan = baris `users` per toko (K3).
- Tidak ada konsep paket/langganan sama sekali (tak ada kolom `plan`).
- Tabel tenant: `id uuid PRIMARY KEY` + `business_id NOT NULL` + RLS jaring
  pengaman. Push LWW di-guard `WHERE t.business_id = :jwt`
  (`src/db/repositories/backup.repository.ts`).

### Sudah dikerjakan sebagai persiapan (2026-11-02)
1. **Tabrakan id lintas-toko → `rejected` dengan `code: "ID_CONFLICT"`**
   (sebelumnya dilaporkan `skipped: STALE` → aplikasi menandai baris bersih →
   data hilang diam-diam). `BackupRepository.foreignIds()` +
   `services/backup.service.ts`; test di `tests/contract/backup.test.ts`;
   didokumentasikan di `SYNC.md` §3/§8.2.
2. **Aplikasi:** daftar toko di perangkat (`sirko-flutter/lib/core/database/store_registry.dart`, sudah di `main`),
   DB dibuka per toko aktif, toko diikat ke `businessId` setelah sync sukses.
   Belum ada UI pemilih toko.

---

## 3. Spesifikasi backend yang harus dibuat

### 3.1 Migrasi `0007_juragan.sql`

```sql
-- K3: satu akun boleh punya baris users di BANYAK toko, maksimal satu per toko.
DROP INDEX IF EXISTS uq_users_account;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_account_business
  ON users (account_id, business_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_account ON users (account_id)
  WHERE account_id IS NOT NULL;

-- Paket di level AKUN (owner), bukan toko.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'basic',
  ADD COLUMN IF NOT EXISTS max_stores integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_business_id uuid;  -- toko terakhir dibuka
-- CHECK nama paket ditambahkan setelah nama final diputuskan (§7 Q1).
```

Catatan:
- Baris `sirko_admin` punya `business_id NULL`. Di unique index Postgres NULL
  dianggap berbeda, jadi index baru **tidak lagi** membatasi jumlah baris
  admin per akun (index lama membatasinya). Pakai
  `... (account_id, business_id) NULLS NOT DISTINCT` (Postgres ≥ 15) atau
  guard di kode; plus aturan: akun `sirko_admin` tidak boleh punya baris toko.
- Jalankan dulu ke DB uji lokal (`sirko_test`). Lihat §6 tentang produksi.

### 3.2 Repository

- `UserRepository.listMembershipsForAuth(accountId)` → baris `users` aktif
  (`deleted_at IS NULL AND is_active`) + nama toko, urut nama toko.
- `UserRepository.findMembershipForAuth(accountId, businessId)` → satu baris.
- `findByAccountIdForAuth` (LIMIT 1) **jangan dipakai lagi** untuk login;
  ganti dengan dua fungsi di atas.

### 3.3 Endpoint

**`POST /v1/auth/login`** (diubah, kompatibel mundur)
- Body: `{ emailOrPhone, password, businessId? }`.
- Pilih toko: `businessId` di body bila ada (harus anggota) → kalau tidak,
  `accounts.last_business_id` bila masih anggota → kalau tidak, toko pertama.
- Respons **tetap** memuat `user` (dengan `businessId`) & `business` seperti
  sekarang (aplikasi 1.2.0+15 membaca `user.businessId`), **ditambah**:
  ```json
  "businesses": [ { "id": "...", "name": "Toko A", "role": "owner" }, ... ],
  "plan": { "name": "juragan", "maxStores": 5 }
  ```
- Update `accounts.last_business_id`.

**`POST /v1/auth/switch-business`** (baru, `requireAuth`)
- Body: `{ businessId }`.
- Ambil `account_id` dari baris `users` token saat ini → cari keanggotaan
  `(account_id, businessId)`. Bukan anggota → **403** `FORBIDDEN` (jangan 404,
  jangan bocorkan keberadaan toko).
- Terbitkan pasangan token baru (access + refresh) untuk baris `users` toko
  tujuan. Token toko asal **tidak** dicabut (HP bisa menyimpan token per toko).
- Update `last_business_id`. Respons sama bentuknya dengan login.

**`GET /v1/me/businesses`** (baru, `requireAuth`)
- Daftar toko akun ini (bentuk sama dengan `businesses` di login) + `plan`.

**`POST /v1/businesses`** (baru, `requireAuth`, hanya role `owner`)
- Body: `{ name, businessType? }`.
- Cek kuota: jumlah toko di mana akun ini `owner` < `accounts.max_stores`,
  kalau penuh → **402** atau **403** dengan `code: "PLAN_LIMIT"` (pilih satu,
  dokumentasikan di API.md).
- Dalam satu transaksi: insert `businesses` (UUID baru) + baris `users`
  owner (`account_id` sama, tanpa username/PIN — sama seperti
  `register-business`).
- Respons: `{ business, tokens }` untuk toko baru (langsung bisa dipakai).

**`POST /v1/auth/register-business`** (tidak berubah)
- Email/telepon yang sudah terdaftar tetap **409**, dengan pesan yang
  mengarahkan: "Masuk lalu tambah toko".

### 3.4 Dashboard web

- Login dashboard owner (bila/ketika ada) memakai alur yang sama; pemilih toko
  di header memanggil `switch-business`.
- Laporan gabungan: lihat §3.5.

### 3.5 Fitur lintas-toko (fase berikutnya; urutan disarankan)

Semua endpoint lintas-toko **wajib** memverifikasi bahwa akun adalah `owner`
di **setiap** toko yang disentuh — jangan hanya percaya `auth.businessId`.

1. **Laporan gabungan** — `GET /v1/juragan/reports/summary?from&to`
   - Agregasi omzet, laba, jumlah transaksi, hutang, saldo kas per toko + total,
     dihitung dari tabel tenant (`transactions`, `payments`, `wallet_transactions`, …)
     dengan `business_id = ANY($ownedIds)`.
   - **Stok & saldo kas dihitung dari ledger** (`stock_logs`,
     `wallet_transactions`), bukan dari `products.stock` / `wallets.balance`
     (lihat SYNC.md §8.6).
2. **Salin produk antar-toko** — `POST /v1/juragan/copy-products`
   `{ fromBusinessId, toBusinessId, productIds[] }`
   - Server membuat **UUID baru** untuk setiap baris (produk, varian, harga
     grosir, kategori/satuan bila belum ada di toko tujuan — cocokkan per nama).
   - Stok salinan = 0 (stok tidak ikut disalin; gunakan mutasi stok).
   - Menyalin `id` apa adanya akan ditolak `ID_CONFLICT` — jangan.
   - Opsional: kolom `source_product_id` untuk sinkron harga di masa depan
     (ini perubahan kontrak wire → koordinasikan dengan aplikasi, bump
     `SUPPORTED_SCHEMA_VERSION`).
3. **Mutasi stok antar-toko** — `POST /v1/juragan/stock-transfers`
   `{ fromBusinessId, toBusinessId, lines: [{ productId, toProductId, variantId?, toVariantId?, qty }], note? }`
   - Dalam satu transaksi: insert `stock_logs` di toko asal
     (`type: 'out'`, `qty_change: -qty`) dan di toko tujuan (`type: 'in'`,
     `qty_change: +qty`), `ref_type: 'store_transfer'`, `ref_id` = id transfer
     yang sama di kedua sisi, `server_updated_at = now()`.
   - **Jangan** meng-update `products.stock` / `products.updated_at` di server.
     Aplikasi menghitung ulang stok dari ledger saat pull (SYNC.md §8.6);
     menyentuh `updated_at` produk bisa mengalahkan edit lokal yang belum
     terkirim (LWW).
   - `stock_after` diisi dari Σ ledger saat itu (hanya untuk audit).

---

## 4. Kontrak dengan aplikasi HP

Yang **sudah ada** di aplikasi (build berikutnya setelah 1.2.0+15):
- `StoreRegistry` disimpan di SharedPreferences (`store_registry_v1`):
  `{ activeKey, stores: [{ key, dbName, businessId?, name? }] }`.
  Toko pertama memakai file lama `sirko` (tanpa migrasi data).
- `appDatabaseProvider` membuka file toko aktif; mengganti toko aktif menutup
  DB lama dan membangun ulang semua provider (termasuk engine sync).
- Setelah sync sukses, toko aktif diikat ke `businessId` cloud.

Yang **akan** dikerjakan aplikasi setelah backend siap:
1. Login → simpan `businesses[]`; pemilih toko di tab Lainnya.
2. Pindah toko: (a) push antrean toko aktif sampai bersih bila online,
   (b) `switch-business`, (c) simpan token **per businessId** di secure
   storage (sekarang satu set: `cloud_access_token`, …), (d) aktifkan / buat
   file DB toko tujuan, (e) pull penuh bila file baru.
3. Tambah toko → `POST /v1/businesses` → file DB baru → onboarding singkat.
4. Toko yang dibuat offline (belum punya `businessId`) diikat saat pertama
   kali dihubungkan ke cloud.

Kompatibilitas mundur yang **wajib dijaga** backend:
- Respons login/register tetap memuat `user.businessId` dan `business`.
- Aplikasi lama (≤ 1.2.0+15) hanya mengenal satu toko: login akun Juragan dari
  aplikasi lama akan masuk ke `last_business_id`. Itu dapat diterima.

---

## 5. Invarian yang TIDAK boleh dilanggar

1. `businessId` **selalu** dari token terverifikasi, tak pernah dari body
   (kecuali `switch-business`/endpoint juragan yang memverifikasi keanggotaan).
2. `id` baris = UUID global. Server tak pernah menimpa baris milik toko lain;
   tabrakan → `rejected: ID_CONFLICT`.
3. Cursor pull & idempotency (`backup_idempotency`) tetap per `business_id`.
4. Tabel append (`stock_logs`, `payments`, `wallet_transactions`, …) immutable.
5. Stok & saldo kas = Σ ledger. Endpoint server yang mengubah stok/kas **hanya
   menambah baris ledger**.
6. Baris `users` owner hasil `register-business` / `POST /v1/businesses` tidak
   punya username/PIN — aplikasi mengabaikannya saat pull (SYNC.md §8.3).

---

## 6. Test & keamanan kerja

**Contract test minimal** (`tests/contract/juragan.test.ts`):
- Akun dengan 2 toko: login tanpa `businessId` → `last_business_id`;
  `businesses` berisi 2.
- `switch-business` ke toko sendiri → token baru; push/pull memakai data toko
  tujuan saja (isolasi).
- `switch-business` ke toko orang lain → 403.
- Refresh token toko A setelah switch ke B tetap menghasilkan token toko A.
- `POST /v1/businesses` melebihi `max_stores` → `PLAN_LIMIT`; di bawah kuota
  → toko + owner tercipta, token langsung bisa push.
- Laporan gabungan hanya mencakup toko yang akun itu `owner`.
- Mutasi stok: Σ `stock_logs` toko asal turun & tujuan naik sebesar qty;
  `products.updated_at` tidak berubah.
- Regresi: semua test `backup.test.ts` & `auth.test.ts` tetap lulus.

**Keamanan kerja (PENTING — diperbarui 2026-11-05):**
- **Produksi** = VPS Kreatora: `https://sirko.produkdesa.com` → Cloudflare
  Tunnel → `/home/sirko-hono` (pm2 `sirko-hono`, port 47321, Postgres lokal
  server). Lihat `DEPLOY.md` di `main`.
- **Deploy** = push ke `main`, lalu di server jalankan `bash scripts/update.sh`
  (backup DB → `git pull --ff-only` → `npm ci` bila perlu → **migrasi** →
  reload pm2 → health check, plus perintah rollback bila gagal). Jadi migrasi
  `0007_juragan.sql` ikut jalan otomatis saat deploy → pastikan test lulus,
  idempoten (`IF NOT EXISTS`), dan **minta persetujuan pemilik produk** sebelum
  menjalankan `update.sh`. Jangan edit/commit di server (server = mirror).
- **Lokal:** kerja di `c:\project\sirko\sirko-hono` (worktree). `.env` di sana
  menunjuk DB dev lokal `sirko_dev` (port 47321); `npm test` selalu ke
  `sirko_test` lokal (`tests/setup/env.setup.ts`, menolak host Supabase).
  `.env` di worktree lama `KasirWarung\sirko-backend` masih menunjuk Supabase
  produksi LAMA — jangan dipakai.
- **Server lama** `sirko.vercel.app` + Supabase masih hidup (dipakai APK
  ≤ 1.2.0+15). Jangan jadikan acuan; aplikasi berikutnya memakai
  `sirko.produkdesa.com` (`CloudConfig.baseUrl`).
- Worktree dipakai bergantian dengan sesi lain: stage file secara eksplisit,
  jangan pindah branch di worktree orang lain.

---

## 7. Keputusan terbuka (untuk pemilik produk)

| # | Pertanyaan | Default sementara |
|---|---|---|
| Q1 | Nama & isi paket (mis. Basic / Pro / Juragan) dan batas toko per paket | `basic` = 1 toko; `juragan` = 5 toko |
| Q2 | Pembayaran/aktivasi paket (manual admin vs payment gateway) | Manual: admin mengubah `accounts.plan` / `max_stores` lewat dashboard |
| Q3 | Turun paket saat punya >1 toko | Toko tetap ada & bisa dibaca; tambah toko diblok; (opsional) push ke toko di luar kuota ditolak |
| Q4 | Karyawan (kasir) boleh di beberapa toko? | Tidak — kasir PIN per toko (sudah begitu). Akun cloud karyawan lintas-toko menyusul |
| Q5 | Pelanggan/supplier dibagi antar-toko? | Tidak — per toko. Laporan gabungan cukup |
| Q6 | Nomor invoice diberi kode toko? | Ya untuk laporan gabungan (mis. `INV-A-20261102-0001`) — perubahan di aplikasi |
| Q7 | Saldo **Poin Sirko** (PPOB, rencana terpisah) per toko atau per akun owner? Rencana PPOB saat ini: kunci `business_id`, tanpa transfer antar-toko → owner 5 toko = 5 saldo poin terpisah | Putuskan sebelum tabel poin dibuat. Bila per akun: kunci `account_id` + catat toko pemakai di setiap order PPOB |
