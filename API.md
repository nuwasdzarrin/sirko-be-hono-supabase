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

## 5. Health
`GET /v1/health` (tanpa auth) → `{ data:{ status:"ok", db:"ok", serverTime } }`.

---

## Catatan untuk Mobile
- **Katalog default (offline):** gunakan bundel `assets/seed/catalog_seed.sqlite` (1.751 produk + thumbnail) — lihat `spec/13-seed-catalog.md`. API katalog di atas untuk lookup/update online (delta).
- **Auth:** simpan `accessToken` (umur `expiresIn` detik) + `refreshToken`; perbarui via `/v1/auth/refresh`.
- Semua waktu epoch ms UTC; uang integer rupiah; id UUID digenerate device.
