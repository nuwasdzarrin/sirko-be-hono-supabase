# Rancangan: PPOB + Poin Sirko

Tanggal: 2026-11-02 · Branch: `feature/ppob` · Status: **draf untuk disetujui**

Dokumen ini cukup untuk merencanakan & membangun fitur tanpa bertanya ulang.
Keputusan ditandai: **[pemilik]** = diputuskan pemilik produk; **[keputusan saya]** =
default yang saya pilih (boleh diubah — lihat daftar di §14).

---

## 1. Tujuan & alasan

Toko pengguna Sirko bisa **menjual pulsa, paket data, dan token listrik** ke
pelanggannya langsung dari aplikasi kasir, sehingga warung punya sumber
pendapatan tambahan tanpa aplikasi/agen lain.

Pembelian dibayar dengan **Poin Sirko**: saldo prabayar milik toko yang diisi
(top-up) lebih dulu. Dinamai "Poin" supaya **tidak tertukar** dengan saldo kas,
dompet, atau omzet toko **[pemilik]**.

Sumber produk **[pemilik]**:
- **Pulsa & paket data** → otomatis lewat **Digiflazz**.
- **Token listrik (PLN prabayar)** → **dibeli manual oleh admin Sirko**. Tiap
  order: admin dinotifikasi (Telegram/WA), membeli token, menempelkannya di
  halaman admin, lalu toko menerima token di aplikasi + **email**.

## 2. Sasaran, bukan sasaran, anti-sasaran

**Sasaran**
- Saldo Poin per toko yang **selalu benar & bisa diaudit** (tiap rupiah tercatat).
- Beli pulsa/data selesai otomatis dalam hitungan detik–menit.
- Token listrik selesai lewat alur manual admin yang cepat & tak terlewat.
- Admin bisa memantau semua order, saldo toko, top-up, dan saldo deposit Digiflazz.

**Bukan sasaran (tahap ini)**
- PPOB pascabayar (tagihan PLN, BPJS, PDAM, dll.).
- Payment gateway otomatis untuk top-up (tahap 1 = transfer + konfirmasi admin; §6).
- Poin untuk membayar hal lain selain PPOB.

**Anti-sasaran (gagal walau "jalan")**
- Poin terpotong **dua kali** untuk satu pembelian, atau terpotong tanpa produk
  terkirim dan tanpa dikembalikan.
- Saldo bisa minus, atau bisa diubah tanpa jejak di buku besar.
- Order token listrik **terlewat** (admin tak tahu ada order).
- Poin bisa **ditarik tunai** atau **ditransfer antar toko** **[pemilik]**.
- Data Poin/PPOB ikut mekanisme backup/sync (LWW) — HP bisa menimpa saldo.

## 3. Aturan Poin (juga dasar aspek legal)

- 1 Poin = Rp1, bilangan bulat **[keputusan saya]**.
- Poin **hanya** untuk membeli produk PPOB Sirko; **tidak bisa ditarik**, **tidak
  bisa dipindah ke toko lain**, tidak berbunga **[pemilik]**.
- Poin tak kedaluwarsa **[keputusan saya]**.
- Saldo tak boleh negatif (dijaga di database, bukan hanya di kode).
- Catatan: tetap disarankan konsultasi hukum terkait ketentuan uang elektronik BI
  sebelum rilis publik; desain closed-loop di atas mengurangi risikonya.

## 4. Arsitektur — prinsip inti

1. **Server = satu-satunya sumber kebenaran** untuk Poin & order PPOB. Berbeda
   dengan data toko lain (HP = sumber, server = cermin LWW). Tabel PPOB/Poin
   **tidak** masuk registry backup (`backup-tables.ts`) dan **tak bisa di-push**.
   HP hanya membaca saldo & meminta pembelian.
2. **Online-only.** Menu PPOB di app menolak saat offline.
3. **Buku besar (ledger) append-only.** Saldo = hasil penjumlahan ledger; kolom
   saldo hanya cache yang selalu diubah **dalam transaksi DB yang sama** dengan
   baris ledger. Ledger tak bisa di-UPDATE/DELETE (trigger DB menolak).
4. **Idempoten di setiap pintu**: pembelian membawa `clientRef` unik dari app;
   top-up dikonfirmasi sekali; webhook Digiflazz yang dikirim ulang tak memproses
   dua kali; refund maksimal satu per order.
