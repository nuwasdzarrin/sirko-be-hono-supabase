# Sirko — Alur Sinkronisasi (untuk Mobile Dev)

App = **local-first** (Drift/SQLite). Cloud = cadangan & sinkronisasi antar-device,
**per toko**. Mesin sync = endpoint **Backup** (sudah live). Auth per-toko = JWT.

- Base URL: `https://sirko.vercel.app` · semua di `/v1`. (URL lama `sirko-be-hono-supabase.vercel.app` tidak dipakai lagi oleh app.)
- Header: `Authorization: Bearer <accessToken>`.
- Uang integer rupiah · waktu **epoch ms UTC** · id **UUID (digenerate device)**.
- Server SELALU ambil `businessId` dari JWT; `business_id` di body **diabaikan**.

---

## 0. Prasyarat kolom lokal (tiap tabel tenant)
Tiap baris punya: `id`(uuid), `updatedAt`(epoch ms, jam device), `deletedAt`(epoch ms|null),
dan flag lokal **`isDirty`**(bool) untuk menandai baris yang belum ter-push.
- Setiap create/update/delete lokal → set `updatedAt = now`, `isDirty = true`.
- Delete = **soft delete** (`deletedAt = now`), jangan hapus fisik (agar tombstone tersinkron).

Simpan juga di `app_settings` lokal: `sync_cursor` (string opaque), `last_push_at`, token & `businessId`.

---

## 1. Autentikasi (per toko)
```
POST /v1/auth/register           { name, email, phone, password }  → OTP email → verify-email → POST /v1/businesses
POST /v1/auth/login               { login, password }   (detail alur akun: AKUN-APP.md)
→ { data:{ accessToken, refreshToken, expiresIn, user:{id,role,businessId}, business } }
```
- Toko baru → `register` + `verify-email` + `POST /v1/businesses`. Device lain / re-install → `login` (akun sama → `businessId` sama → PULL memulihkan data).
- Simpan `accessToken`(umur `expiresIn` detik), `refreshToken`, `businessId`.
- Saat request balas **401** → `POST /v1/auth/refresh { refreshToken }` → token baru; ulangi request. Bila refresh gagal → minta login ulang.

---

## 2. PUSH — unggah perubahan lokal (device → cloud)
Kirim baris ber-`isDirty=true`. Boleh dibatch (disarankan **≤ 500 baris/tabel** per request).

```
POST /v1/backup/push
{
  "clientInfo": { "deviceId": "<uuid>", "appVersion": "1.0.0", "schemaVersion": 10 },
  "tables": {
    "products":          [ { id, name, barcode, sellingPrice, costPrice, stock, updatedAt, deletedAt } , ... ],
    "transactions":      [ { id, invoiceNo, datetime, grandTotal, status, updatedAt, deletedAt }, ... ],
    "transaction_items": [ { id, transactionId, productId, qty, unitPrice, lineTotal, updatedAt, deletedAt }, ... ],
    "payments":          [ { id, transactionId, method, amount, updatedAt, deletedAt }, ... ]
    // ...tabel lain sesuai kebutuhan
  }
}
```
Respons:
```
{ "data": {
  "serverTime": 1789...,
  "applied":  { "products": 2, "transactions": 1, ... },   // jumlah tersimpan/terupdate
  "skipped":  [ { "table":"products","id":"...","reason":"STALE" } ],  // LWW: versi server lebih baru
  "rejected": [ { "table":"...","id":"...","code":"VALIDATION","message":"..." } ] // payload cacat
              // atau code "ID_CONFLICT": id sudah dipakai TOKO LAIN → baris tak disimpan
} }
```
**Aturan server (WAJIB dipahami):**
- **Idempotent**: kirim ulang baris yang sama TIDAK menggandakan (UPSERT by `id`). Aman retry saat timeout/putus.
- **Master data** (products, customers, users, wallets, dst.) = **LWW**: jika `updatedAt` yang dikirim ≤ versi server → **skipped `STALE`** (biarkan; berarti server lebih baru → nanti didapat via PULL).
- **Ledger** (transactions, transaction_items, payments, stock_logs, wallet_transactions, credit_payments, purchase_items, stock_opname_items) = **append-only** (server tak menolak sale yang sudah terjadi).
- **Tombstone**: baris dengan `deletedAt != null` disimpan sebagai penghapusan tersinkron.
- **`business_id` dari JWT** (jangan kirim di body; diabaikan).

**Klien setelah push sukses:** untuk tiap baris yang **applied** (atau **skipped STALE** — karena server sudah lebih baru), set `isDirty = false`. Baris **rejected** → perbaiki/skip (log). Urutan kirim disarankan **master → header → detail** (server tetap mengatur, tapi rapi).

