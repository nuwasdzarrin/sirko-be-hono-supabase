# JURAGAN.md — Desain Paket Juragan (langganan premium)

> **Untuk:** agen/engineer backend yang mengerjakan kode backend paket Juragan
> (bagian aplikasi HP dicatat di §4 sebagai kontrak).
> **Status:** semua keputusan produk final (§7); kode backend **belum** dikerjakan.
> **Dokumen terkait:** `SYNC.md` (kontrak sync — wajib dibaca), `API.md`,
> `docs/superpowers/specs/2026-11-02-ppob-poin-design.md` (PPOB + Poin — pola
> top-up QRIS & konfirmasi admin dipakai ulang di sini).
> **Diperbarui:** 2026-11-05 (dari PRD pemilik produk).

---

## 0. Konteks produk (ringkasan PRD)

Sirko = POS untuk warung mikro (kelontong, warung Madura, sembako, toko desa).
Prinsip: **offline-first, mobile-only, tanpa biaya di depan**.

| Paket | Harga | Isi |
|---|---|---|
| **Warung** | Gratis selamanya | Kasir, stok, katalog barcode bawaan, peringatan stok tipis, kasbon. **Satu toko, hanya owner.** |
| **Juragan** | **Rp49.000/bulan** atau **Rp499.000/tahun** | Semua isi Warung + bundle di bawah (tidak dijual terpisah) |

Isi bundle Juragan:
1. **Multi-cabang** — maksimal **3 toko** per akun (termasuk toko utama), dipantau owner dari satu aplikasi.
2. **Multi-karyawan** — akun penjaga warung (login PIN) yang **tidak bisa melihat laba & harga modal**.
3. **Laporan lanjut** — ekspor laporan penjualan & laba rugi ke Excel/PDF.
4. **Branding struk** — nama warung **dan logo** di struk digital/cetak.

Aturan pemilik produk:
- Paket Warung **tidak boleh** memakai keempat fitur itu — aksesnya **diblok dan
  diarahkan ke layar berlangganan** (termasuk karyawan yang sudah terlanjur
  dibuat dan ekspor yang sekarang masih gratis).
- **Pencatatan oleh owner tidak pernah diblok** (kasir, stok, kasbon, sync) —
  apa pun status langganannya.
- **Poin Sirko terpisah**: hanya untuk PPOB, tidak untuk membayar langganan.
- Pembayaran langganan = **QRIS statis + konfirmasi admin**, bulanan atau tahunan.

---

## 1. Keputusan arsitektur (ringkas)

| # | Keputusan | Alasan |
|---|---|---|
| K1 | **`business_id` tetap kunci partisi sync per toko.** Satu toko = satu `business_id` = satu aliran sync. | Sudah benar sejak awal: `id` baris = UUID global (PK), `business_id` = tenant. Cursor pull, guard LWW, isolasi semuanya per toko. Tidak perlu diubah. |
| K2 | **Access token tetap untuk SATU toko.** Pindah toko = minta token baru lewat `POST /v1/auth/switch-business`. | Semua endpoint (`/backup/*`, `/me`, dashboard) sudah memakai `auth.businessId` dari token. Guard tenant tak perlu disentuh. |
| K3 | **Keanggotaan = baris `users` per (akun, toko).** Owner punya satu baris `users` di setiap tokonya, semua menunjuk `account_id` yang sama. | Perubahan skema minimal (ganti satu unique index). Refresh token tetap terikat `user_id` → otomatis per toko. |
| K4 | **Aplikasi HP: satu file SQLite per toko** (sudah ada, lihat §4). | Tabel lokal tak punya `business_id`; isolasi dijamin oleh file. |
| K5 | **Fitur lintas-toko (laporan gabungan, salin produk, mutasi stok) dikerjakan di SERVER.** | Server memegang data semua toko; HP hanya membuka satu toko sekaligus. |
| K6 | **Langganan melekat ke AKUN owner**, bukan ke toko. Satu langganan Juragan berlaku untuk semua toko milik akun itu. | Owner yang membayar; cabang ikut aktif. |
| K7 | **Hak akses (entitlement) dihitung server, di-cache aplikasi untuk offline.** Server = sumber kebenaran; aplikasi menyimpan `plan` + `expiresAt` + `serverTime` terakhir dan memutuskan sendiri saat offline. | Offline-first: kasir & gating harus jalan tanpa internet. Fitur yang menyentuh server (tambah toko, lintas-toko) tetap dicek server. |