5. **Serverless-friendly** (Vercel, tanpa worker latar & cron Hobby hanya harian):
   status order pending diselesaikan lewat **webhook Digiflazz**, ditambah
   **cek ulang saat dibaca** (app/dashboard membuka order pending > N menit →
   server bertanya ulang ke Digiflazz), ditambah tombol "Cek status" di dashboard.
6. **Penyedia di balik adaptor**: `ppob/providers/digiflazz.ts` & `manual.ts`
   dengan antarmuka sama (`purchase`, `checkStatus`). Notifikasi & email juga
   adaptor (`notify/telegram.ts`, `mail/brevo.ts`) — bisa diganti lewat env.
7. **Relay Digiflazz di VPS Kreatora (WAJIB).** Digiflazz hanya menerima
   panggilan dari **IP yang di-whitelist**, baik mode development maupun produksi
   (selain itu ditolak RC 45). Vercel tak punya IP keluar tetap, jadi panggilan
   keluar ke Digiflazz lewat **relay kecil** di VPS Kreatora (IP tetap
   `151.243.222.93`, dijalankan pm2 seperti app lain di server itu) **[keputusan saya]**:
   - Relay = app Node mini (Hono) yang **menyimpan kredensial Digiflazz**
     (username/API key tak perlu ada di Vercel) dan mengekspos 4 endpoint tipis:
     `cek-saldo`, `price-list`, `transaction`, `inquiry-pln`. Ia menghitung `sign`,
     meneruskan, lalu mengembalikan JSON Digiflazz apa adanya.
   - Vercel → relay diautentikasi **HMAC-SHA256** (header `X-Sirko-Sig` atas
     `timestamp + body`, toleransi 5 menit, rahasia bersama `RELAY_SECRET`) lewat
     HTTPS (subdomain di Kreatora melalui reverse proxy).
   - Relay **stateless & tanpa logika bisnis** (tidak menyentuh DB). Semua
     idempotensi dan ledger tetap di backend. Bila relay mati: pembelian ditolak
     **sebelum** Poin dipotong (cek kesehatan relay), atau order menjadi `pending`
     (tidak di-refund sampai statusnya pasti).
   - **Webhook masuk** dari Digiflazz langsung ke Vercel (lalu lintas masuk tidak
     kena whitelist) dan diverifikasi tanda tangannya. Opsional: tolak bila bukan
     dari IP Digiflazz `52.74.250.133`.
   - Kode relay ditaruh di repo ini (`relay/`) tapi di-deploy terpisah ke Kreatora.
   - Alternatif yang ditolak: memindah seluruh backend ke VPS (terlalu besar);
     layanan proxy IP statis berbayar (biaya tambahan + pihak ketiga memegang lalu lintas).
8. Tetap portabel (Postgres + HTTP), konsisten dengan prinsip proyek.

## 5. Model data (migrasi `0007_ppob_points.sql`)

Semua tabel memakai `business_id` (UUID toko dari server, dari JWT). Uang = bigint
rupiah; waktu = bigint epoch ms.

**`point_accounts`** — saldo per toko (cache ledger)
- `business_id` PK → businesses, `balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0)`,
  `updated_at`.

**`point_ledger`** — buku besar, append-only
- `id uuid`, `business_id`, `type` ∈ `topup | purchase | refund | adjustment`,
  `amount bigint` (bertanda: + masuk, − keluar; ≠ 0), `balance_after bigint >= 0`,
  `ref_type` (`topup|ppob_order|manual`), `ref_id uuid`, `note`, `created_by`
  (`app:<userId>` / `admin:<nama>` / `system`), `created_at`.
- UNIQUE `(type, ref_type, ref_id)` untuk `purchase`/`refund`/`topup` → mustahil
  ganda per order/top-up. Trigger menolak UPDATE/DELETE.

**`point_topups`** — permintaan isi Poin
- `id`, `business_id`, `amount` (nominal diminta), `unique_code` (1–999),
  `transfer_amount` (= amount + unique_code), `status` ∈
  `pending | paid | rejected | expired`, `requested_by`, `admin_note`,
  `confirmed_by`, `paid_at`, `expires_at` (24 jam), `created_at`, `updated_at`.
- Poin yang dikreditkan saat `paid` = `transfer_amount` (kode unik ikut jadi Poin
  — adil & mudah dicocokkan) **[keputusan saya]**.

