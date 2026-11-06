# Sirko Backend — API Reference (untuk Mobile Dev)

Backend Hono @ Vercel + PostgreSQL (Supabase). Dokumen ini = ringkasan endpoint **live**.
Kontrak lengkap & semantik detail: [`spec/10-api-contract.md`](../spec/10-api-contract.md).

- **Base URL (produksi):** `https://sirko-be-hono-supabase.vercel.app`
- **Prefix:** semua endpoint di bawah **`/v1`** (TIDAK ada `/api`).
- **Format:** JSON, `Content-Type: application/json`.
- **Tipe data:** uang = integer rupiah · waktu = epoch **ms UTC** (integer) · id = UUID string.

## Envelope
- Sukses: `{ "data": ..., "meta": { ... } }` (meta opsional untuk paginasi).
- Error: `{ "error": { "code": "...", "message": "...", "details": ... } }`.
- Kode error → HTTP: `VALIDATION` 422 · `UNAUTHENTICATED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `CONFLICT` 409 · `UPGRADE_REQUIRED` 409 · `INTERNAL` 500.

---

## 1. Auth (self-owned JWT)
Token akses dikirim di header: `Authorization: Bearer <accessToken>`.

| Method | Path | Auth | Body / Query |
|---|---|---|---|
| POST | `/v1/auth/register-business` | — | `{ business:{name,businessType?}, owner:{name,email?,phone?,password} }` |
| POST | `/v1/auth/login` | — | `{ emailOrPhone, password }` |
| POST | `/v1/auth/refresh` | — | `{ refreshToken }` |
| GET | `/v1/me` | Bearer | — |

Respons register/login: `{ data:{ accessToken, refreshToken, expiresIn, user:{id,name,role,businessId}, business:{...} } }`.

```bash
# login → ambil accessToken
curl -sX POST $BASE/v1/auth/login -H 'content-type: application/json' \
  -d '{"emailOrPhone":"budi@toko.id","password":"rahasia123"}'
```

---

## 2. Katalog Produk Umum (GLOBAL)
Katalog referensi (tanpa harga/stok). Foto: `photoUrl` (full-res cloud) — untuk thumbnail seed lihat `catalog_seed.sqlite`.

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/v1/catalog/lookup?barcode=` | Bearer | 1 produk (auto-fill scan) atau **404** |
| GET | `/v1/catalog/search?q=&limit=&cursor=&verified=` | Bearer | cari; **`q` opsional** (tanpa `q` = semua). `limit` maks 50 |
| GET | `/v1/catalog.json?q=&page=&limit=&verified=` | **Basic Auth** | versi JSON browser-friendly (tanpa JWT), paginasi page/pages/total |

**Parameter filter (kedua endpoint):**
- `q` — kata kunci (nama/brand/keywords). Kosong = semua.
- `verified` — `1`/`true` = hanya terkurasi (1.751) · `0`/`false` = perlu-review (307) · kosong = semua (2.058).
- `limit` — search maks 50 (default 20); catalog.json maks 200 (default 50).
- `cursor` (search) / `page` (catalog.json) — paginasi.

**Bentuk item produk:**
```jsonc
{
  "id": "uuid", "barcode": "8991002101234", "barcodeType": "EAN13",
  "name": "Indomie Goreng", "brand": "indomie", "category": "Makanan",
  "photoUrl": "https://…/catalog/….jpg", "netSize": 85, "netUnit": "g",
  "keywords": ["indomie","goreng"], "verified": true, "source": "crowdsource",
  "shortDescription": null, "manufacturer": null, "defaultUnit": null,
  "packaging": null, "variant": null, "countryOfOrigin": "ID", "updatedAt": 1789185685387
}
```

```bash
# scan (mobile): butuh Bearer
curl -s "$BASE/v1/catalog/lookup?barcode=8991002101234" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/v1/catalog/search?q=indomie&verified=1&limit=20" -H "Authorization: Bearer $TOKEN"

# inspeksi cepat di browser (Basic Auth): buka langsung di browser
#   https://sirko-be-hono-supabase.vercel.app/v1/catalog.json?q=indomie&verified=1
```
> Kategori: `Makanan · Minuman · Rokok · Sembako · Kebersihan · Perawatan · Kesehatan · Bumbu/Dapur · Snack · ATK · Lainnya`.

