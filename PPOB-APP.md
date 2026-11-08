# KONTRAK API — Poin Sirko & PPOB (untuk aplikasi Flutter)

> **Untuk:** agen/developer aplikasi `sirko-flutter` yang membangun menu **PPOB**
> (pulsa, paket data, token listrik) dan **Poin Sirko** (saldo + top-up).
> **Dari:** backend `sirko-backend` (repo `sirko-be-hono-supabase`), pemilik: agen PPOB.
> **Status:** mengikat. Field yang tercantum di sini **tidak** akan diganti nama/tipenya;
> field baru boleh muncul kapan saja (abaikan yang tak dikenal).
> **Pembaruan 2026-11-06 (akun & kasir):** harga jual per toko (`sellPrice`, `GET/PUT /v1/ppob/pricing`),
> 409 `PENDING_SAME_TARGET`, jawaban order ≤ ±12 dtk — rinciannya di `KONTRAK-API-akun-app.md` §6–§7.
> **Tanggal:** 2026-11-06. Contoh JSON di bawah **diambil dari respons server sungguhan**
> (bukan ditulis tangan), hanya ID yang berbeda.
> **Rancangan lengkap (latar belakang):** `docs/superpowers/specs/2026-11-02-ppob-poin-design.md`.

---

## 0. Ringkasan dalam 10 baris

1. Toko membeli PPOB dengan **Poin Sirko** (1 Poin = Rp1). Poin diisi lewat **top-up**
   (transfer ke rekening Sirko + konfirmasi admin).
2. Saldo Poin milik **akun pemilik**, dipakai bersama **semua toko** milik pemilik itu
   (paket Juragan, maks 3 toko). Token apa pun dari toko mana pun milik owner yang sama →
   saldo yang sama.
3. **Server = satu-satunya sumber kebenaran** untuk saldo & order. Saldo Poin dan order PPOB
   **tidak** masuk SQLite/sync/backup. Selalu baca dari API. **Online-only.**
4. `price` di produk/order = **Poin yang dipotong** (harga modal toko). Harga jual ke pembeli
   **ditentukan pemilik toko sendiri** di app → selisihnya = laba warung.
5. Pulsa & data diproses **otomatis** (detik–menit). Token listrik diproses **manual oleh admin
   Sirko** (menit–jam): token tampil di app + dikirim ke email.
6. Setiap pembelian membawa **`clientRef` unik** → klik ganda/retry tidak memotong Poin dua kali.
7. Gagal = **Poin otomatis kembali** (`refunded: true`). Pending ≠ gagal: tunggu, jangan suruh beli ulang.
8. Mulai dari **`GET /v1/ppob/status`** untuk membangun layar menu.
9. Semua pesan error (`error.message`) berbahasa Indonesia, **siap ditampilkan apa adanya**.
10. Di produksi PPOB **nonaktif** sampai admin mengisi kredensial → `status.enabled = false`.

---

## 1. Aturan umum (sama dengan API Sirko lain)

| | |
|---|---|
| Base URL produksi | `https://sirko.produkdesa.com` (semua path di bawah `/v1`) |
| Base URL lokal | `http://localhost:47321` (PC) · `http://10.0.2.2:47321` (emulator Android) |
| Auth | `Authorization: Bearer <accessToken>` (token login/`switch-business`) |
| 401 | panggil `POST /v1/auth/refresh` lalu ulangi **sekali** (pola `CloudApiClient` yang sudah ada) |
| Sukses | `{ "data": …, "meta"?: … }` |
| Error | `{ "error": { "code": "KODE", "message": "teks Indonesia", "details"?: … } }` |
| Uang | integer rupiah (Poin) · Waktu = integer epoch **milidetik** UTC |
| ID | UUID string |

**Token per toko (Juragan).** Access token berlaku untuk satu toko (`businessId` di token).
Semua endpoint di dokumen ini memakai toko dari token: order tercatat atas toko itu, Poin
diambil dari dompet **pemilik** toko itu. Setelah `POST /v1/auth/switch-business`, panggil lagi
`GET /v1/ppob/status` (saldonya sama bila pemiliknya sama; riwayat order berbeda per toko).