**Ditolak:** menambah `business_id` ke semua tabel lokal di HP (ratusan query
harus difilter; satu yang lupa = data bocor antar-toko).

---

## 2. Kondisi sekarang (fakta, sebelum Juragan)

Backend:
- `accounts` (email/phone + password) → `users` (per toko) → `businesses`.
- **Hambatan utama:** `CREATE UNIQUE INDEX uq_users_account ON users (account_id)`
  (`src/db/migrations/0001_init.sql`) → satu akun hanya bisa punya satu baris
  `users` = satu toko.
- `login` (`src/services/auth.service.ts`) memakai
  `UserRepository.findByAccountIdForAuth` (`LIMIT 1`) → token berisi satu `businessId`.
- `register-business` selalu membuat **akun baru** → email yang sama tak bisa
  mendaftarkan toko kedua (409).
- `refresh`: refresh token membawa `userId` + `jti`, lalu `findByIdForAuth(userId)`
  → **sudah per-toko dengan sendirinya** bila keanggotaan = baris `users` per toko (K3).
- **Tidak ada konsep paket/langganan** (tak ada kolom `plan`, tak ada pembayaran).
- Tabel tenant: `id uuid PRIMARY KEY` + `business_id NOT NULL` + RLS jaring
  pengaman. Push LWW di-guard `WHERE t.business_id = :jwt`.

Aplikasi (`sirko-flutter`, per 2026-11-05) — keempat fitur bundle **sudah ada
sebagian dan saat ini gratis**:
| Fitur | Kondisi di app | Selisih dengan PRD |
|---|---|---|
| Multi-cabang | Pondasi: daftar toko + satu file DB per toko (`lib/core/database/store_registry.dart`) | Belum ada UI pemilih/tambah toko; menunggu endpoint §3.3 |
| Multi-karyawan | Ada (Fase 6): user PIN lokal, role owner/admin/cashier/staff/custom, `PermissionResolver` | **Kasir bisa melihat laba** (dashboard `DashboardView` di bawah `dashboardAccess`); **staf melihat harga modal** (form produk). Belum ada izin "lihat laba & modal". Belum dikunci per paket. |
| Laporan lanjut | Ada: ekspor XLSX/PDF (`report_export_service.dart`, izin `transactionExport`) | Belum dikunci per paket |
| Branding struk | Nama/alamat/telepon toko + footer sudah di struk (`receipt_pdf.dart`) | **Logo belum dicetak** (kolom `businesses.logo_path` ada tapi tak dipakai) |

### Sudah dikerjakan sebagai persiapan
1. **Tabrakan id lintas-toko → `rejected` dengan `code: "ID_CONFLICT"`**
   (`BackupRepository.foreignIds()`, `services/backup.service.ts`, test di
   `tests/contract/backup.test.ts`, `SYNC.md` §3/§8.2). Sudah di produksi.
2. **Aplikasi:** daftar toko di perangkat, DB dibuka per toko aktif, toko
   diikat ke `businessId` setelah sync sukses (di `main` sirko-flutter).
   Default backend aplikasi = `https://sirko.produkdesa.com`.

---

## 3. Spesifikasi backend yang harus dibuat

### 3.0 Hak akses per paket (tabel acuan)

