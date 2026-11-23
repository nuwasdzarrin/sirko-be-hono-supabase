# ATM: aplikasi-kasir-grosir (page, 15 Des 2026)

Kata kunci fokus: **aplikasi kasir grosir dan eceran**. Niat: pemilik toko yang menjual eceran sekaligus grosir
mencari aplikasi yang otomatis memberi harga lebih murah untuk pembelian banyak, mencatat stok, belanja ke supplier,
dan utang.

## Amati: 3 hasil organik teratas (SERP 23 Nov 2026)

Posisi 2 (Shopee) dan 6 (Tokopedia) dilewati karena listing marketplace.

| # | URL | Kekuatan | Kelemahan |
|---|---|---|---|
| 1 | https://www.qasir.id/ | Landing ± 1.500–2.000 kata, harga jelas (Pro Rp699.000/12 bln, Pro Plus Rp1.199.000/12 bln), FAQ 10 butir, offline. | Harga grosir hanya satu baris di daftar fitur Pro Plus; tidak menjelaskan cara kerjanya; tidak ada contoh; kata "eceran" hampir tidak ada. |
| 2 | https://mekari.com/blog/aplikasi-kasir-warung-sembako-kelontong/ | Listicle 10 aplikasi dengan tabel (cocok untuk, fitur, harga), ± 1.800 kata. | Tidak menyebut harga grosir/eceran sama sekali; aplikasi luar negeri dengan harga USD; tanpa FAQ; tanpa contoh warung. |
| 3 | https://kasirmurah.com/ | Landing panjang (> 3.000 kata), kartu "Grosir & Agen", FAQ 13 butir, harga mulai Rp15rb/pengguna/bln. | "Harga bertingkat" hanya disebut sekilas tanpa contoh tingkatan/ambang jumlah; frasa "grosir dan eceran" tidak muncul utuh; banyak klaim generik. |

Tambahan (posisi 5, diamati sebagai pembanding terbaik):
https://kasirxpert.com/blog/aplikasi-kasir-grosir-dan-eceran — ± 1.400 kata, 5 tabel, contoh harga bertingkat dan
dus. Kelemahan: aturan tier tidak lengkap, banyak ajakan paket berbayar.

## Batasan fakta Sirko (dari brief + kode `web-app/src/pos/calc.ts`)

- Harga grosir bertingkat per produk: tiap tingkat = jumlah minimal (≥ 2) + harga per satuan. Di kasir, tingkat dengan
  jumlah minimal tertinggi yang terpenuhi otomatis menggantikan harga eceran untuk seluruh jumlah di baris itu.
- Pembelian dari supplier, hutang supplier, stok masuk, stok opname, kasbon pelanggan & cicilan, laporan laba.
- DILARANG: konversi satuan otomatis (dus → pcs). Satuan hanya label. Maka contoh "jual 1 dus" ditulis sebagai
  "ketik jumlah 40 pcs", dengan tingkat grosir mulai 40.

## Kerangka akhir

- Pembuka (jawaban langsung + CTA)
- ## Cara kerja harga grosir dan eceran di aplikasi kasir (tabel contoh tingkat harga, ilustrasi)
- ## Contoh satu nota grosir dan eceran (tabel nota, ilustrasi)
- ## Fitur Sirko untuk toko grosir dan eceran (daftar)
- ## Menjual per dus tanpa salah stok (batasan jujur: satuan = label)
- ## Langkah mengatur harga grosir di Sirko (bernomor) + CTA tengah
- ## Tips menentukan tingkat harga grosir (kesalahan umum)
- ## Tanya jawab (5) + CTA akhir

## Kenapa halaman kita lebih baik

- Menjelaskan **mekanisme** harga bertingkat (jumlah minimal, harga mana yang dipakai, berlaku per barang), bukan
  sekadar menyebut fitur.
- Dua tabel angka khas toko sembako (*ilustrasi*): tingkat harga dan contoh satu nota campuran grosir+eceran.
- Langkah bernomor mengatur harga grosir + tips/kesalahan umum (untung tingkat terendah harus tetap menutup modal).
- Jujur soal batasan (tanpa konversi satuan), sehingga tidak menjanjikan hal yang tidak ada.
- Harga grosir sudah ada di paket gratis, sedangkan Qasir menaruhnya di Pro Plus (Rp1.199.000/12 bln, dicek Nov 2026).