**`ppob_products`** — katalog jual
- `id`, `provider` ∈ `digiflazz | manual`, `sku` (buyer_sku_code / kode manual),
  `category` ∈ `pulsa | data | pln`, `brand` (Telkomsel, XL, … / PLN),
  `name`, `description`, `cost_price` (modal dari penyedia / modal admin),
  `sell_price` (harga Poin untuk toko), `price_locked bool` (admin override,
  tak ditimpa sinkron), `provider_active bool`, `active bool`, `sort`,
  `synced_at`, `updated_at`. UNIQUE `(provider, sku)`.
- Harga jual default = modal + markup per kategori (env/pengaturan admin, mis.
  pulsa/data +Rp 500, PLN +Rp 1.500) **[keputusan saya]**; admin bisa override.

**`ppob_orders`** — satu baris per pembelian
- `id uuid` (dipakai juga sebagai `ref_id` ke Digiflazz), `business_id`,
  `user_ref` (id user lokal app yang menjual, info saja), `client_ref` (UNIQUE per
  toko — idempotensi), `product_id` + snapshot `sku`, `product_name`, `category`,
  `provider`, `customer_no` (no HP / no meter), `price` (Poin dipotong),
  `cost` (modal saat itu), `status` ∈
  `processing | pending | waiting_admin | success | failed`,
  `refunded bool`, `sn` (serial pulsa / **token listrik**), `pln_name`, `pln_info`
  (kWh/daya, opsional), `provider_rc`, `provider_message`, `notify_email`
  (opsional, email pembeli akhir), `last_checked_at`, `fulfilled_by`,
  `completed_at`, `created_at`, `updated_at`.

**`ppob_order_events`** — jejak audit per order (dibuat, dikirim ke penyedia,
balasan, webhook, cek status, token ditempel, refund, notifikasi terkirim/gagal).

**`app_config`** (kv kecil) — markup, rekening tujuan top-up, batas, saklar
`ppob_enabled` — bisa diubah admin tanpa deploy **[keputusan saya]**.

## 6. Top-up Poin (tahap 1: transfer + konfirmasi admin)

**[keputusan saya]** — payment gateway ditunda karena belum dipilih; alur ini
bisa jalan hari ini dan nanti diganti/ditambah gateway tanpa mengubah ledger.

1. Pemilik (app) → `POST /v1/points/topups {amount}` (min 20.000, maks 5.000.000).
2. Server membuat top-up `pending` dengan **kode unik** → balas instruksi:
   rekening/QRIS tujuan, **nominal transfer persis** (mis. 100.237), batas 24 jam.
3. Admin dinotifikasi (Telegram) "Top-up baru Rp100.237 — Warung Bu Tini".
4. Admin cek mutasi bank → di dashboard klik **Konfirmasi** → satu transaksi DB:
   top-up `paid` + ledger `topup +100.237` + saldo naik. Tombol **Tolak** bila
   tak ada dana masuk. Top-up `pending` > 24 jam ditandai `expired` saat dibaca.
5. App menampilkan status top-up & saldo baru.

## 7. Pembelian pulsa & data (otomatis, Digiflazz)

1. App: pilih kategori → masukkan nomor HP → server menampilkan produk sesuai
   operator (deteksi prefix nomor di server) → pilih nominal → konfirmasi.
2. `POST /v1/ppob/orders {clientRef, productId, customerNo, notifyEmail?}`.
3. **Satu transaksi DB**: cek `client_ref` (jika sudah ada → kembalikan order
   lama), insert order `processing`, `UPDATE point_accounts SET balance = balance
   − price WHERE business_id=? AND balance >= price` (0 baris → batal,
   `402/409 POIN_TIDAK_CUKUP`), insert ledger `purchase −price`.
4. Setelah commit, server memanggil Digiflazz (`ref_id = order.id`):
   - **Sukses** → order `success`, simpan `sn`.
   - **Gagal** → order `failed` + **refund** (ledger `refund +price`) dalam satu
     transaksi DB.
   - **Pending** / timeout / error jaringan → order `pending`; diselesaikan oleh
     webhook atau cek ulang (§4.5). **Tak pernah refund saat status belum pasti**
     (timeout ≠ gagal).
5. App menampilkan hasil (SN) dan bisa mencetak struk.

## 8. Pembelian token listrik (manual oleh admin)