| Fitur (kode `feature`) | Warung | Juragan | Ditegakkan di |
|---|---|---|---|
| Pencatatan (kasir, stok, kasbon, sync) oleh owner | ✓ | ✓ | — (tak pernah diblok) |
| `multi_store` — tambah toko, pindah toko, laporan gabungan, salin produk, mutasi stok | ✗ (1 toko) | ✓ maks `maxStores` = 3 | **Server** (§3.3, §3.5) + app |
| `staff` — login & tambah karyawan (user PIN non-owner) | ✗ | ✓ | App (user PIN lokal) |
| `advanced_reports` — ekspor Excel/PDF | ✗ | ✓ | App (ekspor dibuat di HP); server untuk laporan gabungan |
| `receipt_branding` — logo di struk | ✗ | ✓ | App |
| PPOB (Poin) | ✓ | ✓ | Server (terpisah, lihat dok PPOB) |

Kode `feature` di atas = string yang dikirim server di `plan.features` (§3.3)
supaya aplikasi tak perlu di-update bila isi paket berubah.

### 3.1 Migrasi `00NN_juragan.sql`

> **Penomoran:** rancangan PPOB sudah memakai `0007_ppob_points.sql`. Pakai
> nomor berikutnya yang kosong saat dibangun (mis. `0008_juragan.sql`) — jangan
> bentrok.

```sql
-- K3: satu akun boleh punya baris users di BANYAK toko, maksimal satu per toko.
DROP INDEX IF EXISTS uq_users_account;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_account_business
  ON users (account_id, business_id) NULLS NOT DISTINCT
  WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_account ON users (account_id)
  WHERE account_id IS NOT NULL;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS last_business_id uuid;   -- toko terakhir dibuka

-- K6: langganan per akun. Satu baris per periode yang dibayar (riwayat utuh).
CREATE TABLE IF NOT EXISTS subscriptions (
  id          uuid PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  plan        text NOT NULL CHECK (plan IN ('juragan')),
  period      text NOT NULL CHECK (period IN ('monthly', 'yearly')),
  starts_at   bigint NOT NULL,
  ends_at     bigint NOT NULL CHECK (ends_at > starts_at),
  payment_id  uuid UNIQUE,                     -- → subscription_payments
  created_at  bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_account
  ON subscriptions (account_id, ends_at DESC);

-- Pembayaran QRIS statis + konfirmasi admin (pola sama dengan point_topups).
CREATE TABLE IF NOT EXISTS subscription_payments (
  id            uuid PRIMARY KEY,
  account_id    uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  business_id   uuid REFERENCES businesses (id),   -- toko asal permintaan (info)
  plan          text NOT NULL CHECK (plan IN ('juragan')),
  period        text NOT NULL CHECK (period IN ('monthly', 'yearly')),
  base_amount   bigint NOT NULL CHECK (base_amount > 0),
  unique_code   integer NOT NULL CHECK (unique_code BETWEEN 1 AND 999),
  amount        bigint NOT NULL,                    -- base_amount + unique_code
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired')),
  proof_path    text,                               -- opsional: foto bukti transfer
  reviewed_by   text,
  reviewed_at   bigint,
  note          text,
  expires_at    bigint NOT NULL,                    -- permintaan kedaluwarsa (mis. 24 jam)
  created_at    bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sub_payments_status
  ON subscription_payments (status, created_at);
-- Kode unik tak boleh dipakai dua permintaan pending dengan nominal sama.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_payments_pending_amount
  ON subscription_payments (amount) WHERE status = 'pending';

-- Harga & batas = konfigurasi (bisa diubah admin tanpa deploy).
CREATE TABLE IF NOT EXISTS plan_prices (
  plan        text NOT NULL,
  period      text NOT NULL,
  amount      bigint NOT NULL CHECK (amount > 0),
  max_stores  integer NOT NULL,
  updated_at  bigint NOT NULL,
  PRIMARY KEY (plan, period)
);
-- Seed: ('juragan','monthly',49000,3), ('juragan','yearly',499000,3).
```

Catatan:
- `NULLS NOT DISTINCT` (Postgres ≥ 15) menjaga baris `sirko_admin`
  (`business_id NULL`) tetap satu per akun seperti index lama. Cek versi
  Postgres produksi; bila < 15 pakai guard di kode. Aturan: akun `sirko_admin`
  tidak boleh punya baris toko.
