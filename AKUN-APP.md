# KONTRAK API — Akun pemilik (daftar, OTP email, login email/WA, lupa password, login offline) & harga PPOB per toko

> **Untuk:** agen/developer aplikasi `sirko-flutter`.
> **Dari:** backend `sirko-backend` (repo `sirko-be-hono-supabase`, branch `feature/ppob`).
> **Status:** mengikat. Field yang tercantum **tidak** akan diganti nama/tipenya; field baru boleh
> muncul (abaikan yang tak dikenal). **Tanggal:** 2026-11-06.
> **Dasar keputusan:** `C:\project\sirko\SPEC-warung-akun-ppob.md` + `PROMPT-backend-akun-ppob.md`.
> Contoh JSON = **respons server sungguhan** (token dipotong).
> Melengkapi: `KONTRAK-API-ppob-app.md` (PPOB & Poin) dan `KONTRAK-API-juragan-app.md` (multi-toko, paket).

---

## 0. Ringkasan alur

```
Daftar (online) ─POST /auth/register──▶ OTP 6 digit ke EMAIL (berlaku 10 menit)
   │                                       (akun belum aktif, belum ada toko)
   ▼
Masukkan kode ─POST /auth/verify-email─▶ SESI AKUN  (business=null, businesses=[])
   ▼
Buat toko ─POST /v1/businesses (token sesi akun)─▶ SESI TOKO (token toko, langsung bisa sync)
   ▼                                              toko pertama GRATIS (paket Warung)
Beranda (banner top-up Poin)

Login berikutnya ─POST /auth/login {login: email ATAU no WA, password}
   ├─ punya toko  → SESI TOKO (toko terakhir dibuka / pilih businessId)
   ├─ belum punya → SESI AKUN (lanjut "Buat toko")
   ├─ belum verifikasi → 403 EMAIL_NOT_VERIFIED (kode baru dikirim) → layar OTP
   └─ 5× salah → 429 ACCOUNT_LOCKED (15 menit)

Lupa password ─/auth/password/forgot {login}─▶ OTP ke email ─/auth/password/reset─▶ SESI (semua sesi lama dicabut)
```

**Tidak ada PIN pemilik.** Login offline memakai `offlineAuth` (§5).

---

## 1. Aturan umum

| | |
|---|---|
| Base URL | `https://sirko.produkdesa.com` · lokal `http://localhost:47321` · emulator `http://10.0.2.2:47321` |
| Sukses / error | `{ "data": … }` / `{ "error": { "code", "message", "details"? } }` — `message` bahasa Indonesia, **tampilkan apa adanya** |
| Auth | `Authorization: Bearer <accessToken>`; 401 → `POST /v1/auth/refresh` lalu ulangi sekali |
| Token | `expiresIn` detik (saat ini 3600). Refresh token **berputar**: setiap refresh memberi pasangan baru, yang lama tak berlaku |
| Waktu / uang | epoch **ms** UTC / integer rupiah |
| Nomor WA | input bebas (`0812…`, `+62 812…`, `62812…`, `812…`); server menyimpan format **`628…`** |

---

## 2. Objek sesi (dipakai verify, login, reset, switch-business, POST businesses)

```json
{
  "accessToken": "eyJ…", "refreshToken": "eyJ…", "expiresIn": 3600,
  "user":     { "id": "uuid", "name": "Sri Wahyuni", "role": "owner", "businessId": "uuid | null" },
  "business": { "id": "uuid", "name": "Warung Bu Sri", "businessType": "Kelontong" } | null,
  "businesses": [ { "id": "uuid", "name": "Warung Bu Sri", "role": "owner" } ],
  "plan": { "name": "warung", "period": null, "expiresAt": null, "maxStores": 1, "features": [], "serverTime": 1793983475652 },
  "account": { "id": "uuid", "name": "Sri Wahyuni", "email": "sri@contoh.id", "phone": "6281234564385", "emailVerified": true },
  "offlineAuth": { "algo": "pbkdf2-sha256", "iterations": 100000, "keyLength": 32,
                   "salt": "yFFTsIKKvXcTQa8Ojr83zg==", "hash": "Q007BEPDHZRbDVz8pRvOgXT5WCuXu8xIWXASd2fhMO0=",
                   "updatedAt": 1793983475481 }
}
```
- **Sesi akun** (belum punya toko): `user.businessId = null`, `business = null`, `businesses = []`,
  `user.id` = id akun. Token ini **hanya** untuk: `GET /v1/me`, `POST /v1/businesses`,
  `POST /v1/auth/password/change`, `GET /v1/me/businesses`. Endpoint data toko (sync, PPOB, Poin)
  menolak dengan 403 → app harus langsung ke layar "Buat toko".