1. App: masukkan **nomor meter** → (opsional) server cek nama pelanggan PLN
   (inquiry Digiflazz, bila tersedia) supaya tak salah meter → pilih nominal →
   isi **email penerima (opsional)** → konfirmasi.
2. Pemotongan Poin persis seperti §7.3; order langsung `waiting_admin`.
3. **Notifikasi admin** (Telegram bot ke chat/grup admin) **[keputusan saya:
   Telegram dulu — gratis & resmi; WA butuh layanan pihak ketiga berbayar, bisa
   ditambah lewat adaptor]**. Isi: toko, nominal, no meter, nama PLN, waktu, link
   langsung ke halaman order di dashboard.
4. Admin membeli token di tempat lain → buka link → **tempel token 20 digit**
   (divalidasi: 20 digit, boleh dengan spasi/strip) + opsional nama/kWh →
   **Simpan** → order `success`.
5. Sistem mengirim **email** "Token listrik Anda sudah tersedia" berisi token, no
   meter, nominal, ke: **email akun pemilik toko** + `notify_email` bila diisi
   **[interpretasi saya atas "email customer"]**. App juga menampilkan token
   (dari polling status / buka riwayat).
6. Bila tak bisa diproses (meter salah, PLN gangguan): admin klik **Gagalkan &
   kembalikan Poin** + alasan → `failed` + refund + email/notifikasi pemberitahuan.
7. **Pengingat**: order `waiting_admin` yang belum diproses > 30 menit dikirim
   ulang ke Telegram saat ada aktivitas (order baru / dashboard dibuka / cron
   harian) **[keputusan saya — tanpa worker latar]**. Badge "Perlu tindakan"
   di menu dashboard.

## 9. API untuk aplikasi (Bearer, konteks toko)

| Method | Path | Keterangan |
|---|---|---|
| GET | `/v1/points` | saldo + 20 mutasi terakhir |
| GET | `/v1/points/ledger?cursor=` | riwayat mutasi Poin |
| POST | `/v1/points/topups` | buat permintaan top-up → instruksi transfer |
| GET | `/v1/points/topups` | riwayat top-up & status |
| GET | `/v1/ppob/products?category=&customerNo=` | produk aktif (difilter operator bila nomor diberikan) |
| POST | `/v1/ppob/pln/inquiry` | cek nama pelanggan dari no meter (bila didukung) |
| POST | `/v1/ppob/orders` | beli (idempoten via `clientRef`) |
| GET | `/v1/ppob/orders/:id` | status (cek ulang ke penyedia bila pending lama) |
| GET | `/v1/ppob/orders?cursor=` | riwayat order |
| POST | `/v1/webhooks/digiflazz` | **tanpa Bearer**, diverifikasi tanda tangan |

Kode error baru: `POIN_TIDAK_CUKUP`, `PPOB_NONAKTIF`, `PRODUK_TIDAK_TERSEDIA`,
`NOMOR_TIDAK_VALID`. Respons tetap envelope standar.

Otorisasi: token cloud di app adalah milik **pemilik toko** (staf hanya punya PIN
lokal), jadi server memeriksa konteks toko; pembatasan "kasir boleh jual PPOB,
hanya pemilik boleh top-up" dilakukan di app lewat izin lokal baru
`ppobSell` & `pointTopup` **[keputusan saya]**.

## 10. Dashboard admin

- **Menu "PPOB"** (badge = order `waiting_admin` + top-up `pending`):
  - Tab **Perlu tindakan**: order token menunggu (form tempel token / gagalkan),
    top-up menunggu konfirmasi.
  - Tab **Semua order**: filter status/kategori/toko/tanggal; detail order dengan
    jejak event, tombol **Cek status** (Digiflazz) & **Refund manual** (hanya
    untuk order `failed` yang belum refund).
  - Tab **Top-up**: daftar & konfirmasi/tolak.
  - Tab **Produk**: tombol **Sinkron harga Digiflazz**, atur markup, override
    harga, aktif/nonaktif, kelola produk token manual (nominal & modal).
  - Kartu **Saldo deposit Digiflazz** + peringatan bila di bawah ambang.
- **Halaman toko → tab "Poin"**: saldo, ledger, riwayat order & top-up toko itu,
  **koreksi manual** (adjustment ± dengan catatan wajib; tercatat di ledger).
- Laporan PPOB ringkas: omzet Poin, modal, laba Sirko per periode.