- Paket efektif akun = `juragan` bila ada `subscriptions` dengan
  `starts_at <= now < ends_at`, selain itu `warung`. **Jangan** simpan status
  paket sebagai kolom yang bisa basi.
- Perpanjangan: `starts_at = max(now, ends_at langganan aktif terakhir)` →
  membayar sebelum habis tidak menghanguskan sisa hari.

### 3.2 Repository / service

- `UserRepository.listMembershipsForAuth(accountId)` → baris `users` aktif
  (`deleted_at IS NULL AND is_active`) + nama toko, urut nama toko.
- `UserRepository.findMembershipForAuth(accountId, businessId)` → satu baris.
- `findByAccountIdForAuth` (LIMIT 1) **jangan dipakai lagi** untuk login.
- `PlanService.effective(accountId, now)` →
  `{ plan, period, expiresAt, maxStores, features[] }` (warung: `maxStores 1`,
  `features []`). Dipakai login, `/me`, dan semua guard fitur.

### 3.3 Endpoint

Bentuk objek `plan` (dipakai di banyak respons):
```json
"plan": {
  "name": "juragan",            // "warung" | "juragan"
  "period": "monthly",          // null untuk warung
  "expiresAt": 1796000000000,   // epoch ms; null untuk warung
  "maxStores": 3,
  "features": ["multi_store", "staff", "advanced_reports", "receipt_branding"],
  "serverTime": 1793900000000   // untuk aplikasi: jangkar jam saat offline (K7)
}
```

**`POST /v1/auth/login`** (diubah, kompatibel mundur)
- Body: `{ emailOrPhone, password, businessId? }`.
- Pilih toko: `businessId` di body bila anggota → `accounts.last_business_id`
  bila masih anggota → toko pertama.
- Respons **tetap** memuat `user` (dengan `businessId`) & `business` seperti
  sekarang (aplikasi ≤ 1.2.0+15 membaca `user.businessId`), **ditambah**
  `businesses: [{ id, name, role }]` dan `plan`.
- Update `accounts.last_business_id`.

**`POST /v1/auth/switch-business`** (baru, `requireAuth`)
- Body: `{ businessId }`. Cari keanggotaan `(account_id, businessId)`; bukan
  anggota → **403** `FORBIDDEN` (jangan bocorkan keberadaan toko).
- Paket `warung` dan toko tujuan ≠ toko pertama/utama akun → **403**
  `PLAN_REQUIRED` (lihat §7 J7 tentang toko saat langganan habis).
- Terbitkan token baru (access + refresh) untuk baris `users` toko tujuan;
  token toko asal tidak dicabut. Update `last_business_id`. Respons = login.

**`GET /v1/me`** (diubah) — tambah `plan`.
**`GET /v1/me/businesses`** (baru) — `{ businesses, plan }`.

**`POST /v1/businesses`** (baru, `requireAuth`, hanya role `owner`)
- Body: `{ name, businessType? }`.
- Butuh fitur `multi_store` **dan** jumlah toko milik akun < `maxStores` →
  selain itu **403** dengan `code: "PLAN_REQUIRED"` atau `"PLAN_LIMIT"`.
- Satu transaksi: insert `businesses` + baris `users` owner (`account_id`
  sama, tanpa username/PIN). Respons: `{ business, tokens, plan }`.

**`POST /v1/auth/register-business`** (tidak berubah) — email/telepon terdaftar
tetap 409, pesan: "Masuk lalu tambah toko (Paket Juragan)".

**Langganan (baru, `requireAuth`, hanya owner):**
- `GET /v1/plans` → harga aktif dari `plan_prices`
  (`[{ plan, period, amount, maxStores }]`) + gambar/URL **QRIS statis** dan
  instruksi bayar.