- **Sesi toko**: `user.id` = id user di toko itu, `businessId` terisi. Semua endpoint toko boleh.
- `account` & `offlineAuth` selalu ada untuk pemilik (null hanya untuk user tanpa akun cloud).
- `plan`, `businesses`, switch toko: lihat `KONTRAK-API-juragan-app.md`.

---

## 3. Endpoint

### 3.1 `POST /v1/auth/register` — daftar (wajib online)
Body: `{ "name": "Sri Wahyuni", "email": "sri@contoh.id", "phone": "0812-3456-7890", "password": "rahasia123" }`

| field | aturan |
|---|---|
| `name` | wajib, ≤ 120 |
| `email` | wajib, format email (disimpan huruf kecil) |
| `phone` | wajib, nomor HP Indonesia (lihat §1) |
| `password` | wajib, **min 8** karakter |

201:
```json
{ "data": { "accountId": "b6477f6a-…", "email": "sri@contoh.id", "sentTo": "sr*****@contoh.id",
            "expiresAt": 1793984075572 } }
```
- `expiresAt` = batas berlaku kode. Belum ada token di tahap ini → tampilkan layar OTP.
- Error: 422 `VALIDATION` (field), 409 `CONFLICT` — `"Email sudah terdaftar. Silakan masuk atau gunakan \"Lupa password\"."`
  / `"Nomor WA sudah terdaftar. …"`, 429 `RATE_LIMITED` (terlalu banyak daftar dari jaringan ini).
- Daftar ulang dengan email/WA yang **belum diverifikasi** diperbolehkan (pendaftaran lama yang
  ditinggal diganti, kode baru dikirim).

### 3.2 `POST /v1/auth/verify-email` — masukkan kode
Body: `{ "email": "sri@contoh.id", "code": "035051" }` → 200 **objek sesi** (sesi akun, §2).

| Error | Kapan |
|---|---|
| 422 `OTP_INVALID` | `"Kode salah. Sisa 4 kali percobaan."` · `"Kode sudah kedaluwarsa. Minta kode baru."` · `"Terlalu banyak salah kode. Minta kode baru."` |
| 409 `CONFLICT` | `"Email sudah terverifikasi. Silakan masuk."` |
| 422 `VALIDATION` | kode bukan 6 angka |

### 3.3 `POST /v1/auth/resend-verification` — kirim ulang kode
Body: `{ "email": "…" }` → 200 `{ "sentTo", "expiresAt" }` (respons sama walau email tak dikenal).
429 `RATE_LIMITED`: `"Kode baru saja dikirim. Tunggu 45 detik untuk kirim ulang."`
(`details.retryAfterSeconds`) — jeda **60 dtk**, maks **5 kode/jam** per akun. Tampilkan hitung mundur.

### 3.4 `POST /v1/auth/login`
Body: `{ "login": "sri@contoh.id" | "081234567890", "password": "…", "businessId": "uuid?" }`
(`emailOrPhone` = nama lama, masih diterima.) → 200 **objek sesi**.

| HTTP | `code` | Arti / UI |
|---|---|---|
| 401 | `UNAUTHENTICATED` | `"Email/nomor WA atau password salah."` (sama untuk akun tak ada & password salah) |
| 403 | `EMAIL_NOT_VERIFIED` | akun belum verifikasi; `details: { email, sentTo, codeSent }` → buka layar OTP untuk `details.email` (`codeSent:false` = kode sebelumnya masih berlaku/jeda kirim ulang) |
| 429 | `ACCOUNT_LOCKED` | 5 gagal dalam 15 menit → kunci 15 menit **per akun dan per IP**; `details.retryAfterSeconds` |
| 403 | `FORBIDDEN` / `PLAN_REQUIRED` | `businessId` bukan milik akun / toko cabang tanpa Juragan (kontrak Juragan) |

### 3.5 Lupa password (wajib online)
1. `POST /v1/auth/password/forgot` `{ "login": "email atau no WA" }` → 200
   ```json
   { "data": { "message": "Bila akun terdaftar, kode atur ulang password dikirim ke email akun.",
               "sentTo": "sr*****@contoh.id", "expiresAt": 1793984075750 } }
   ```
   `sentTo: null` bila akun tidak ditemukan (pesan tetap sama). Kode selalu ke **email** akun.
2. `POST /v1/auth/password/reset` `{ "login", "code", "newPassword" }` (min 8) → 200 **objek sesi**
   (langsung masuk). Efek: **semua sesi lama di semua HP dicabut** (refresh token tak berlaku),
   `offlineAuth` baru, akun dianggap terverifikasi. Error: 422 `OTP_INVALID`, 429 `RATE_LIMITED`.