---

## 2. Alur layar yang disarankan

```
Menu PPOB  ──GET /ppob/status──▶ kartu saldo Poin + [Top-up] + kategori (Pulsa | Paket Data | Token Listrik)
   │                                  (kategori available=false → abu-abu + tampilkan reason)
   ├─ Pulsa / Paket Data
   │    1. Input nomor HP  (validasi lokal 08…; boleh +62)
   │    2. GET /ppob/products?category=pulsa&customerNo=08…   → daftar nominal operator itu
   │    3. Pilih produk → layar konfirmasi: nomor, produk, "Bayar X Poin", saldo sesudah,
   │       + input "Harga jual ke pembeli" (default = price + laba usulan, disimpan di app)
   │    4. [Bayar] → buat clientRef (UUID) SEKALI → POST /ppob/orders
   │    5. Layar hasil: success (SN) | failed (Poin kembali) | pending (polling)
   │
   ├─ Token Listrik
   │    1. Input nomor meter / ID pelanggan (11–12 digit)
   │    2. POST /ppob/pln/inquiry → tampilkan nama & daya ("BUDI SANTOSO · R1/1300VA")
   │       ok=false → peringatan kuning, tetap boleh lanjut
   │    3. GET /ppob/products?category=pln → pilih nominal
   │    4. Konfirmasi + input opsional "Email pembeli" (token juga dikirim ke sana)
   │    5. POST /ppob/orders → status waiting_admin → layar "Sedang diproses admin"
   │       (polling tiap 30 dtk selama layar terbuka; token muncul di sini + email)
   │
   ├─ Top-up Poin (owner/admin saja → status.points.canTopup)
   │    1. Input nominal (min/max dari status.points) → POST /points/topups
   │    2. Layar instruksi: TRANSFER TEPAT {transferAmount} ke {bank}/{QRIS}, batas waktu
   │    3. Polling GET /points/topups/:id (tiap 15–30 dtk saat layar terbuka) → "paid" → saldo baru
   │
   └─ Riwayat: tab "Pembelian" (GET /ppob/orders) & tab "Mutasi Poin" (GET /points/ledger)
```

---

## 3. Endpoint

Semua butuh Bearer + token toko. Ringkasan:

| Method | Path | Fungsi |
|---|---|---|
| GET | `/v1/ppob/status` | Layar menu: saklar PPOB, kategori, saldo, hak top-up |
| GET | `/v1/ppob/products?category=&customerNo=` | Daftar produk |
| POST | `/v1/ppob/pln/inquiry` | Cek nama pelanggan dari nomor meter |
| POST | `/v1/ppob/orders` | Beli (idempoten via `clientRef`) |
| GET | `/v1/ppob/orders/:id` | Status satu order (untuk polling) |
| GET | `/v1/ppob/orders?cursor=&limit=` | Riwayat pembelian toko ini |
| GET | `/v1/points` | Saldo + 20 mutasi terakhir + top-up menunggu |
| GET | `/v1/points/ledger?cursor=&limit=` | Riwayat mutasi Poin |
| POST | `/v1/points/topups` | Ajukan top-up (owner/admin) |
| GET | `/v1/points/topups` | Riwayat top-up |
| GET | `/v1/points/topups/:id` | Status satu top-up (+ instruksi bila menunggu) |
| POST | `/v1/points/topups/:id/cancel` | Batalkan top-up yang masih menunggu |

Tidak ada endpoint transfer Poin antar-akun atau penarikan Poin (sengaja, aturan legal).