### 2b. Kontribusi katalog (crowdsource, dengan moderasi)
Toko biasa (peran apa pun) boleh **mengusulkan** produk baru / perbaikan. Usulan **tidak langsung** masuk katalog — masuk antrean, di-review admin di dashboard. Setelah **disetujui** → muncul di katalog (`verified=true`, `source="crowdsource"`).

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| POST | `/v1/catalog/contributions` | Bearer (toko) | usul produk **baru**; atau perbaikan bila kirim `targetId` |
| GET | `/v1/catalog/contributions?status=&limit=&cursor=` | Bearer (toko) | daftar **usulan toko saya** + statusnya |

Body `POST` (hanya `name` wajib): `name, barcode, barcodeType, brand, category, photoUrl, manufacturer, defaultUnit, netSize, netUnit, packaging, variant, countryOfOrigin, shortDescription, keywords[], note`, plus `targetId` (uuid produk katalog yang mau diperbaiki). Foto: upload dulu via `POST /v1/media/sign-upload` (`scope:"catalog"`), lalu kirim `photoUrl`-nya.

Respons `POST` → `201 { data:{ id, status:"pending", ... } }`. `GET` tiap item punya `status` (`pending|approved|rejected`), `reviewNote`, `resultProductId`.

```bash
# usul produk baru dari toko
curl -s -X POST "$BASE/v1/catalog/contributions" -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"Teh Kotak 300ml","barcode":"8990001112223","brand":"Ultra","category":"Minuman","netSize":300,"netUnit":"ml","note":"produk warung saya"}'

# cek status usulan saya
curl -s "$BASE/v1/catalog/contributions" -H "Authorization: Bearer $TOKEN"
```
> **Review admin** dilakukan di dashboard: `/dashboard/contributions` (Basic Auth) — ada tombol Setujui / Tolak (dengan alasan). Tulis langsung ke katalog (`POST /v1/catalog`, `PUT/DELETE /:id`) tetap khusus `sirko_admin`.

---

## 3. Media (foto) — S3 signed URL
| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/v1/media/sign-upload` | Bearer | `{ scope:"product"\|"catalog", fileName, contentType, size? }` |

Respons: `{ data:{ uploadUrl, method:"PUT", headers:{"Content-Type"}, publicUrl, expiresIn } }`. Client PUT biner ke `uploadUrl`, simpan `publicUrl`. `scope:"catalog"` khusus sirko_admin.

---

## 4. Backup / Sync data toko (Bearer)
| Method | Path | Keterangan |
|---|---|---|
| POST | `/v1/backup/push` | kirim batch multi-tabel → UPSERT by id (idempotent). `business_id` dari JWT (body diabaikan) |
| GET | `/v1/backup/pull?cursor=&limit=` | tarik perubahan (restore), keyset cursor, termasuk tombstone |
| GET | `/v1/backup/status` | ringkasan: lastBackupAt, counts per entitas |

Detail payload push/pull (per tabel, LWW vs append-only, tombstone) ada di `spec/10-api-contract.md` §2.

---

## 4b. Saran pengguna (Bearer + konteks toko)

```
POST /v1/feedback   { category?: "saran"|"masalah"|"pertanyaan"|"lainnya" (default saran),
                      message: string (3–2000), contact?: string, appVersion?: string, platform?: string }