### 3.6 `POST /v1/auth/password/change` — ganti password saat masuk (Bearer, sesi akun/toko)
Body: `{ "currentPassword": "…", "newPassword": "…" }` → 200
```json
{ "data": { "account": { … }, "offlineAuth": { …baru…, "updatedAt": 1793983475815 } } }
```
Sesi di HP lain **tidak** dicabut; HP lain memperbarui hash offline saat sync (`GET /v1/me`, §5).
Error: 422 `VALIDATION` (`"Password saat ini salah."` / password baru < 8).

### 3.7 `POST /v1/businesses` — buat toko (Bearer)
Body: `{ "name": "Warung Bu Sri", "businessType": "Kelontong" }` → 201 **objek sesi toko baru**.
- Dari **sesi akun** (belum punya toko): **selalu boleh** — toko pertama gratis.
- Toko kedua dst.: butuh Paket Juragan → 403 `PLAN_REQUIRED` / `PLAN_LIMIT` (kontrak Juragan).
- Simpan token toko dari respons; buat file SQLite toko lokal; lanjut ke Beranda.

### 3.8 `GET /v1/me` (Bearer) — tambah `account` & `offlineAuth`
Bentuk `{ user, business, permissions, plan, businesses, account, offlineAuth }`. Panggil setiap
sync sukses: bila `offlineAuth.updatedAt` ≠ yang tersimpan → simpan hash baru.

### 3.9 `POST /v1/auth/refresh` — tidak berubah
`{ "refreshToken" }` → `{ accessToken, refreshToken, expiresIn }`. Berlaku juga untuk sesi akun.

### 3.10 `POST /v1/auth/register-business` — LAMA
Masih aktif untuk app ≤ 1.2.x (daftar + toko sekaligus, tanpa OTP). **App baru jangan memakainya.**
Akan dihapus setelah app baru rilis (koordinasi pemilik).

---

## 4. Penyimpanan di HP (saran)

| Data | Tempat | Kapan diisi/diganti |
|---|---|---|
| access/refresh token per toko (+ token sesi akun) | secure storage | verify / login / reset / switch / buat toko / refresh |
| `account` (nama, email, WA) | secure storage / prefs | setiap sesi & `GET /v1/me` |
| `offlineAuth` + login terakhir (email & nomor WA) | secure storage | setiap sesi, `password/change`, `GET /v1/me` bila `updatedAt` berubah |

"Buka aplikasi lagi" = pakai sesi tersimpan (tanpa mengetik). "Keluar" = hapus token (boleh simpan
`offlineAuth` agar login offline bisa).

## 5. Login OFFLINE (setelah "Keluar", tanpa internet)

1. Pengguna mengetik email/WA + password.
2. Cocokkan identitas dengan akun tersimpan (email persis, atau nomor WA dinormalisasi ke `628…`).
3. Hitung `PBKDF2-HMAC-SHA256(password_utf8, base64Decode(salt), iterations, keyLength=32)` →
   bandingkan `base64` hasilnya dengan `offlineAuth.hash` (perbandingan waktu-konstan).
4. Cocok → buka toko terakhir dari SQLite; token cloud diperbarui begitu online (login online
   ulang di latar belakang dengan password yang sama, atau refresh token bila masih ada).
5. Tidak ada `offlineAuth` tersimpan (HP baru) → login wajib online.

Catatan keamanan: `offlineAuth` **bukan** hash password server (beda algoritma & salt), tetapi tetap
memungkinkan tebak-password offline bila HP dibobol → simpan **hanya** di secure storage, jangan di
log/backup. Paket Dart: `cryptography` (`Pbkdf2.hmacSha256`) — gunakan implementasi native
(`cryptography_flutter`) agar 100.000 iterasi cepat; nilai `iterations` selalu baca dari payload.

---

## 6. Harga JUAL PPOB per toko (tab Produk → PPOB)

`price` di produk/order PPOB = **Poin yang dipotong** (modal toko). Harga jual ke pembeli diatur
pemilik per toko dan **disimpan di server** (ikut ke HP baru).

### 6.1 `GET /v1/ppob/pricing` (Bearer, sesi toko)
```json
{ "data": { "markups": { "pulsa": 2000, "data": 2000, "pln": 2000 }, "rounding": 500,
            "overrides": [], "isDefault": true, "updatedAt": null } }
```
Bawaan bila belum diatur: untung Rp2.000 per kategori, bulat ke atas kelipatan Rp500.