### 3.1 `GET /v1/ppob/status`
Panggil saat membuka menu PPOB, setelah top-up dikonfirmasi, dan setelah pindah toko.
```json
{
  "data": {
    "enabled": true,
    "categories": [
      { "key": "pulsa", "label": "Pulsa",         "available": true, "productCount": 3, "reason": null },
      { "key": "data",  "label": "Paket Data",    "available": true, "productCount": 1, "reason": null },
      { "key": "pln",   "label": "Token Listrik", "available": true, "productCount": 1, "reason": null }
    ],
    "points": {
      "available": true, "balance": 0, "reason": null,
      "canTopup": true, "minTopup": 20000, "maxTopup": 5000000
    },
    "serverTime": 1793913626603
  }
}
```
- `enabled=false` → tampilkan menu dengan keterangan "PPOB belum tersedia" (atau sembunyikan).
- `categories[].available=false` → tombol kategori nonaktif; tampilkan `reason`
  (`"PPOB belum aktif."`, `"Layanan sedang disiapkan."`, `"Belum ada produk."`).
- `points.available=false` → toko belum punya akun pemilik cloud; tampilkan `points.reason`.
- `points.canTopup` = peran token `owner`/`admin`. Gabungkan dengan izin lokal app (§7).

### 3.2 `GET /v1/ppob/products?category=pulsa|data|pln&customerNo=`
- `category` wajib. `customerNo` opsional; untuk `pulsa`/`data` → server mendeteksi operator dari
  prefix dan **hanya** mengembalikan produk operator itu (`meta.operator`). Diabaikan untuk `pln`.
- Urutan: per operator, lalu harga termurah.
```json
{
  "data": [
    { "id": "23dbe0b2-…", "category": "pulsa", "brand": "TELKOMSEL", "name": "Telkomsel 10.000",
      "description": "Pulsa Telkomsel Rp 10.000", "price": 10700, "available": true, "unavailableReason": null },
    { "id": "d3cb2cae-…", "category": "pulsa", "brand": "TELKOMSEL", "name": "Telkomsel 25.000",
      "description": null, "price": 25400, "available": true, "unavailableReason": null }
  ],
  "meta": { "operator": "TELKOMSEL", "enabled": true }
}
```
- `price` = Poin yang dipotong. `available=false` → produk sedang **cut-off** (jam tutup
  penyedia), tampilkan `unavailableReason` (mis. `"Sedang cut-off 23:45–00:15 WIB"`), jangan bisa dipilih.
- Nilai `brand`: `TELKOMSEL`, `BY.U`, `INDOSAT`, `XL`, `AXIS`, `TRI`, `SMARTFREN`, `PLN`.
- Nomor tak valid / operator tak dikenal → **422** `VALIDATION` (`"Nomor HP tidak valid."`).
- Token PLN: `brand: "PLN"`, nama `"Token PLN 50.000"`.
- Jangan cache daftar produk lebih dari ±10 menit (harga & ketersediaan berubah).

### 3.3 `POST /v1/ppob/pln/inquiry`
Body: `{ "meterNo": "51234567890" }` (11–12 digit; spasi/strip boleh).
```json
{ "data": { "ok": true, "meterNo": "51234567890", "name": "BUDI SANTOSO",
            "segmentPower": "R1 /000001300", "message": null, "cached": false } }
```
- `ok=false` → `message` berisi alasan (nomor tak ditemukan / batas cek tercapai / belum tersedia /
  "Cek nomor meter sedang bermasalah…"). Tampilkan apa adanya sebagai peringatan; pengguna **tetap
  boleh** membeli. Pesan teknis Digiflazz (salah konfigurasi, gangguan jaringan) tidak pernah diteruskan.
- `cached=true` hanya untuk hasil pasti (nama ditemukan, atau nomor memang salah), disimpan 24 jam.
  Gangguan sementara/konfigurasi tidak di-cache: cek ulang boleh langsung dicoba lagi.
- Format nomor salah → 422 `VALIDATION`.