- `POST /v1/plan/checkout` `{ period: "monthly" | "yearly" }` → buat
  `subscription_payments` pending dengan `unique_code` acak (1–999) yang belum
  dipakai untuk nominal itu; respons `{ id, amount, uniqueCode, expiresAt,
  qrisUrl }`. Satu akun maksimal satu pending — permintaan baru membatalkan
  yang lama (`expired`). Kirim notifikasi admin (pakai notifier Telegram PPOB).
- `POST /v1/plan/checkout/:id/proof` (opsional) → unggah bukti (media S3 yang
  sudah ada), isi `proof_path`.
- `GET /v1/plan/checkout/:id` → status (`pending|confirmed|rejected|expired`)
  + `plan` terbaru bila `confirmed` (aplikasi mem-poll setelah bayar).

**Dashboard admin:**
- Antrian pembayaran pending (nominal, kode unik, akun, toko, bukti) →
  **Konfirmasi** (satu transaksi: status `confirmed` + insert `subscriptions`
  sesuai aturan perpanjangan §3.1) atau **Tolak** (wajib catatan).
- Halaman akun: riwayat langganan, perpanjang/potong manual (tercatat siapa).
- Ubah `plan_prices`.

### 3.4 Dashboard web owner

- Login owner memakai alur yang sama; pemilih toko di header memanggil
  `switch-business`. Laporan gabungan: §3.5.

### 3.5 Fitur lintas-toko (butuh `multi_store`)

Semua endpoint lintas-toko **wajib** memverifikasi (1) paket aktif punya
`multi_store` dan (2) akun adalah `owner` di **setiap** toko yang disentuh —
jangan hanya percaya `auth.businessId`.

1. **Laporan gabungan** — `GET /v1/juragan/reports/summary?from&to`
   - Omzet, laba, jumlah transaksi, kasbon, saldo kas per toko + total dari
     tabel tenant dengan `business_id = ANY($ownedIds)`.
   - **Stok & saldo kas dihitung dari ledger** (`stock_logs`,
     `wallet_transactions`), bukan `products.stock` / `wallets.balance`
     (SYNC.md §8.6).
2. **Salin produk antar-toko** — `POST /v1/juragan/copy-products`
   `{ fromBusinessId, toBusinessId, productIds[] }`
   - **UUID baru** untuk setiap baris (produk, varian, harga grosir,
     kategori/satuan bila belum ada di toko tujuan — cocokkan per nama).
   - Stok salinan = 0 (pakai mutasi stok). Menyalin `id` apa adanya →
     `ID_CONFLICT`.
   - Opsional `source_product_id` (perubahan kontrak wire → koordinasi app,
     bump `SUPPORTED_SCHEMA_VERSION`).
3. **Mutasi stok antar-toko** — `POST /v1/juragan/stock-transfers`
   `{ fromBusinessId, toBusinessId, lines: [{ productId, toProductId, variantId?, toVariantId?, qty }], note? }`
   - Satu transaksi: `stock_logs` toko asal (`type 'out'`, `-qty`) dan toko
     tujuan (`type 'in'`, `+qty`), `ref_type 'store_transfer'`, `ref_id` sama.
   - **Jangan** update `products.stock` / `products.updated_at` di server
     (aplikasi menghitung ulang dari ledger; menyentuh `updated_at` bisa
     mengalahkan edit lokal yang belum terkirim).

---

## 4. Kontrak dengan aplikasi HP

**Sudah ada** (`main` sirko-flutter, setelah 1.2.0+15):
- `StoreRegistry` (SharedPreferences `store_registry_v1`):
  `{ activeKey, stores: [{ key, dbName, businessId?, name? }] }`; toko pertama =
  file lama `sirko`.
- `appDatabaseProvider` membuka file toko aktif; ganti toko aktif → DB lama
  ditutup, semua provider dibangun ulang (termasuk engine sync).
- Toko aktif diikat ke `businessId` setelah sync sukses.

**Akan dikerjakan aplikasi** setelah endpoint siap:
1. **Cache hak akses (K7):** simpan `plan` dari login/`/me`/sync terakhir di
   secure storage. Saat offline, paket dianggap aktif bila
   `expiresAt > max(jam HP, serverTime terakhir)` (+ masa tenggang, §7 J8).
   Diperbarui setiap sync sukses.