Nama tabel (`tables` key) = snake_case: `business, users, categories, units, customers, products,
product_variants, wholesale_prices, stock_logs, transactions, transaction_items, payments,
installments, credit_payments, wallets, wallet_transactions, suppliers, purchases, purchase_items,
stock_opnames, stock_opname_items, receipt_presets, discounts, app_settings, bills`.

> Server mendukung `schemaVersion` ≤ **10**. `held_sales`/`held_sale_items` (Tunda) **local-only** — jangan
> di-push. `public_products`/thumbs = cache katalog global, bukan data toko.

> `business` bersifat singleton (1 baris; id dari body diabaikan, yang di-update baris toko dari JWT).

---

## 3. PULL — tarik perubahan (cloud → device)
Untuk **device baru / restore** atau ambil update dari device lain.
```
GET /v1/backup/pull?cursor=<opaque|kosong>&limit=500
→ { "data": { "serverTime":..., "tables": { "products":[ {..., serverUpdatedAt} ], ... } },
    "meta": { "nextCursor":"<opaque>", "hasMore": true|false } }
```
**Algoritma:**
```
cursor = app_settings.sync_cursor   // kosong saat pertama
loop:
  res = GET /v1/backup/pull?cursor=cursor&limit=500
  untuk tiap tabel & tiap baris:
     apply LWW lokal: jika baris.updatedAt > lokal.updatedAt (atau belum ada) → upsert;
                      jika baris.deletedAt != null → tandai terhapus lokal (tombstone)
  cursor = res.meta.nextCursor
  simpan app_settings.sync_cursor = cursor
  jika !res.meta.hasMore → stop
```
- `cursor` **opaque** — simpan & kirim balik apa adanya (jangan diparse).
- Baris hasil pull membawa `serverUpdatedAt` (otoritas urutan; untuk info, tak perlu disimpan wajib).
- Tombstone ikut ter-pull → penghapusan tersinkron.

---

## 4. STATUS (opsional)
```
GET /v1/backup/status → { data:{ lastBackupAt, counts:{ products, transactions, ... }, serverTime } }
```
Untuk panel "terakhir tersinkron" / jumlah data di cloud.

---

## 5. Kapan sync dijalankan (saran)
- **PUSH**: debounce setelah transaksi/perubahan (mis. tiap 30–60 dtk bila ada `isDirty`), saat app ke background, dan saat kembali online.
- **PULL**: saat login di device baru (full restore), saat app dibuka, dan periodik ringan.
- Jalankan di **background isolate**; jangan blok UI. Retry dengan backoff saat gagal jaringan (push idempotent → aman).

---

## 6. Model konflik (ringkas)
- **Master** → **Last-Write-Wins** per `updatedAt` (jam device). Sinkronkan jam device (NTP) sebisanya.
- **Ledger** → append-only, tak pernah bentrok (fakta transaksi).
- Karena PUSH mengembalikan `skipped STALE` dan PULL membawa versi terbaru, konvergensi tercapai: push lalu pull.

---

## 7. Yang TIDAK ikut sync
- **Katalog umum** (`public_products`) = referensi global, **bukan** data toko → tidak lewat backup. Didapat dari **seed** (`catalog_seed.sqlite`) + endpoint katalog (`/v1/catalog/*`). Lihat `spec/13-seed-catalog.md` & `API.md`.

Kontrak detail push/pull per baris: `spec/10-api-contract.md` §2. Ringkasan endpoint: `API.md`.

---

## 8. Implementasi klien Flutter (Sirko app) — keputusan detail

Bagian ini melengkapi §0–§7 dengan aturan yang **wajib** diikuti klien agar
konvergen & tidak merusak data lokal. Kode: `sirko/lib/features/sync/`.

### 8.1 Pelacakan perubahan (dirty tracking) — di level database
- Semua tabel tenant memakai `StandardColumns` (`is_dirty` default `true`).
- Agar tidak bergantung pada disiplin ratusan titik tulis di repository, app
  memasang **TEMP TRIGGER** SQLite (`AFTER UPDATE`, dibuat ulang tiap DB dibuka,
  **tanpa migrasi skema**) di tiap tabel yang disinkron:
  - set `is_dirty = 1`;
  - bila `updated_at` **tidak** dinaikkan oleh penulis → trigger menaikkannya ke
    `max(updated_at lama + 1, now)` (tanpa ini server akan menilai `STALE`).
- Trigger **tidak aktif** saat engine sync sendiri menulis (apply hasil pull /
  menandai bersih setelah push) — dikendalikan flag di tabel TEMP `sync_ctl`.
- INSERT baru otomatis dirty (default kolom).