### 3.4 `POST /v1/ppob/orders` — beli
Body:
```json
{ "clientRef": "0384bfb3-99ee-4e0c-b1f8-1818e7ce87d8",
  "productId": "23dbe0b2-…",
  "customerNo": "081234567890",
  "notifyEmail": "pembeli@contoh.id" }
```
| field | aturan |
|---|---|
| `clientRef` | **wajib**, 8–64 karakter, unik per pembelian (pakai UUID v4). Lihat §5. |
| `productId` | `id` dari §3.2 |
| `customerNo` | nomor HP (pulsa/data; operator harus cocok dengan produk) atau nomor meter (pln) |
| `notifyEmail` | opsional, hanya berguna untuk token PLN (token juga dikirim ke email akun pemilik) |

Respons **201 = order tercatat** (bukan berarti sukses!). Baca `status`:
```json
{
  "data": {
    "id": "93d248a2-…", "clientRef": "0384bfb3-…",
    "businessId": "c4ee40c4-…", "businessName": "Warung Bu Sri",
    "category": "pulsa", "brand": "TELKOMSEL", "productName": "Telkomsel 10.000", "sku": "tsel10",
    "customerNo": "081234567890", "price": 10700,
    "status": "success", "refunded": false, "sn": "0412778311902231", "plnName": null,
    "message": "Transaksi berhasil.",
    "createdAt": 1793913626650, "completedAt": 1793913626656
  }
}
```
Contoh status lain dari server:
```json
{ "status": "failed",  "refunded": true,  "sn": null,
  "message": "Transaksi gagal: Nomor tujuan salah. Poin sudah dikembalikan." }
{ "status": "pending", "refunded": false, "sn": null,
  "message": "Sedang diproses penyedia. Status akan diperbarui otomatis." }
{ "status": "waiting_admin", "category": "pln", "plnName": "BUDI SANTOSO", "sn": null,
  "message": "Sedang diproses admin Sirko. Token akan tampil di sini & dikirim ke email." }
```
Error (order **tidak** dibuat, Poin **tidak** terpotong):
```json
409 { "error": { "code": "INSUFFICIENT_POINTS",
      "message": "Poin tidak cukup. Saldo 100, dibutuhkan 25.400. Silakan top-up Poin.",
      "details": { "balance": 100, "required": 25400 } } }
422 { "error": { "code": "VALIDATION", "message": "Nomor 087812345678 bukan nomor TELKOMSEL (terdeteksi XL)." } }
```
Kode lain: `PRODUCT_UNAVAILABLE` (409; nonaktif/cut-off), `PPOB_UNAVAILABLE` (503),
`OWNER_ACCOUNT_MISSING` (409). Lihat §6.

### 3.5 `GET /v1/ppob/orders/:id`
Bentuk sama dengan §3.4. Bila order masih `pending`/`processing` dan sudah > 1 menit, server
**mengecek ulang ke penyedia** sebelum menjawab (dibatasi server 1×/menit per order — aman
dipanggil berulang). Order toko lain → 404.

### 3.6 `GET /v1/ppob/orders?cursor=&limit=`
Riwayat toko **ini** (bukan toko lain milik owner), terbaru dulu. `limit` 1–100 (default 30).
```json
{ "data": [ Order, … ], "meta": { "nextCursor": "MTc5MzkxMzYzNzA4N3ww…", "hasMore": true } }
```
Halaman berikutnya: `?cursor=<meta.nextCursor>`. `hasMore=false` → selesai.

### 3.7 `GET /v1/points`
```json
{
  "data": {
    "balance": 100241,
    "ledger": [ LedgerItem, … ],            // 20 terbaru
    "nextCursor": null,                       // untuk /points/ledger?cursor=
    "pendingTopups": [ { "topup": Topup, "instructions": Instructions } ],
    "limits": { "minTopup": 20000, "maxTopup": 5000000 }
  }
}
```