→ 201 { data: { id, category, message, contact, status: "baru", adminNote: null, createdAt, updatedAt } }
GET  /v1/feedback   → { data: [ ...saran toko ini, terbaru dulu ] }   // riwayat + status & balasan admin
```
- `business_id` & pengirim diambil dari JWT. Maks **20 saran / toko / 24 jam** → lebih dari itu `429 RATE_LIMITED`.
- `status`: `baru` → `dibaca` / `diproses` → `selesai` / `ditolak` (diubah admin di dashboard). `adminNote` = balasan admin, boleh ditampilkan di app.
- Online-only (tak lewat backup/sync).

## 5. Health
`GET /v1/health` (tanpa auth) → `{ data:{ status:"ok", db:"ok", serverTime } }`.

---

## Catatan untuk Mobile
- **Katalog default (offline):** gunakan bundel `assets/seed/catalog_seed.sqlite` (1.751 produk + thumbnail) — lihat `spec/13-seed-catalog.md`. API katalog di atas untuk lookup/update online (delta).
- **Auth:** simpan `accessToken` (umur `expiresIn` detik) + `refreshToken`; perbarui via `/v1/auth/refresh`.
- Semua waktu epoch ms UTC; uang integer rupiah; id UUID digenerate device.

---

## Poin & PPOB

> **Panduan lengkap untuk aplikasi (alur layar, contoh respons asli, status & polling, idempotensi,
> pencatatan ke kasir, cara uji): [PPOB-APP.md](PPOB-APP.md).** Bagian di bawah = ringkasan.

Ringkasan endpoint tambahan: `GET /v1/ppob/status` (saklar PPOB, kategori tersedia, saldo & hak
top-up — untuk layar menu) · `GET /v1/points/topups/:id` (status satu top-up + instruksi bila
masih menunggu — untuk polling).

### Poin Sirko (Bearer + konteks toko) — saldo prabayar untuk PPOB

Saldo milik **akun pemilik** toko (dipakai bersama semua toko milik akun itu). Server = sumber kebenaran:
**jangan** simpan saldo sebagai data lokal yang di-sync/backup — selalu baca dari server. Online-only.

```
GET  /v1/points            → { balance, ledger:[20 terakhir], nextCursor, pendingTopups:[{topup, instructions}], limits:{minTopup,maxTopup} }
GET  /v1/points/ledger?cursor=&limit=   → data:[mutasi], meta:{nextCursor, hasMore}
GET  /v1/points/topups     → riwayat top-up
POST /v1/points/topups     { amount }   (hanya role owner/admin) → 201 { topup, instructions }
POST /v1/points/topups/:id/cancel       → batalkan top-up yang masih menunggu
```
- Mutasi: `{ id, type: topup|purchase|refund|adjustment, amount (±), balanceAfter, businessId, businessName, note, createdAt }`.
- `instructions`: `{ transferAmount, bankName, accountNo, accountName, qrisImageUrl, note, expiresAt }` — pengguna
  transfer **tepat** `transferAmount` (nominal + 3 digit kode unik); Poin yang masuk = `transferAmount`.
- Status top-up: `pending` → `paid` (dikonfirmasi admin) / `rejected` / `expired` (lewat batas) / `cancelled`.
- Error: `OWNER_ACCOUNT_MISSING` (409, toko tanpa akun pemilik cloud), `VALIDATION` (nominal di luar batas),
  `CONFLICT` (masih ada top-up menunggu melebihi batas), `FORBIDDEN` (bukan owner/admin).
- Poin tidak bisa ditarik maupun ditransfer ke akun lain.

### PPOB — pulsa & paket data (Bearer + konteks toko, online-only)

Dibayar dengan **Poin Sirko** (bagian di atas). Harga di sini = harga Poin yang dipotong; harga jual ke pembeli
ditentukan toko sendiri di aplikasi.

```
GET  /v1/ppob/products?category=pulsa|data&customerNo=08…   → data:[{id, category, brand, name, description, price, available, unavailableReason}]
                                                              meta:{operator, enabled}   (difilter operator dari nomor)
POST /v1/ppob/orders  { clientRef, productId, customerNo }     → 201 order
GET  /v1/ppob/orders/:id                                       → order (server cek ulang ke penyedia bila masih pending)
GET  /v1/ppob/orders?cursor=&limit=                            → riwayat, meta:{nextCursor, hasMore}
```
- **`clientRef` wajib unik per pembelian** (mis. UUID dibuat app saat tombol Bayar ditekan). Kirim ulang
  dengan `clientRef` sama (timeout/klik ganda) → server mengembalikan order yang sama, Poin tidak terpotong lagi.
- Order: `{ id, clientRef, category, brand, productName, customerNo, price, status, refunded, sn, message, createdAt, completedAt }`.
- `status`: `success` (tampilkan `sn`) · `failed` (Poin **sudah dikembalikan** otomatis, `refunded: true`) ·
  `pending`/`processing` (tampilkan "sedang diproses", polling `GET /orders/:id` tiap ±10–15 dtk).
- Error: `INSUFFICIENT_POINTS` (409, `details.balance`/`required`), `PRODUCT_UNAVAILABLE` (409, nonaktif/cut-off),
  `PPOB_UNAVAILABLE` (503), `VALIDATION` (422, nomor tak valid / operator tak cocok), `OWNER_ACCOUNT_MISSING`.

### Token listrik PLN prabayar (diproses MANUAL oleh admin Sirko)

```
GET  /v1/ppob/products?category=pln          → produk token (nominal), price = Poin
POST /v1/ppob/pln/inquiry { meterNo }        → { ok, meterNo, name, segmentPower, message, cached }
POST /v1/ppob/orders { clientRef, productId, customerNo: <no meter 11–12 digit>, notifyEmail? }
                                             → 201 order status `waiting_admin`