### 8.2 Apa yang di-push
| Tabel lokal | Perlakuan |
|---|---|
| 24 tabel tenant di §2 | push bila `is_dirty = 1` |
| `held_sales`, `held_sale_items` | **lokal saja** (Tunda) |
| `public_products`, `public_product_thumbs` | **lokal saja** (katalog global) |
| `receipt_presets`, `discounts` | belum ada di app → tidak dikirim |
| `app_settings` | hanya kunci **toko** (whitelist): `allow_negative_stock`, `require_open_bill`, `costing_method`, `default_cash_wallet_id`. Kunci perangkat (`invoice_seq_*`, `sync_*`, `catalog_*`, seed, dsb.) **lokal saja** |
| `stock_opname_items` | hanya bila opname induknya sudah `finalized` (server = append-only, sedangkan item draft masih diedit) |

- Urutan kirim = urutan registry backend (master → header → detail), maks
  **500 baris/tabel/request**; diulang sampai tak ada baris dirty (maks 20 putaran).
- Header `Idempotency-Key: <uuid>` per request (aman retry).
- `clientInfo.schemaVersion` = **versi kontrak wire (10)**, bukan versi DB lokal.
- Konversi lokal→wire: `bool` SQLite 0/1 → `true/false`; `users.permissions`
  (teks JSON) → objek JSON; uang/waktu tetap integer.
- **Menandai bersih:** baris yang terkirim & tidak `rejected` →
  `UPDATE … SET is_dirty = 0 WHERE id = ? AND updated_at = <yang dikirim>`.
  Guard `updated_at` mencegah perubahan yang terjadi *selama* request ikut
  dianggap terkirim. Baris `rejected` ditandai bersih + dicatat di status sync
  (tidak diulang tanpa akhir); perbaikan data → baris dirty lagi → terkirim ulang.
- **`ID_CONFLICT`** = id baris sudah dimiliki toko lain di server (UUID global).
  Server **tidak** menimpa dan **tidak** melaporkannya sebagai `STALE` (dulu
  begitu → klien menandai bersih → data hilang diam-diam). Penyebab realistis:
  fitur salin data antar-toko (paket Juragan, lihat `JURAGAN.md`) yang menyalin
  `id`. Aturan: setiap salinan lintas-toko **wajib** membuat UUID baru.

### 8.3 Menerapkan hasil PULL (cloud → lokal)
Semua penerapan per halaman dalam **satu transaksi** dengan trigger nonaktif
dan `PRAGMA foreign_keys = OFF` (baris anak bisa tiba sebelum induknya; FK
konsisten setelah semua halaman diterapkan).
- **LWW** (master & header): `INSERT … ON CONFLICT(id) DO UPDATE … WHERE
  excluded.updated_at > lokal.updated_at`, `is_dirty = 0`. Versi lokal yang lebih
  baru (belum ter-push) **dipertahankan**. `deletedAt` ikut → tombstone.
- **Append** (ledger): `INSERT … ON CONFLICT(id) DO NOTHING`.
- **`business` (singleton):** id server ≠ id lokal → perbarui **satu-satunya**
  baris `businesses` lokal bila lebih baru; bila belum ada, sisipkan.
- **`app_settings`:** dicocokkan per **`key`** (unik lokal), hanya kunci whitelist.
- Kolom yang tak dikenal server (kolom khusus lokal) tidak disentuh; baris yang
  melanggar constraint lokal (mis. kolom wajib `null`) **dilewati & dihitung**
  sebagai konflik di status — tidak menggagalkan halaman.
- `createdAt` null → pakai `updatedAt`.
- **`users` tanpa `username`/`pinHash`** (owner versi cloud yang dibuat server
  saat `POST /v1/businesses`; login-nya email+password, bukan PIN) **diabaikan** —
  bukan data perangkat & tak bisa dipakai login PIN. Pemilik di HP tetap user
  perangkat (ber-PIN) yang ikut tersinkron dari HP pertama.
- Cursor disimpan di `app_settings.sync_cursor` (lokal saja) **setelah** halaman
  diterapkan → aman bila app mati di tengah.

### 8.4 Kapan sync berjalan (app)
- `push` lalu `pull` dalam satu siklus (`syncNow`), dijaga mutex (tak paralel).
- Otomatis: tiap **60 dtk** selama app aktif & terhubung cloud; saat app
  kembali ke foreground; ±5 dtk setelah ada perubahan data lokal (debounce);
  langsung setelah login/daftar/pulihkan.
- Gagal jaringan → status **Offline**, coba lagi di siklus berikutnya
  (push idempoten → aman). Semua transaksi tetap jalan offline.
- Manual: tombol **Sinkronkan sekarang** (Lainnya → Sinkronisasi Cloud).

### 8.5 Alur akun
- **Toko yang sudah berjalan di HP ini, belum punya akun:** *Daftar akun cloud*
  (`register` + OTP, lalu `POST /v1/businesses` dengan nama toko dari data lokal) → push seluruh data lokal.
