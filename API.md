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

### Kode error baru
| code | HTTP | pesan contoh |
|---|---|---|
| `PLAN_REQUIRED` | 403 | "Fitur ini butuh Paket Juragan." |
| `PLAN_LIMIT` | 403 | "Paket Juragan maksimal 3 toko." |
| `PLAN_UNAVAILABLE` | 503 | "Pembayaran langganan belum tersedia. Coba lagi nanti." |
