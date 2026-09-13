# Sirko — Alur Sinkronisasi (untuk Mobile Dev)

App = **local-first** (Drift/SQLite). Cloud = cadangan & sinkronisasi antar-device,
**per toko**. Mesin sync = endpoint **Backup** (sudah live). Auth per-toko = JWT.

- Base URL: `https://sirko-be-hono-supabase.vercel.app` · semua di `/v1`.
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
POST /v1/auth/register-business   { business:{name,businessType?}, owner:{name,email?,phone?,password} }
POST /v1/auth/login               { emailOrPhone, password }
→ { data:{ accessToken, refreshToken, expiresIn, user:{id,role,businessId}, business } }
```
- Toko baru → `register-business`. Device lain / re-install → `login` (akun sama → `businessId` sama → PULL memulihkan data).
- Simpan `accessToken`(umur `expiresIn` detik), `refreshToken`, `businessId`.
- Saat request balas **401** → `POST /v1/auth/refresh { refreshToken }` → token baru; ulangi request. Bila refresh gagal → minta login ulang.

---

## 2. PUSH — unggah perubahan lokal (device → cloud)
Kirim baris ber-`isDirty=true`. Boleh dibatch (disarankan **≤ 500 baris/tabel** per request).

```
POST /v1/backup/push
{
  "clientInfo": { "deviceId": "<uuid>", "appVersion": "1.0.0", "schemaVersion": 8 },
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
stock_opnames, stock_opname_items, receipt_presets, discounts, app_settings`.

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