- **Sudah punya akun:** *Masuk* → push data lokal + pull.
- **HP baru / instal ulang:** di layar onboarding pilih **Pulihkan dari Cloud**
  → login → pull penuh (toko, pengguna + PIN, produk, transaksi, dst.) → layar
  PIN. Tidak membuat toko/pemilik baru (mencegah pemilik ganda).
- **Pengaman ganti toko:** `sync_business_id` disimpan lokal; login ke toko
  (`businessId`) yang berbeda dari data lokal yang sudah tersinkron **ditolak**
  (mencegah data dua toko tercampur).
- Logout cloud: sync berhenti; data lokal tetap.

### 8.6 Saldo turunan dihitung ulang dari ledger (multi-kasir)
Stok dan saldo kas **bukan** sumber kebenaran — ledger-lah sumbernya:

| Kolom | Rumus (baris `deleted_at IS NULL`) |
|---|---|
| `products.stock` | Σ `stock_logs.qty_change` dgn `product_id = id AND variant_id IS NULL` |
| `product_variants.stock` | Σ `stock_logs.qty_change` dgn `variant_id = id` |
| `wallets.balance` | Σ `in` − Σ `out` − Σ `transfer` keluar (`wallet_id`) + Σ `transfer` masuk (`target_wallet_id`) |

1. **Ledger lengkap (klien ≥ 1.2.0+15).** Setiap perubahan stok menulis
   `stock_logs`: stok awal produk/varian (`type: initial`), edit stok lewat form
   (`adjustment`, `refType: manual`), penjualan/void/pembelian/stok masuk/
   penyesuaian, opname (`adjustment` = fisik − stok **saat finalisasi**).
   Form edit yang tak mengubah stok **tidak** menulis kolom stok (tak menimpa
   penjualan bersamaan). Saldo kas sudah lewat `wallet_transactions` sejak Fase 7.
2. **Rekonsiliasi sekali** (`ledger_reconciled_v1` di app_settings lokal), di
   awal sync pertama build ini: baris yang stok/saldonya ≠ Σ ledger mendapat
   satu baris ledger selisih (`refType: reconcile`, stok `initial` bila belum
   ada log, selain itu `adjustment`; wallet `in`/`out` kategori
   `rekonsiliasi`). Id-nya **UUID v5 deterministik**
   (`uuid5(URL, "sirko:ledger-reconcile:v1:<product|variant|wallet>:<id>")`) →
   dua HP dengan data lama yang sama menghasilkan baris yang sama; server
   (append) menyimpan sekali.
3. **Hitung ulang setelah pull.** Dalam transaksi `applyRemote` yang sama,
   untuk id yang tersentuh halaman itu (baris master, atau `stock_logs` /
   `wallet_transactions` yang merujuknya) kolom saldo di-set = rumus di atas,
   hanya bila berbeda, dengan trigger dirty nonaktif (tidak di-push balik).
   Ledger bersifat append dan unik per id → dua kasir yang menjual barang sama
   saat offline akan **konvergen** ke stok yang benar setelah keduanya sync.
4. **Prasyarat:** semua HP satu toko memakai build ≥ 1.2.0+15. Data yang
   di-push build 1.2.0+14 (produk tanpa log stok awal) baru benar di HP lain
   setelah HP asalnya diperbarui dan sync sekali (rekonsiliasi).

### 8.7 Batasan yang diketahui (fase berikutnya)
- **Hutang pelanggan / supplier** (`customers.debtBalance`,
  `suppliers.debtBalance`) masih LWW: ledger-nya (transaksi kredit,
  `credit_payments`, pembelian tempo) belum lengkap untuk semua jalur dan
  pembayaran memakai clamp. Dua HP yang mengubah hutang **pelanggan yang sama**
  bersamaan saat offline → perubahan yang kalah LWW hilang. Pola aman: satu HP
  mencatat pembayaran hutang.
- Penolakan stok minus dihitung terhadap stok lokal; dua kasir offline bisa
  bersama-sama menjual stok terakhir → setelah sync stok bisa negatif (jujur
  sesuai ledger).
- **Nomor invoice** dihitung per perangkat (`invoice_seq_<tgl>` lokal), tetapi
  selalu melanjutkan dari nomor tertinggi hari itu yang sudah ada di DB →
  aman untuk HP hasil pulihkan / instal ulang. Dua kasir yang **aktif
  bersamaan** sebelum saling sync tetap bisa menghasilkan nomor sama. Solusi
  lanjutan: kode perangkat di nomor invoice.
- **Foto produk** (`imagePath`) = path file lokal; foto tidak ikut tersinkron.
- Opname **draft** tidak terlihat di perangkat lain sampai difinalisasi.