## 11. Aplikasi Flutter (tahap terpisah setelah backend)

- Menu **PPOB** (online-only): kartu saldo Poin, tombol Top-up, Pulsa, Data,
  Token Listrik, Riwayat.
- Alur beli dengan konfirmasi jelas (harga Poin) + layar hasil (SN/token) + cetak
  struk + salin token.
- **Penjualan ke pembeli dicatat ke kasir** **[keputusan saya]**: setelah sukses,
  app membuat transaksi kasir berisi item non-stok "Pulsa Telkomsel 10rb" dengan
  harga jual yang ditentukan warung dan **modal = harga Poin**, supaya omzet &
  laba di laporan toko ikut benar. Butuh dukungan item tanpa produk/stok di kasir.
- Izin lokal baru `ppobSell` (default: owner, admin, cashier) & `pointTopup`
  (owner).

## 12. Integrasi Digiflazz (diverifikasi dari dokumentasi resmi, 2026-11-02)

Semua `POST https://api.digiflazz.com/v1/...`, JSON, respons dibungkus `data`.
Dipanggil **hanya oleh relay** (§4.7).

| Kebutuhan | Endpoint & body | `sign` |
|---|---|---|
| Saldo deposit | `/cek-saldo` `{cmd:"deposit", username, sign}` → `data.deposit` | `md5(username + apiKey + "depo")` |
| Daftar harga | `/price-list` `{cmd:"prepaid", username, sign, category?, brand?, type?, code?}` | `md5(username + apiKey + "pricelist")` |
| Beli / cek status | `/transaction` `{username, buyer_sku_code, customer_no, ref_id, sign, testing?, max_price?}` | `md5(username + apiKey + ref_id)` |
| Cek meter PLN | `/inquiry-pln` `{username, customer_no, sign}` → `name, meter_no, subscriber_id, segment_power` | `md5(username + apiKey + customer_no)` |

**Pemetaan status**: pakai field `status`. `Sukses` → `success` (simpan `sn`);
`Gagal` → `failed` + refund; `Pending` → `pending`. RC `99` (router issue) dan `03`
= pending, **bukan gagal**. Timeout/error jaringan ke relay = `pending`. RC `44`
(deposit Digiflazz kurang) → `failed` + refund + **alarm Telegram ke admin**.
RC `45` (IP) / `41` (signature) → `failed` + refund + alarm (salah konfigurasi).

**Aturan dari dokumentasi yang wajib dipatuhi:**
- Cek status = kirim ulang **`ref_id` yang sama**. **Jangan pernah** untuk order
  **> 90 hari**, karena Digiflazz akan membuat **transaksi baru**. Kode menolak cek
  ulang otomatis untuk order > 85 hari; sisanya ditangani manual.
- **Jangan cek status transaksi yang sama lebih dari 1× per menit** →
  `last_checked_at` membatasi (cek ulang saat dibaca hanya bila ≥ 60 detik).
- `ref_id` = `ppob_orders.id` (UUID), sehingga selalu unik (hindari RC 49).
- Daftar harga: maks **1× per 5 menit**. Disimpan di `ppob_products`, disinkron
  lewat tombol admin + cron harian; app tak pernah memanggil Digiflazz. Tipe
  `price`/`stock` bisa string atau angka → dinormalisasi.
- Produk dijual hanya bila `buyer_product_status && seller_product_status`.
  Hormati `start_cut_off`/`end_cut_off` (RC 58) → tampilkan "sedang cut-off".
- `max_price` = `cost_price` tersimpan (+ toleransi kecil) → bila harga modal naik
  diam-diam Digiflazz menolak (RC 69) → order gagal + refund, admin sinkron ulang.

**Webhook** (`POST /v1/webhooks/digiflazz`): header `X-Digiflazz-Event`
(`create|update`) dan `X-Hub-Signature: sha1=<hex>` = HMAC-SHA1(body mentah,
`DIGIFLAZZ_WEBHOOK_SECRET`). Verifikasi **constant-time atas body mentah**.
Payload `{data:{ref_id, status, sn, rc, message, price, ...}}`. Event `ping` dijawab
200. Pemrosesan idempoten: order yang sudah final diabaikan (tetap dicatat sebagai
event). Perilaku retry Digiflazz tidak didokumentasikan → selalu balas 200 cepat
setelah tercatat.

