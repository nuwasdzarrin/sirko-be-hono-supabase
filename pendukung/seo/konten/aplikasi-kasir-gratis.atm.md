# ATM: aplikasi-kasir-gratis (update 29 Nov 2026)

Kata kunci fokus update: **aplikasi kasir gratis tanpa watermark**. Pendukung: "aplikasi kasir gratis tanpa biaya
bulanan", "aplikasi kasir gratis selamanya". Halaman tetap `kind: page`, slug & published_at tidak berubah.

## Amati: 3 hasil organik teratas (SERP 23 Nov 2026)

`glints.com/id/lowongan/aplikasi-kasir/` (posisi 3) menolak WebFetch (403), jadi diganti hasil berikutnya yang
artikel. `hitpayapp.com/blog/sistem-aplikasi-pos-gratis-di-indonesia` (posisi 4) 404, jadi diambil posisi 5.

| # | URL | Kekuatan | Kelemahan |
|---|---|---|---|
| 1 | https://kasirpintar.co.id/aplikasi-kasir-gratis | H1 tegas "Aplikasi Kasir Gratis Selamanya", ± 450 kata isi, fitur kasir, pembayaran digital, kasbon. | Batasan versi Free (watermark struk, 1 pengguna, 1.000 barang) tidak disebut di halaman ini; baru ada di /harga. Tanpa tabel, tanpa FAQ. |
| 2 | https://loyverse.com/id | H1 "Gratis Aplikasi Kasir & Manajemen Stok", FAQ 5 butir yang ringkas, fitur stok & multi-toko. | Biaya tambahan (karyawan, riwayat penjualan penuh, stok lanjutan) hanya di halaman harga, dalam USD. Tidak bahas kasbon/PPOB, tidak ada konteks warung. |
| 3 | https://accurate.id/aplikasi-kasir/rekomendasi-aplikasi-kasir-gratis/ | 6 aplikasi, struktur H2 "kekurangan aplikasi kasir gratis", diperbarui Sep 2026. | Tidak ada harga/batasan konkret, tidak bahas watermark atau biaya bulanan, Accurate POS (uji coba 30 hari) ditaruh pertama, tanpa tabel & FAQ. |

Niat pencari: memastikan aplikasi kasir benar-benar gratis, tanpa jebakan (watermark di struk, batas transaksi,
masa coba yang tiba-tiba berbayar, biaya bulanan).

## Fakta pesaing yang dipakai (dicek 23 Nov 2026)

| Aplikasi | Fakta | Sumber |
|---|---|---|
| Kasir Pintar Free | Gratis; struk dengan watermark; single user; barang hingga 1.000; 3 laporan standar; transaksi tidak terbatas tetapi yang ditampilkan 1.000 data terbaru. Pro Rp666.000/tahun. | kasirpintar.co.id/harga |
| Qasir | Tidak ada paket gratis permanen. Uji coba 7 hari (sekali). Pro Rp699.000/12 bulan, Pro Plus Rp1.199.000/12 bulan, belum termasuk pajak. | qasir.id, qasir.id/qasir-pro |
| Pawoon Free | Gratis; 7 transaksi/hari; satu outlet; input produk terbatas. Pro Rp299rb/outlet/bulan. | pawoon.com/harga (diambil via curl, WebFetch 403) |
| Loyverse | Kasir gratis; analitik penjualan 31 hari terakhir; add-on: riwayat penjualan tanpa batas US$9/bln per toko, manajemen karyawan US$5/bln per karyawan, stok lanjutan US$25/bln per toko (belum pajak). | loyverse.com/id/pricing |
| iREAP POS Lite | Gratis; 1 pengguna, 1 toko, 1 perangkat; offline dengan sinkron manual; tanpa ekspor. | ireappos.com |

Tidak bisa diverifikasi (tidak dipakai): "Qasir Free riwayat 30 hari" (hanya ada di blog pihak ketiga; situs resmi
tidak lagi punya paket gratis), watermark struk Loyverse/Pawoon/iREAP (tidak disebut di halaman resmi).

Sirko: dicek di kode `web-app/src/pos/receipt.tsx`. Struk tidak memuat merek Sirko; teks penutup bawaan "Terima kasih".

## Kerangka akhir

- Pembuka (jawab langsung: gratis selamanya, tanpa watermark, tanpa biaya bulanan)
- ## Apa saja yang gratis di aplikasi kasir Sirko (tabel, dipertahankan)
- ## Batasan versi gratis aplikasi kasir lain (BARU: tabel 6 baris + catatan sumber + kelebihan pesaing)
- ## Aplikasi kasir gratis tanpa watermark: kenapa penting (BARU, singkat)
- ## Kapan perlu paket berbayar (Juragan) (dipertahankan)
- ## Apakah ada biaya tersembunyi? (dipertahankan)
- ## Kenapa Sirko bisa gratis (dipertahankan)
- ## Cara mulai memakai Sirko gratis (dipertahankan)
- ## Tanya jawab (+ watermark, + biaya bulanan)

## Kenapa halaman kita lebih baik

- Satu-satunya dari ketiganya yang menaruh **tabel batasan versi gratis** beberapa aplikasi sekaligus, dengan sumber
  resmi dan tanggal cek.
- Menjawab langsung dua kekhawatiran yang tidak dijawab pesaing: **watermark di struk** dan **biaya bulanan**.
- Adil: mengakui kelebihan pesaing (Kasir Pintar punya aplikasi Android/iOS/Windows; Loyverse multi-toko gratis;
  iREAP Lite jalan offline penuh).
- Jelas memisahkan yang gratis (aplikasi) dan yang bukan (modal pulsa/token).
- FAQ 5 butir (batas brief) menjawab sisa pertanyaan: gratis selamanya (+ data saat berhenti langganan), watermark,
  biaya bulanan, batas transaksi, offline.