### 3.8 `GET /v1/points/ledger?cursor=&limit=`
```json
{ "data": [
    { "id": "3490218f-…", "businessId": "be9d7671-…", "businessName": "Warung Bu Sri",
      "type": "purchase", "amount": -52500, "balanceAfter": 291596,
      "refType": "ppob_order", "refId": "d3094c7d-…",
      "note": "Token PLN 50.000 → 51234567890", "createdBy": "app:e8156865-…", "createdAt": 1793913637107 }
  ],
  "meta": { "nextCursor": null, "hasMore": false } }
```
| `type` | arti | `amount` | tampilan usulan |
|---|---|---|---|
| `topup` | top-up dikonfirmasi | + | "Top-up Poin" |
| `purchase` | pembelian PPOB | − | `note` (produk → nomor); `refId` = id order |
| `refund` | pembelian gagal dikembalikan | + | "Pengembalian: …" |
| `adjustment` | koreksi admin Sirko | ± | "Koreksi admin: {note}" |

`businessName` = toko yang memakai/mengajukan (berguna bagi owner multi-toko; `null` untuk koreksi
tingkat akun). Saldo selalu = jumlah semua `amount`.

### 3.9 `POST /v1/points/topups` (owner/admin)
Body: `{ "amount": 100000 }` (integer rupiah, dalam `[minTopup, maxTopup]`).
```json
{
  "data": {
    "topup": {
      "id": "7ee86631-…", "businessId": "c4ee40c4-…", "businessName": "Warung Bu Sri",
      "ownerEmail": "sri@contoh.id", "amount": 100000, "uniqueCode": 241, "transferAmount": 100241,
      "status": "pending", "paidAt": null, "expiresAt": 1794000026608, "createdAt": 1793913626608
    },
    "instructions": {
      "transferAmount": 100241, "bankName": "BCA", "accountNo": "8730123456",
      "accountName": "PT Sirko Digital", "qrisImageUrl": "https://…/qris.png",
      "note": "Transfer TEPAT sesuai nominal (termasuk 3 digit kode unik) agar cepat dikonfirmasi.",
      "expiresAt": 1794000026608
    }
  }
}
```
- Tampilkan **`transferAmount` besar-besar** + tombol salin. Poin yang masuk = `transferAmount`
  (kode unik ikut jadi Poin).
- `qrisImageUrl` boleh `null` (hanya transfer bank). Bila ada, tampilkan gambar QRIS statis
  (pengguna mengetik nominal `transferAmount` sendiri di aplikasi bank/e-wallet).
- Error: 422 `VALIDATION` (nominal di luar batas; `details: { min, max }`), 403 `FORBIDDEN`
  (bukan owner/admin), 409 `CONFLICT` (sudah 3 top-up menunggu → batalkan/selesaikan dulu).
- Field lain (`accountId`, `requestedBy`, `adminNote`, `confirmedBy`) boleh diabaikan.

### 3.10 `GET /v1/points/topups/:id` · `GET /v1/points/topups` · `POST /v1/points/topups/:id/cancel`
- Detail: objek `Topup` + `instructions` (terisi **hanya** saat `status: "pending"`, selain itu `null`).
- Status: `pending` → `paid` (dikonfirmasi admin) | `rejected` (ditolak; lihat `adminNote`)
  | `expired` (lewat `expiresAt`, biasanya 24 jam) | `cancelled` (dibatalkan pengguna).
  Catatan: top-up `expired` masih bisa dikonfirmasi admin bila dana ternyata masuk.
- Cancel hanya untuk `pending`; respons = objek `Topup` terbaru.

---

## 4. Status order & polling

```
                 ┌────────────── success  (sn terisi)                     ── final
pulsa/data:  processing/pending ──┤
                 └────────────── failed   (refunded: true, Poin kembali)  ── final
token PLN:   waiting_admin ──────┬─ success (sn = token "1234-5678-9012-3456-7890", plnName)
                                 └─ failed  (refunded: true)
```
| `status` | Tampilkan | Aksi app |
|---|---|---|
| `success` | ✓ berhasil + `sn` (pulsa: nomor seri; PLN: **token**, tombol salin) | cetak struk, catat ke kasir (§8) |
| `failed` | ✗ `message` + "Poin sudah dikembalikan" | tawarkan coba lagi (dengan `clientRef` **baru**) |
| `pending`, `processing` | ⏳ `message` | polling `GET /orders/:id` tiap **10–15 dtk** selama layar terbuka (maks ±5 menit), lalu "cek di Riwayat" |
| `waiting_admin` | ⏳ "Diproses admin Sirko" | polling tiap **30 dtk** saat layar terbuka; token juga dikirim email |