### 6.2 `PUT /v1/ppob/pricing` (owner/admin; kasir → 403)
Body (**seluruh** pengaturan; `overrides` = daftar lengkap, kosong = hapus semua harga khusus):
```json
{ "markups": { "pulsa": 2000, "data": 2500, "pln": 3000 }, "rounding": 500,
  "overrides": [ { "productId": "b8f7159b-…", "sellPrice": 10000 } ] }
```
200 = pengaturan tersimpan + `warnings` (harga khusus di bawah modal tetap disimpan):
```json
{ "data": { "markups": {…}, "rounding": 500, "overrides": [ { "productId": "b8f7159b-…", "sellPrice": 10000 } ],
  "isDefault": false, "updatedAt": 1793983475896,
  "warnings": [ { "productId": "b8f7159b-…", "productName": "Telkomsel 10.000", "price": 10700, "sellPrice": 10000,
                  "message": "Harga jual Telkomsel 10.000 di bawah modal (rugi Rp700)." } ] } }
```
- `rounding` ∈ `100 | 500 | 1000`; `markups` integer ≥ 0. Produk tak dikenal di `overrides` diabaikan.
- Tampilkan peringatan di bawah modal **sebelum** menyimpan juga (bandingkan dengan `price`).

### 6.3 Harga jual di `GET /v1/ppob/products` (sesi toko)
Setiap produk kini membawa:
```json
{ "id": "b8f7159b-…", "name": "Telkomsel 10.000", "price": 10700,
  "sellPrice": 10000, "margin": -700, "customPrice": true, … }
```
`sellPrice` = harga khusus, atau `ceil((price + markups[kategori]) / rounding) × rounding`.
Kasir memakai `sellPrice` sebagai harga di nota (boleh diubah kasir bila app mengizinkan);
modal item = `price`.

---

## 7. Perubahan PPOB untuk kasir (melengkapi `KONTRAK-API-ppob-app.md`)

- `POST /v1/ppob/orders` menjawab **paling lambat ±12 detik**. Bila penyedia belum menjawab →
  `status: "processing"`/`"pending"` (order tetap diproses server; cek `GET /orders/:id`). Batas
  15 dtk di app (SPEC §5) selalu cukup untuk menerima jawaban ini.
- **Nomor tujuan sama** yang masih punya order `processing`/`pending`/`waiting_admin` di toko ini →
  **409 `PENDING_SAME_TARGET`** (`details.orderId` = order yang menggantung). Tampilkan
  *"Nomor ini masih diproses, cek Riwayat PPOB"*. Retry dengan `clientRef` yang sama tetap
  mengembalikan order lama (bukan error ini).

---

## 8. Kode error baru

| HTTP | `code` | Endpoint |
|---|---|---|
| 403 | `EMAIL_NOT_VERIFIED` | login |
| 422 | `OTP_INVALID` | verify-email, password/reset |
| 429 | `ACCOUNT_LOCKED` | login (`details.retryAfterSeconds`) |
| 429 | `RATE_LIMITED` | register, resend-verification, password/forgot (`details.retryAfterSeconds`) |
| 409 | `PENDING_SAME_TARGET` | ppob/orders (`details.orderId`) |

---

## 9. Menguji di lokal tanpa email

Backend lokal (`C:\project\sirko\sirko-hono`, `.env`): tambahkan `AUTH_DEV_OTP_ECHO=true`
(**diabaikan bila `APP_ENV=production`**). Respons `register`, `resend-verification`,
`password/forgot`, dan `details` `EMAIL_NOT_VERIFIED` lalu memuat **`devCode`**:
```json
{ "data": { "accountId": "…", "email": "sri@contoh.id", "sentTo": "sr*****@contoh.id",
            "expiresAt": 1793984075572, "devCode": "035051" } }
```
Kode juga tercetak di log server (`[akun][dev] OTP …`). Di produksi kode hanya dikirim lewat
email (Resend) — butuh `RESEND_API_KEY` & `MAIL_FROM` di server.

## 10. Checklist app

- [ ] Onboarding: Daftar → OTP (hitung mundur kirim ulang 60 dtk) → Buat toko → Beranda.
- [ ] Login email/WA + password; tangani `EMAIL_NOT_VERIFIED` (ke layar OTP) & `ACCOUNT_LOCKED`.
- [ ] Sesi akun tanpa toko → langsung layar "Buat toko".
- [ ] Simpan sesi; buka app = langsung masuk; "Keluar" hapus token.
- [ ] Login offline dengan `offlineAuth` (§5); perbarui saat `GET /v1/me` memberi `updatedAt` baru.
- [ ] Lupa password (forgot → reset → langsung masuk); ganti password di Pengaturan.
- [ ] Hapus layar PIN pemilik & "Pulihkan dari Cloud"/"Daftar akun cloud" terpisah.
- [ ] Tab Produk → PPOB: untung per kategori, pembulatan, harga khusus (+peringatan di bawah modal).
- [ ] Kasir PPOB memakai `sellPrice`; tangani `PENDING_SAME_TARGET` & jawaban `processing`.