2. **Gating + layar "Berlangganan Juragan":** setiap fitur §3.0 yang terkunci
   menampilkan layar yang sama: manfaat paket, harga bulanan/tahunan, tombol
   bayar → `checkout` → tampilkan QRIS statis + nominal persis (dengan kode
   unik) → poll status → aktif.
   - `staff`: login PIN user non-owner **ditolak** dengan arahan berlangganan;
     menu tambah karyawan terkunci. Owner tetap bisa login & mencatat.
   - `advanced_reports`: tombol ekspor Excel/PDF terkunci.
   - `receipt_branding`: logo toko dicetak di struk (fitur baru) hanya bila aktif.
   - `multi_store`: pemilih toko & tambah toko terkunci.
3. **Izin baru "Lihat laba & harga modal"** (`viewCostProfit`), default hanya
   owner/admin: sembunyikan laba di dashboard/laporan dan harga modal di form
   produk/varian/pembelian untuk kasir & staf.
4. **Multi-cabang:** login → simpan `businesses[]`; pemilih toko di tab Lainnya.
   Pindah toko: (a) push antrean toko aktif sampai bersih bila online,
   (b) `switch-business`, (c) token **per businessId** di secure storage
   (sekarang satu set `cloud_*`), (d) aktifkan / buat file DB toko tujuan,
   (e) pull penuh bila file baru. Tambah toko → `POST /v1/businesses`.

Kompatibilitas mundur yang **wajib dijaga** backend:
- Respons login/register tetap memuat `user.businessId` dan `business`.
- Aplikasi lama (≤ 1.2.0+15) tidak mengenal `plan`: tetap bisa login & sync
  ke `last_business_id`.

---

## 5. Invarian yang TIDAK boleh dilanggar

1. `businessId` **selalu** dari token terverifikasi, tak pernah dari body
   (kecuali endpoint yang memverifikasi keanggotaan: `switch-business`, juragan).
2. `id` baris = UUID global. Server tak pernah menimpa baris toko lain;
   tabrakan → `rejected: ID_CONFLICT`.
3. Cursor pull & idempotency tetap per `business_id`.
4. Tabel append (`stock_logs`, `payments`, `wallet_transactions`, …) immutable.
5. Stok & saldo kas = Σ ledger; endpoint server yang mengubah stok/kas **hanya
   menambah baris ledger**.
6. Baris `users` owner hasil `register-business` / `POST /v1/businesses` tanpa
   username/PIN — aplikasi mengabaikannya saat pull (SYNC.md §8.3).
7. **Status langganan tidak pernah memblok push/pull sync** maupun pencatatan
   owner. Data tidak pernah dihapus karena langganan habis.
8. Poin Sirko (PPOB) dan langganan **tidak saling terhubung**: tak ada
   pemotongan Poin untuk langganan.

---

## 6. Test & keamanan kerja

**Contract test minimal** (`tests/contract/juragan.test.ts`):
- Akun 2 toko: login tanpa `businessId` → `last_business_id`; `businesses` = 2;
  `plan.name` sesuai langganan.
- `switch-business` ke toko sendiri (juragan aktif) → token baru; push/pull
  hanya data toko tujuan. Ke toko orang lain → 403 `FORBIDDEN`. Akun `warung`
  ke toko kedua → 403 `PLAN_REQUIRED`.
- Refresh token toko A setelah switch ke B tetap menghasilkan token toko A.
- `POST /v1/businesses`: warung → `PLAN_REQUIRED`; juragan toko ke-4 →
  `PLAN_LIMIT`; juragan toko ke-2/3 → tercipta, token langsung bisa push.
- Checkout → pending dengan `amount = harga + kode unik`; dua pending aktif
  tak pernah bernominal sama; konfirmasi admin → `subscriptions` tercipta,
  `plan` jadi juragan; perpanjang sebelum habis menyambung dari `ends_at`;
  tolak → paket tetap.