- **Jangan pernah** menganggap pending/timeout sebagai gagal dan **jangan** membuat order baru
  untuk tujuan yang sama sementara order lama masih pending (bisa terisi dua kali).
- `message` selalu siap tampil. `sn` hanya terisi saat `success`.
- Status berubah di server (webhook/penyedia/admin) walau app tertutup → riwayat selalu benar.

---

## 5. Idempotensi `clientRef` (WAJIB dipahami)

- Buat `clientRef = Uuid().v4()` **satu kali saat pengguna menekan "Bayar"** dan simpan bersama
  draf pembelian sampai respons final diterima.
- Timeout / koneksi putus / app tertutup → **kirim ulang dengan `clientRef` yang SAMA**. Server
  mengembalikan order yang sudah ada (201, isi sama); Poin tidak terpotong lagi, penyedia tidak
  dipanggil lagi.
- `clientRef` baru = pembelian baru. Hanya buat yang baru bila pengguna sengaja membeli lagi.
- `clientRef` unik **per toko**.

---

## 6. Kode error

| HTTP | `code` | Kapan | Saran UI |
|---|---|---|---|
| 401 | `UNAUTHENTICATED` | token habis/tak ada | refresh lalu ulang sekali |
| 403 | `FORBIDDEN` | top-up oleh kasir/staff | sembunyikan tombol top-up |
| 404 | `NOT_FOUND` | order/top-up bukan milik toko ini | — |
| 409 | `INSUFFICIENT_POINTS` | saldo kurang (`details.balance`, `details.required`) | tampilkan pesan + tombol **Top-up** |
| 409 | `PRODUCT_UNAVAILABLE` | produk nonaktif / cut-off / tak tersedia | muat ulang daftar produk |
| 409 | `OWNER_ACCOUNT_MISSING` | toko tanpa akun pemilik cloud | arahkan owner login/daftar cloud |
| 409 | `CONFLICT` | top-up menunggu sudah maksimal | tampilkan daftar top-up menunggu |
| 422 | `VALIDATION` | nomor salah, operator tak cocok, nominal di luar batas, body cacat | tampilkan `message` di form |
| 429 | `RATE_LIMITED` | terlalu sering | coba lagi sebentar |
| 503 | `PPOB_UNAVAILABLE` | PPOB dimatikan / belum dikonfigurasi | sembunyikan/nonaktifkan menu |
| 409 | `PENDING_SAME_TARGET` | nomor tujuan sama masih punya order belum jelas (`details.orderId`) | "Nomor ini masih diproses, cek Riwayat PPOB" |

Selalu tampilkan `error.message` (bahasa Indonesia). `details` hanya untuk logika.

---

## 7. Peran & izin (dicek di app)

Token cloud di HP adalah milik **pemilik** (karyawan login dengan PIN lokal, JURAGAN.md §0/§4).
Karena itu pembatasan per karyawan dilakukan **di app**, memakai sistem izin lokal yang sudah ada
(`PermissionResolver`):
- Izin baru **`ppobSell`** — boleh menjual PPOB. Default: owner, admin, cashier.
- Izin baru **`pointTopup`** — boleh top-up Poin. Default: owner (& admin). Server juga menolak
  top-up bila peran token bukan owner/admin (`status.points.canTopup`).
- Karyawan tanpa izin: menu PPOB tampil read-only / tersembunyi (keputusan UI app).
- Poin **bukan** fitur paket Juragan — tersedia di paket Warung maupun Juragan (JURAGAN.md §3.0).

---

## 8. Mencatat penjualan ke kasir (laporan warung tetap benar)