**Cek meter PLN** dipakai untuk **memvalidasi nomor meter token manual** (nama
pelanggan tampil sebelum bayar), walau tokennya dibeli manual, supaya tidak salah
meter. Ada batas rate (RC 86) → hasil di-cache per meter 24 jam. Bila gagal atau
kena limit, app tetap boleh lanjut dengan peringatan.

**Mode uji** (`testing: true`, SKU `xld10`): `087800001230` sukses,
`087800001232` gagal, `087800001233` pending → callback sukses, `087800001234`
pending → callback gagal. Tidak ada kasus uji untuk `inquiry-pln`. Whitelist IP
berlaku juga di mode development, jadi relay sudah harus ada sejak tahap uji.

## 13. Konfigurasi & rahasia (env Vercel)

Vercel: `PPOB_ENABLED`, `PPOB_RELAY_URL`, `RELAY_SECRET`,
`DIGIFLAZZ_WEBHOOK_SECRET`, `DIGIFLAZZ_TESTING` (true di non-produksi),
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`, `BREVO_API_KEY`, `MAIL_FROM`,
`PUBLIC_DASHBOARD_URL` (untuk link di notifikasi).
Relay (VPS Kreatora): `DIGIFLAZZ_USERNAME`, `DIGIFLAZZ_API_KEY`, `RELAY_SECRET`,
`PORT`. IP `151.243.222.93` di-whitelist di dashboard Digiflazz (mode dev & prod).
Tanpa kredensial → fitur
mati dengan rapi (`PPOB_NONAKTIF`), test memakai adaptor palsu.

## 14. Keputusan saya yang perlu Anda cek

1. Top-up tahap 1 = transfer bank/QRIS statis + konfirmasi admin (tanpa gateway).
2. Kode unik top-up ikut dikreditkan sebagai Poin.
3. Notifikasi admin via **Telegram** (WA menyusul lewat adaptor bila perlu).
4. Email via **Brevo** (API HTTP); token dikirim ke email pemilik toko + email
   pembeli bila diisi.
5. Markup default per kategori, bisa di-override per produk.
6. Penjualan PPOB dicatat sebagai transaksi kasir (tahap app).
7. Poin tidak kedaluwarsa; min top-up 20.000, maks 5.000.000.
8. Pengingat order token manual tanpa worker latar (dipicu aktivitas + cron harian).
9. **Relay Digiflazz di VPS Kreatora** (karena whitelist IP); kredensial Digiflazz
   hanya ada di relay, dan Vercel bicara ke relay dengan HMAC.
10. Cek nomor meter PLN via Digiflazz `inquiry-pln` sebelum order token manual.

**Yang perlu Anda siapkan (di luar kode):** akun Digiflazz (username, API key,
webhook secret) + whitelist IP Kreatora; saldo deposit Digiflazz; bot Telegram
(token + chat ID grup admin); akun Brevo + domain pengirim terverifikasi;
rekening/QRIS tujuan top-up; subdomain untuk relay.

## 15. Pengujian

- Unit: kalkulasi markup, deteksi operator, validasi token 20 digit, verifikasi
  tanda tangan webhook, mapping status Digiflazz.
- Contract (Postgres lokal, adaptor penyedia palsu): saldo kurang → ditolak tanpa
  baris; `clientRef` sama 2× → satu potongan; gagal → satu refund; pending →
  webhook sukses/gagal; webhook ganda → idempoten; ledger tak bisa di-UPDATE;
  saldo = Σ ledger; alur token manual (tempel → success → email terkirim di
  adaptor palsu; gagalkan → refund); top-up konfirmasi 2× → sekali kredit.
- Uji integrasi Digiflazz mode `testing` (4 nomor uji di §12) lewat relay sebelum produksi.
- Relay: test unit tanda tangan HMAC (tolak body yang diubah dan timestamp kedaluwarsa).

## 16. Urutan pembangunan

1. Migrasi + layanan ledger/Poin + top-up (API & dashboard) + tab Poin toko.
2. Relay Digiflazz (`relay/`) + deploy ke Kreatora + whitelist IP.
3. Katalog produk + sinkron harga Digiflazz + adaptor + order pulsa/data + webhook.
4. Token listrik manual + Telegram + email + menu PPOB dashboard.
5. Aplikasi Flutter (menu PPOB, top-up, beli, riwayat, catat ke kasir).