- Langganan habis: sync push/pull toko mana pun **tetap jalan**; endpoint
  lintas-toko & tambah toko ditolak.
- Laporan gabungan hanya toko yang akun itu `owner`; mutasi stok: Σ ledger
  asal turun & tujuan naik, `products.updated_at` tidak berubah.
- Regresi: semua test `backup.test.ts` & `auth.test.ts` tetap lulus.

**Keamanan kerja (PENTING):**
- **Produksi** = VPS Kreatora: `https://sirko.produkdesa.com` → Cloudflare
  Tunnel → `/home/sirko-hono` (pm2 `sirko-hono`, port 47321, Postgres lokal
  server). Lihat `DEPLOY.md` di `main`.
- **Deploy** = push ke `main`, lalu di server `bash scripts/update.sh`
  (backup DB → `git pull --ff-only` → `npm ci` bila perlu → **migrasi** →
  reload pm2 → health check + perintah rollback). Migrasi Juragan ikut jalan
  otomatis → test harus lulus, migrasi idempoten (`IF NOT EXISTS`), dan
  **minta persetujuan pemilik produk** sebelum `update.sh`. Jangan edit/commit
  di server (server = mirror).
- **Lokal:** kerja di `c:\project\sirko\sirko-hono` (worktree). `.env` di sana
  menunjuk DB dev lokal `sirko_dev` (port 47321); `npm test` selalu ke
  `sirko_test` lokal (`tests/setup/env.setup.ts`, menolak host Supabase).
  `.env` di worktree lama `KasirWarung\sirko-backend` masih menunjuk Supabase
  produksi LAMA — jangan dipakai.
- **Server lama** `sirko.vercel.app` + Supabase masih hidup (dipakai APK
  ≤ 1.2.0+15). Jangan jadikan acuan.
- Worktree dipakai bergantian dengan sesi lain: stage file secara eksplisit,
  jangan pindah branch di worktree orang lain.

---

## 7. Keputusan

**Semua sudah diputuskan pemilik produk (2026-11-05):**

| # | Keputusan |
|---|---|
| J1 | Dua paket: **Warung** (gratis selamanya) dan **Juragan** (premium, bundle 4 fitur, tidak dijual terpisah). |
| J2 | Harga Juragan **Rp49.000/bulan**; tersedia juga **tahunan**. Harga disimpan di `plan_prices`, bukan di kode. |
| J3 | Juragan maksimal **3 toko** per akun (termasuk toko utama). |
| J4 | Bayar via **QRIS statis + konfirmasi admin** (bukan Poin, bukan payment gateway). |
| J5 | **Poin Sirko hanya untuk PPOB**, per toko, tidak bisa dipindah antar-toko (aturan dok PPOB tetap). |
| J6 | Paket Warung: keempat fitur bundle **dikunci semua** — termasuk karyawan yang sudah ada dan ekspor yang dulu gratis — dan diarahkan ke layar berlangganan. Pencatatan owner tidak diblok. |
| J10 | Karyawan per toko (PIN lokal), tidak lintas toko. |
| J7 | Langganan habis saat punya >1 toko: semua toko tetap bisa mencatat & sync **di HP yang sudah login ke toko itu**; fitur bundle terkunci (termasuk pindah toko dari satu HP, tambah toko, laporan gabungan). Data tak pernah dihapus; aktif lagi begitu diperpanjang. |
| J8 | Masa tenggang offline: 3 hari setelah `expiresAt` bila HP belum bisa cek ke server. |
| J9 | Harga tahunan **Rp499.000/tahun**. |
| J11 | Pelanggan/supplier per toko (tidak dibagi); laporan gabungan cukup. |
| J12 | Kode toko di nomor invoice (mis. `INV-A-20261105-0001`) — perubahan di aplikasi. |
| J13 | Pengguna yang sudah memakai karyawan/ekspor diberi pemberitahuan sekali di aplikasi sebelum penguncian berlaku (bukan diam-diam). |
