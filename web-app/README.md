# Sirko web app — `sirkopos.com/app`

Aplikasi kasir Sirko untuk komputer (desktop browser), setara dengan aplikasi HP. Dipakai pemilik,
kasir, dan karyawan. **Offline-first**: data toko disimpan di browser (IndexedDB) dan disinkronkan
ke server dengan protokol yang sama dengan aplikasi HP (`pendukung/kontrak-api/SYNC.md`).

## Keputusan (disepakati pemilik 2026-11-20)

| Topik | Keputusan |
|---|---|
| Teknologi | SolidJS 1.9 + `@solidjs/router` + **Dexie (IndexedDB)**, Vite. Tanpa RxDB. |
| Lokasi | Folder `web-app/` di repo backend; disajikan backend di `/app` (same-origin, tanpa CORS). |
| Paket | Semua paket bisa memakai web app; fitur & penguncian **sama persis** dengan aplikasi HP. |
| Keluar | **Menghapus semua data toko dari browser** (komputer bisa dipakai bersama). Disisakan email login terakhir & id perangkat. |
| Data | Fase 1–3 tarik penuh lewat `/v1/backup/pull`. Fase 4: riwayat transaksi di browser dibatasi; laporan lama diambil dari server (butuh endpoint laporan baru). |
| Tahap | 1 Fondasi · 2 Kasir harian · 3 Kelola toko · 4 Laporan & keuangan · 5 Pembelian/opname/PPOB/Juragan |

## Arsitektur

```
src/
  lib/        logika murni, SALINAN PERSIS dari aplikasi Flutter (diuji):
              crypto.ts       PIN karyawan (PBKDF2 60.000, `saltB64:hashB64` = PinHasher) & offlineAuth pemilik
              permissions.ts  PermissionResolver (owner penuh, default peran, custom JSON)
              plan.ts         PlanInfo + Entitlement (tenggang 3 hari, jam tak boleh mundur)
              api.ts          klien /v1 (amplop {data}/{error}), NetworkError ≠ penolakan server
  db/         db.ts      Dexie: DB global `sirko` + satu DB per toko `sirko-store-<id>`;
                         tabel = registry backend `src/db/backup-tables.ts` (alias @shared, satu sumber)
              ledger.ts  stok & saldo kas dihitung ulang dari ledger (SYNC §8.6)
  sync/       sync.ts    push baris `_dirty=1` (≤500/req), pull kursor + LWW, hitung ulang saldo
  session/    auth.ts    login online/offline, buat toko, pindah toko, brankas token PER TOKO
                         (refresh ditolak → hanya token toko itu yang dibuang; bukan logout massal)
  state.ts    state aplikasi (sesi, pengguna aktif pemilik/karyawan, online, jadwal sync)
  pages/      tampilan (masuk, buat toko, pilih pengguna/PIN, beranda, data & sinkron)
public/sw.js  service worker: aplikasi tetap terbuka tanpa internet (API tidak pernah di-cache)
```

Kolom lokal di tiap baris: `_dirty` (1 belum dikirim · 0 bersih · 2 ditolak server) dan `_syncError`.

## Menjalankan

```bash
cd web-app
npm install
npm run dev        # http://localhost:5180/app — API diteruskan ke backend lokal :47321
npm test           # unit test logika & sync (fake-indexeddb)
npm run build      # → ../public/app (disajikan backend di /app)
```

Produksi: `scripts/update.sh` membangun ulang otomatis bila `web-app/` atau `src/db/backup-tables.ts`
berubah. `public/app/` tidak di-commit.

## Status

- **Fase 1 (selesai):** masuk pemilik (online + offline), buat toko, pindah toko, ganti pengguna &
  PIN karyawan (Paket Juragan), hak akses per peran, sinkron otomatis (30 dtk / saat online / saat
  tab aktif), status sinkron & halaman Data, PWA offline, keluar = hapus data browser.
- **Fase 2 (selesai):** Kasir — cari/scan barcode (scanner USB = ketik + Enter), kategori, varian,
  grosir bertingkat, diskon item & transaksi, pajak/pembulatan toko, pelanggan (+ tambah cepat),
  bayar tunai/non-tunai/split + saran uang, kasbon/sebagian (hutang pelanggan), struk 58/80 mm via
  dialog cetak browser, Tunda (lokal perangkat), shift buka/tutup + rekap kas (wajib bila
  `require_open_bill`), keranjang awet saat muat ulang. Riwayat transaksi: rentang tanggal, cari,
  detail, cetak ulang, void. Pintasan: F2 cari · F4 pelanggan · F8 bayar · F9 tunda · Enter selesai.
  Logika di `src/pos/` (calc = salinan TransactionCalculator/PaymentCalculator/WholesalePricing,
  repo = commit/void/shift persis TransactionRepository/CreditRepository/BillRepository).
- **Fase 3 (selesai):** Produk & stok (tambah/ubah/hapus/pulihkan, barcode unik produk+varian,
  kategori & satuan, varian, harga grosir, sesuaikan stok, stok masuk, arus stok, filter stok
  menipis/kedaluwarsa/perlu harga; harga modal hanya untuk izin `viewCostProfit`) · Pelanggan &
  kasbon (data pelanggan, bayar hutang FIFO / per nota / per cicilan, jadwal cicilan, riwayat,
  pengingat WA) · Karyawan (peran + izin khusus, PIN ≥ 6 angka, username unik, admin terakhir
  dijaga; tambah butuh Paket Juragan) · Pengaturan (wajib shift, metode bayar, ganti password) ·
  Daftar akun, verifikasi email & lupa password di web. Logika di `src/manage/repo.ts`.
- Halaman dimuat terpisah (lazy); build menulis `assets.json` → service worker menyimpan SEMUA
  aset saat dipasang (URL SW memuat id build → tiap rilis terpasang ulang), jadi semua halaman
  bisa dibuka offline. Form memakai salinan data saat dibuka agar sinkron latar tak menimpa ketikan.
- Kolom JSON (`users.permissions`) dikirim sebagai array (sama dengan HP); pembacaan izin tahan
  string ter-encode berlapis.
- Batasan yang ikut dari aplikasi HP (SYNC §8.7): hutang pelanggan masih LWW; nomor invoice bisa
  kembar antar-perangkat yang aktif bersamaan; foto produk tidak tersinkron.
- Daftar akun & lupa password masih lewat aplikasi HP.