Poin = modal warung, bukan omzet. Setelah order **`success`**, app mencatat transaksi kasir lokal
(ikut sync/backup seperti biasa):
- Item **non-stok** (tanpa `productId`/tanpa mutasi stok), `nameSnapshot` = `productName` +
  nomor tujuan, `qty` 1, `unitPrice` = **harga jual yang diisi pemilik/kasir**,
  `costPriceSnapshot` = `order.price` (Poin) → laba = selisihnya di laporan §9.
- Pembayaran pembeli (tunai/QRIS) dicatat seperti transaksi biasa (masuk dompet/kas).
- Simpan `order.id` di catatan transaksi agar bisa ditelusuri (mis. `note: "PPOB <order.id>"`).
- Jangan catat bila order `failed`. Untuk `pending`/`waiting_admin`: catat saat sudah `success`
  (atau catat di awal lalu batalkan/void bila akhirnya `failed` — pilih satu & konsisten).
- Ini perlu dukungan item non-stok di kasir (saat ini kasir belum mengenal item tanpa produk).

Struk PPOB minimal memuat: nama toko, waktu, produk, nomor tujuan, `sn` (pulsa) atau **token**
+ nama pelanggan PLN, harga jual ke pembeli, dan `order.id` (8 karakter pertama cukup).

---

## 9. Menguji

- **Lokal:** backend `C:\project\sirko\sirko-hono` (`npm run dev`, port 47321, DB `sirko_dev`).
  Isi `.env` lokal: `PPOB_ENABLED=true`. Tanpa kredensial Digiflazz, pulsa/data tampil
  `available=false` ("Layanan sedang disiapkan.") tetapi **token PLN tetap bisa diuji penuh**:
  1. Dashboard `http://localhost:47321/dashboard` → **PPOB → Produk & harga** → tambah nominal token.
  2. Beri Poin uji: **Toko → (toko Anda) → tab 🪙 Poin → Koreksi** (mis. `+500000`, alasan "uji"),
     atau ajukan top-up dari app lalu **Poin → Top-up → Dana masuk — konfirmasi**.
  3. Beli token dari app → **PPOB → Order → Detail → tempel token 20 digit** → app menerima `success`.
  4. Uji gagal: "Gagalkan & kembalikan Poin" → app menerima `failed`, `refunded: true`.
- **Digiflazz mode uji** (bila kredensial uji tersedia, `DIGIFLAZZ_TESTING=true`, dari IP yang
  di-whitelist): SKU `xld10` + nomor `087800001230` (sukses), `087800001232` (gagal),
  `087800001233` (pending → sukses), `087800001234` (pending → gagal).
- **Produksi:** PPOB aktif setelah admin mengisi kredensial; sebelum itu `status.enabled=false`.

---

## 10. Checklist implementasi app

- [ ] Model: `PpobStatus`, `PpobProduct`, `PpobOrder`, `PointsSummary`, `LedgerItem`, `Topup`, `TopupInstructions`.
- [ ] Repository online (pakai `CloudApiClient` yang sudah ada: Bearer + refresh 401).
- [ ] Menu PPOB dari `GET /ppob/status`; muat ulang setelah top-up `paid` & setelah pindah toko.
- [ ] Pulsa/Data: input nomor → produk per operator → konfirmasi (harga jual) → order → hasil.
- [ ] Token PLN: input meter → inquiry → nominal → email opsional → order → menunggu admin → token.
- [ ] `clientRef` dibuat sekali per "Bayar", dipakai ulang saat retry (§5).
- [ ] Polling sesuai §4; tidak pernah membeli ulang saat pending.
- [ ] Top-up: nominal → instruksi (salin nominal, QRIS) → polling → saldo baru; batal.
- [ ] Riwayat pembelian & mutasi Poin (cursor).
- [ ] Izin lokal `ppobSell` & `pointTopup` (§7).
- [ ] Catat penjualan ke kasir sebagai item non-stok + struk (§8).
- [ ] Mode offline: menu PPOB menampilkan "Butuh internet" (tidak ada antrean offline).