GET  /v1/ppob/orders/:id                     → setelah admin memproses: status `success`, `sn` = token
```
- Tampilkan nama dari `pln/inquiry` sebelum bayar agar tak salah meter. `ok:false` (nomor tak ditemukan /
  batas cek tercapai) → tampilkan peringatan, pengguna tetap boleh lanjut.
- Setelah bayar: Poin terpotong, order `waiting_admin` (pesan: sedang diproses admin). App polling
  `GET /orders/:id` (mis. tiap 30 dtk saat layar terbuka) atau buka dari riwayat.
- Admin menempel token → `status: success`, `sn` = token format `1234-5678-9012-3456-7890`, `plnName`;
  token juga dikirim **email** ke email akun pemilik + `notifyEmail` (bila diisi).
- Tak bisa diproses (meter salah, gangguan) → `status: failed`, `refunded: true` (Poin kembali) + email.

## Langganan & multi-toko (Paket Juragan)
Kontrak mengikat app: `KONTRAK-API-juragan-app.md` · desain: [JURAGAN.md](JURAGAN.md).
Paket melekat ke **akun pemilik** (bukan toko). Server = sumber kebenaran; app
meng-cache `plan` untuk offline. Status paket **tidak pernah** memblok
`/v1/backup/*` maupun pencatatan.

### Objek bersama
```jsonc
// Plan — selalu ada serverTime. Setelah expiresAt server mengirim warung
// (tenggang offline 3 hari HANYA di app).
{ "name": "juragan", "period": "monthly", "expiresAt": 1796000000000, "maxStores": 3,
  "features": ["multi_store", "staff", "advanced_reports", "receipt_branding"], "serverTime": 1793900000000 }
// warung: { "name":"warung", "period":null, "expiresAt":null, "maxStores":1, "features":[], "serverTime":… }

// BusinessSummary
{ "id": "uuid", "name": "Warung Bu Sri", "role": "owner" }
```
Paket yang ditampilkan di sesi = paket **akun pemilik toko aktif** (kasir melihat paket tokonya).

### Sesi — satu bentuk respons
`register-business` (201), `login` (200), `switch-business` (200), `POST /v1/businesses` (201)
mengembalikan `data` berbentuk **identik**:
```jsonc
{ "accessToken": "…", "refreshToken": "…", "expiresIn": 900,
  "user": { "id", "name", "role", "businessId" },        // field lama (app ≤ 1.2.0+15)
  "business": { "id", "name", "businessType" },           // field lama
  "businesses": [BusinessSummary…],                       // baru
  "plan": Plan }                                          // baru
```

| Method | Path | Auth | Body | Catatan / error |
|---|---|---|---|---|
| POST | `/v1/auth/login` | — | `{ emailOrPhone, password, businessId? }` | Toko: `businessId` (harus anggota) → toko terakhir dibuka → toko utama. Bukan anggota → 403 `FORBIDDEN`. Paket warung + `businessId` bukan toko utama → 403 `PLAN_REQUIRED` "Toko cabang hanya bisa dibuka dengan Paket Juragan." (tanpa `businessId`, warung selalu masuk toko utama). |
| POST | `/v1/auth/register-business` | — | (tetap) | Email/telepon terdaftar → 409 `CONFLICT` ("Masuk lalu tambah toko (Paket Juragan).") |
| POST | `/v1/auth/switch-business` | Bearer | `{ businessId }` | Bukan anggota / tak ada → 403 `FORBIDDEN`. Warung & bukan toko utama → 403 `PLAN_REQUIRED`. Token toko asal tidak dicabut. |
| POST | `/v1/businesses` | Bearer (owner) | `{ name, businessType? }` | Warung → 403 `PLAN_REQUIRED` · sudah `maxStores` → 403 `PLAN_LIMIT` · 422 `VALIDATION`. Token toko baru langsung bisa push. |
| GET | `/v1/me` | Bearer | — | + `plan`, `businesses` |
| GET | `/v1/me/businesses` | Bearer | — | `{ businesses, plan }` |
| POST | `/v1/auth/refresh` | — | (tetap) | Token tetap untuk toko baris `users`-nya (per toko). **Tidak memeriksa paket** (J7): HP yang sudah login ke toko cabang tetap bisa refresh & sync setelah langganan habis. |

Toko utama = toko pertama yang dimiliki akun (owner, terlama).

### Langganan (QRIS statis + konfirmasi admin)
| Method | Path | Auth | Respons / error |
|---|---|---|---|
| GET | `/v1/plans` | Bearer (semua role) | `{ prices:[{plan,period,amount,maxStores}], payment:{qrisUrl,bankName,accountNo,accountName,note}, plan }` — harga dari `plan_prices` (tanpa data → `[]`), payment dari `app_config['subscription']` (kosong → null) |
| POST | `/v1/plan/checkout` | Bearer (**owner**) | Body `{ period: "monthly"\|"yearly" }` → 201 `Checkout`. Non-owner → 403 `FORBIDDEN` · period salah → 422 `VALIDATION` · harga belum diatur → 503 `PLAN_UNAVAILABLE` |
| GET | `/v1/plan/checkout/:id` | Bearer (akun pemilik checkout) | 200 `Checkout` status terbaru · bukan milik akun / tak ada → 404 `NOT_FOUND` |
| POST | `/v1/plan/checkout/:id/proof` | Bearer (owner) | Body `{ mediaPath }` (URL dari `/v1/media/sign-upload`) → 200 `Checkout` (hanya saat `pending`) |

```jsonc
// Checkout
{ "id": "uuid", "period": "monthly", "amount": 49123, "uniqueCode": 123,
  "expiresAt": 1793986400000, "qrisUrl": "https://…/qris.png", "status": "pending",
  "note": null,      // alasan bila rejected
  "plan": null }     // Plan terbaru HANYA bila status = confirmed
```
- `amount` = harga + `uniqueCode` (1–999) → nominal yang **harus** dibayar persis.
- Satu akun maksimal satu `pending`: checkout baru membuat yang lama `expired`.
  Pending lewat 24 jam → `expired`. Dua pending aktif tak pernah bernominal sama.
- Admin dinotifikasi saat checkout dibuat.
- Konfirmasi admin: langganan baru mulai `max(sekarang, akhir langganan aktif)` →
  bayar sebelum habis menyambung, tidak menghanguskan sisa hari. Periode = +1 bulan /
  +1 tahun kalender (tanggal dijepit ke akhir bulan, mis. 31 Jan → 28/29 Feb).

### Lintas-toko (Bearer, butuh `multi_store`)
Semua endpoint memverifikasi: paket akun pelaku Juragan (else 403 `PLAN_REQUIRED`) **dan**
akun = **owner** di setiap toko yang disentuh (else 403 `FORBIDDEN`). `auth.businessId` tidak dipercaya.

| Method | Path | Body / query | Respons |
|---|---|---|---|
| GET | `/v1/juragan/reports/summary` | `?preset=today\|7d\|30d\|month\|lastmonth\|year` atau `?from=YYYY-MM-DD&to=YYYY-MM-DD` (WIB; default bulan ini) | 200 `{ range:{from,to,fromMs,toMs}, stores:[StoreSummary], total, plan }` |
| POST | `/v1/juragan/copy-products` | `{ fromBusinessId, toBusinessId, productIds: uuid[1..200] }` | 201 `{ copied:[{fromProductId,toProductId,variants:[{fromVariantId,toVariantId}]}], skipped:[{fromProductId,reason:"NOT_FOUND"\|"ALREADY_COPIED"\|"BARCODE_EXISTS",existingProductId?,variants:[{fromVariantId,toVariantId}]}], createdCategories, createdUnits }` |
| GET | `/v1/juragan/product-links` | `?fromBusinessId=&toBusinessId=` | 200 `{ links:[{fromProductId,toProductId,variants:[{fromVariantId,toVariantId}]}] }` — pasangan tertaut, arah sesuai query, hanya yang hidup di kedua sisi |
| GET | `/v1/juragan/products` | `?businessId=&q=` (q opsional: nama/barcode, tanpa beda huruf) | 200 `{ products:[{id,name,barcode,stock,hasVariants,variants:[{id,name,stock}]}] }` — maks 200, urut nama, tanpa produk terhapus; `stock` = Σ `stock_logs` (ledger), bukan `products.stock` |
| POST | `/v1/juragan/stock-transfers` | `{ fromBusinessId, toBusinessId, lines:[{productId,toProductId,variantId?,toVariantId?,qty>0}] (1..100), note? }` | 201 `{ transferId, fromBusinessId, toBusinessId, createdAt, lines:[{…, fromStockAfter, toStockAfter}] }` |

```jsonc
// StoreSummary (semua angka integer rupiah)
{ "businessId": "uuid", "name": "Cabang Pasar", "txCount": 12, "omzet": 350000,
  "revenue": 348000, "cogs": 290000, "grossProfit": 58000,   // rumus laba §9 = laporan app
  "receivables": 20000,   // kasbon pelanggan SAAT INI (semua periode), Σ max(total − dibayar − pelunasan, 0)
  "cashBalance": 145000 } // saldo kas semua dompet SAAT INI dari ledger wallet_transactions (Σ in − Σ out)
// total = penjumlahan semua toko (txCount, omzet, revenue, cogs, grossProfit, receivables, cashBalance)
```
- Laporan hanya mencakup toko yang akun itu **owner**, dari data yang sudah ter-sync.
- **Salin produk:** semua baris (produk, varian, harga grosir, kategori/satuan baru) mendapat **UUID baru**;
  stok salinan **0** (isi lewat mutasi stok). Kategori & satuan dicocokkan **per nama** (tanpa beda huruf
  besar/kecil) di toko tujuan, dibuat bila belum ada. Produk yang **barcode-nya sudah ada** di toko tujuan
  dilewati (`BARCODE_EXISTS` + `existingProductId` → pakai untuk mutasi). `image_path` hanya disalin bila URL http(s).
- **Tautan salinan (`product_links`, server-only, bukan tabel sync)** mengingat pasangan produk/varian antar-toko,
  berlaku **dua arah** (A→B = B→A). Urutan pencocokan `copy-products` per produk sumber:
  (1) sudah tertaut ke produk tujuan yang belum dihapus → `ALREADY_COPIED` + `existingProductId` + `variants`;
  (2) barcode sama di toko tujuan → `BARCODE_EXISTS` + tautan disimpan (varian dicocokkan per **nama**, tanpa beda huruf);
  (3) selain itu disalin & tautan produk + tiap varian disimpan. Tautan ke produk tujuan yang sudah dihapus
  diabaikan (disalin ulang, tautan diperbarui). Item `skipped` selalu membawa `variants` (kosong untuk `NOT_FOUND`).
  `stock-transfers` juga menyimpan tautan pasangan yang dipakai (produk & varian) bila belum ada.
  Toko tujuan menerima produk baru lewat **pull sync biasa**.
- **Mutasi stok:** satu transaksi DB; per baris menambah `stock_logs` toko asal (`type:"out"`, `qtyChange:-qty`)
  dan tujuan (`type:"in"`, `+qty`), `refType:"store_transfer"`, `refId` = `transferId` yang sama, `note`
  "Mutasi ke/dari <toko>". Server **tidak** mengubah `products.stock`/`updatedAt` — app menghitung ulang stok
  dari ledger setelah pull (SYNC.md §8.6). Varian asal & tujuan harus sama-sama diisi atau kosong.
  Stok ledger di server kurang → 422 `VALIDATION` ("… tidak cukup … Sinkronkan toko asal dulu."), tak ada
  baris yang tertulis.

### Kode error baru
| code | HTTP | pesan contoh |
|---|---|---|
| `PLAN_REQUIRED` | 403 | "Fitur ini butuh Paket Juragan." |
| `PLAN_LIMIT` | 403 | "Paket Juragan maksimal 3 toko." |
| `PLAN_UNAVAILABLE` | 503 | "Pembayaran langganan belum tersedia. Coba lagi nanti." |
