# Brief penulisan konten SEO Sirko (rencana 30 hari, 24 Nov – 23 Des 2026)

Dipakai semua penulis (manusia/AI). Rencana induk: `pendukung/seo/plan/09-rencana-30-hari-web-app.md`.
Data 3–6 hasil teratas Google Indonesia per kata kunci (diambil 23 Nov 2026):
`pendukung/seo/konten/serp-google-2026-11-23.json`.

## Metode: Amati → Tiru → Modifikasi (ATM)

Untuk setiap kata kunci:
1. **Amati** 3 hasil organik teratas di `serp-google-2026-11-23.json`. Lewati hasil yang bukan artikel,
   misalnya listing marketplace, App Store, atau PDF, lalu ambil berikutnya. Buka (WebFetch) dan catat:
   - niat pencari;
   - struktur H2/H3;
   - perkiraan jumlah kata;
   - tabel, gambar, dan FAQ yang dipakai;
   - apa yang mereka jawab baik;
   - **apa yang kurang**: tidak menjawab, basi, tanpa contoh angka, tanpa tabel, terlalu umum, atau tidak
     untuk warung.
2. **Tiru** cakupan topik yang memang dibutuhkan pencari. Semua subtopik penting dari ketiganya harus ada.
3. **Modifikasi** menjadi lebih baik. Wajib minimal 3 dari daftar ini:
   - lebih lengkap;
   - tabel perbandingan/ringkasan;
   - contoh angka khas warung (ditandai *ilustrasi*);
   - langkah bernomor;
   - template/checklist;
   - kesalahan umum;
   - FAQ yang menjawab sisa pertanyaan;
   - lebih mudah dibaca (paragraf pendek, subjudul jelas, jawaban langsung di paragraf pertama).
4. Simpan catatan analisis di `pendukung/seo/konten/<slug>.atm.md`, berisi:
   - tabel 3 pesaing (URL, kekuatan, kelemahan);
   - kerangka akhir;
   - "kenapa artikel kita lebih baik" (poin konkret);
   - **prompt sampul** untuk Gemini (lihat §Sampul).

## Pembaca & nada

- Pemilik warung/toko kelontong/grosir usia 30–55, membaca di HP Android. Sapaan **"Anda"**, bahasa
  Indonesia sehari-hari yang baku, kalimat pendek, tanpa jargon (atau jelaskan jargon sekali).
- **Jujur.** Tanpa testimoni, statistik, atau kutipan karangan. Contoh angka diberi label *ilustrasi*.
  Fakta pesaing (harga, batasan, tanggal tutup) wajib bersumber + ditulis "(dicek November 2026)". Akui
  kelebihan pesaing; jangan menjelekkan merek.
- Paragraf pertama menjawab pertanyaan secara langsung dan memuat kata kunci fokus.

## Format file

File: `content/site/<slug>.md`. Contoh lengkap: `content/site/cara-menentukan-harga-jual-barang-warung.md`.

```
---
kind: post                # artikel blog → /blog/<slug>;  halaman jualan (landing) → kind: page → /<slug>
slug: <slug>
title: <judul H1, ≤ 70 kar.>
meta_title: <≤ 60 kar., memuat kata kunci>
meta_description: <120–160 kar., memuat kata kunci, ajakan halus>
focus_keyword: <kata kunci fokus>
excerpt: <1–2 kalimat, ≤ 300 kar.>
category: <Keuangan Toko | Panduan Warung | Pulsa & PPOB | Tips Sirko>   # khusus post
tags: [a, b, c]                                                         # khusus post, 3–5, huruf kecil
cover: https://media.sirkopos.com/prod/site/blog/<slug>.webp            # khusus post; file di R2 (.webp ≤100 KB, -600.webp, .jpg = og:image)
cover_alt: <deskripsi gambar sampul, bahasa Indonesia>
published_at: <YYYY-MM-DD>T08:00:00+07:00                               # dari jadwal di bawah
---
<isi Markdown>
```

- Panjang: artikel **1.200–2.000 kata**. Landing **800–1.300 kata**. Lebih panjang hanya bila memang lebih
  berguna.
- Heading isi dimulai `##` (H1 = title). Kata kunci fokus muncul di paragraf pertama dan minimal satu `##`.
- Tabel Markdown (GFM) boleh dan dianjurkan. Gambar di isi: jangan (sampul saja).
- Wajib diakhiri `## Tanya jawab` dengan 3–5 `###` pertanyaan + paragraf jawaban (→ schema FAQ otomatis).
- Kalimat penutup = ajakan ke web app.

## Ajakan (CTA) & tautan

- Tujuan utama semua ajakan: **`/app/daftar`** (daftar & langsung pakai Sirko di browser). Contoh:
  `[Coba Sirko gratis di browser](/app/daftar)`. Penanda asal (`?dari=`) ditambahkan otomatis oleh situs.
  Jangan tulis sendiri.
- Landing: ajakan di paragraf pembuka, tengah, dan akhir. Artikel: satu ajakan lembut di tengah (bila
  relevan) + penutup. Kotak ajakan di akhir artikel juga muncul otomatis.
- Tautan internal: 1 halaman fitur + 2 artikel. **Hanya ke URL yang sudah tayang saat konten terbit**:
  - Sudah tayang: `/`, `/#harga`, `/aplikasi-kasir-warung`, `/aplikasi-kasir-offline`, `/aplikasi-kasbon`,
    `/jualan-pulsa-token-listrik`, `/aplikasi-kasir-gratis`, `/tentang`,
    `/blog/cara-mencatat-hutang-pelanggan-warung`, `/blog/cara-menghitung-laba-toko-kelontong`,
    `/blog/untung-jualan-token-listrik-di-warung`, `/blog/modal-buka-warung-sembako`,
    `/blog/cara-menentukan-harga-jual-barang-warung`.
  - Plus konten di jadwal bawah yang **terbit lebih awal** dari konten yang sedang ditulis.
- Tautan keluar (sumber fakta) boleh, secukupnya, ke halaman resmi atau berita.

## Fakta Sirko yang BOLEH dipakai (per 24 Nov 2026)

**Platform & harga**
- Sirko = aplikasi kasir untuk usaha **barang fisik & PPOB**: warung, toko kelontong, sembako, grosir,
  minimarket, toko bangunan, toko pertanian. **Bukan** untuk kafe/resto/warung makan (itu Kasirnesia,
  produk saudara; jangan dibahas kecuali relevan).
- Dipakai **di browser** HP Android, iPhone, tablet, laptop/komputer (Chrome, Edge, Safari, Firefox) di
  **sirkopos.com/app**, tanpa download. Bisa "Tambahkan ke layar utama" agar terbuka seperti aplikasi.
  **Aplikasi Android sedang menuju Google Play** (belum tersedia; jangan beri tautan Play Store).
- **Paket Warung: Rp0 selamanya** untuk 1 toko. Isi: kasir, stok, scan barcode, kasbon & cicilan,
  laporan penjualan & laba, pulsa/data/token, cadangan data otomatis. Tanpa batas jumlah transaksi atau
  produk.
- **Paket Juragan: Rp49.000/bulan atau Rp499.000/tahun**: akun karyawan (masuk dengan PIN, tanpa akses
  laba & modal), ekspor laporan Excel & PDF, logo toko di struk, sampai 3 toko (laporan gabungan, salin
  produk, kirim stok antar-toko).

**Kasir & stok**
- Cari barang, **scan barcode/QR pakai kamera HP atau webcam laptop** (izinkan kamera di browser), atau
  pakai scanner barcode USB/bluetooth. Diskon per item & per nota, pajak & pembulatan, kembalian otomatis,
  bayar tunai/QRIS/transfer/debit/e-wallet. Metode bayar hanya **dicatat**; QRIS bukan payment gateway.
  Bayar sebagian dengan beberapa metode (split). Tunda transaksi. Shift kasir (buka/tutup + rekap kas).
- Struk: di browser dicetak lewat dialog cetak ke printer thermal 58/80 mm. Di aplikasi Android, printer
  struk bluetooth.
- **Katalog Umum 2.000+ produk umum Indonesia lengkap dengan foto**, bisa dicari nama/merek/barcode atau
  di-scan. Scan barang baru → nama, kategori, satuan terisi; harga diisi sendiri. Di browser, katalog
  diunduh sekali (butuh internet), lalu bisa dicari tanpa sinyal. Pengguna bisa mengusulkan produk ke
  katalog (ditinjau admin).
- Stok otomatis (berkurang saat terjual, bertambah saat stok masuk/pembelian), varian produk,
  **harga grosir bertingkat per jumlah beli**, peringatan stok menipis & kedaluwarsa, stok opname, arus
  stok, pembelian dari supplier, hutang supplier.

**Kasbon, kas & laporan**
- Kasbon/hutang pelanggan: dari kasir (bayar sebagian/penuh jadi hutang), bayar hutang, jadwal cicilan,
  riwayat, pengingat lewat WhatsApp.
- Kas & dompet (tunai/bank/e-wallet), uang masuk/keluar, transfer antar-dompet.
- Laporan: penjualan, laba (pendapatan − modal tersimpan per item), arus kas, arus stok, produk terlaris;
  rentang tanggal; grafik omzet harian di Beranda.

**Offline & data**
- Kasir, stok, kasbon jalan **tanpa internet**. Masuk pertama kali butuh internet. Data dicadangkan &
  disinkronkan otomatis saat online, bisa dipakai di HP & laptop sekaligus (data sama). Ganti perangkat →
  masuk lagi, data kembali. Di browser, Keluar menghapus data dari browser itu (data di server aman).

**PPOB (butuh internet)**
- Jual **pulsa, paket data, token listrik PLN** dari layar kasir, di nota yang sama dengan barang.
  Modal dibayar dengan **Poin Sirko**, diisi lewat transfer bank atau QRIS (dikonfirmasi admin). Poin
  tidak bisa ditarik tunai.
- Untung diatur sendiri per kategori. Bawaannya Rp2.000/transaksi, harga dibulatkan ke atas kelipatan
  Rp500 (bisa 100/500/1.000).
- Token listrik: cek nama pelanggan dari nomor meter sebelum beli. Gagal → Poin kembali otomatis.

## JANGAN diklaim

- Konversi satuan otomatis (dus → renceng → pcs). Satuan hanya label per produk.
- Foto katalog otomatis menjadi foto produk toko.
- Katalog tersedia offline sebelum diunduh sekali.
- Integrasi pembayaran QRIS/EDC otomatis, marketplace, akuntansi pajak, ekspor e-Faktur.
- Aplikasi iOS di App Store, aplikasi Windows yang di-install, tersedia di Google Play (belum).
- Jumlah pengguna, rating, testimoni, "terbaik/no. 1".
- Karyawan atau ekspor di paket gratis (itu Juragan).

## Jadwal terbit (published_at = tanggal 08.00 WIB)

| Tgl | kind | slug | Kata kunci fokus | Penulis |
|---|---|---|---|---|
| 24 Nov | page | aplikasi-kasir-online | aplikasi kasir online gratis | A |
| 25 Nov | page | pengganti-mitra-tokopedia | aplikasi pengganti mitra tokopedia | A |
| 26 Nov | post | cara-pasang-sirko-tanpa-play-store | cara menambahkan web ke layar utama (pasang Sirko di HP tanpa Play Store) | C |
| 27 Nov | page | aplikasi-kasir-laptop | aplikasi kasir gratis untuk laptop | A |
| 28 Nov | post | pembukuan-warung-sembako | pembukuan warung sembako | C |
| 29 Nov | (update) | aplikasi-kasir-gratis | aplikasi kasir gratis tanpa watermark (bagian tabel batasan versi gratis) | B |
| 1 Des | page | aplikasi-kasir-iphone | aplikasi kasir iphone gratis | A |
| 2 Des | post | contoh-buku-hutang-warung | buku hutang warung | C |
| 4 Des | post | cara-jualan-pulsa-di-warung | cara jualan pulsa di warung | D |
| 6 Des | post | qasir-vs-kasir-pintar | qasir vs kasir pintar | B |
| 8 Des | page | alat/kalkulator-laba-warung | kalkulator laba warung | (dev) |
| 9 Des | post | pengganti-bukukas-dan-alternatif-bukuwarung | pengganti bukukas | B |
| 11 Des | post | cara-stok-opname-toko-kelontong | cara stok opname toko kelontong | D |
| 13 Des | post | apa-itu-ppob | apa itu ppob | D |
| 15 Des | page | aplikasi-kasir-grosir | aplikasi kasir grosir dan eceran | B |
| 16 Des | post | aplikasi-kasir-toko-sembako | aplikasi kasir toko sembako | B |
| 18 Des | post | cara-menghitung-hpp-toko-kelontong | cara menghitung hpp toko kelontong | E |
| 20 Des | post | barang-terlaris-warung-sembako | barang terlaris warung sembako | E |
| 22 Des | post | cara-menagih-hutang-pelanggan | cara menagih hutang pelanggan | C |

Catatan:
- Template buku hutang gratis (untuk artikel 2 Des) disediakan di `/alat/template-buku-hutang`. Halaman itu
  tayang bersama artikel, jadi boleh ditautkan dari artikel tersebut.
- Kalkulator laba tayang 8 Des. Konten yang terbit setelahnya boleh menautkan `/alat/kalkulator-laba-warung`.

## Sampul (khusus post)

1200×630, ilustrasi flat hangat, gaya sama dengan sampul yang ada (contoh:
`public/site/img/blog/modal-buka-warung-sembako.jpg`). Ciri-cirinya:
- adegan warung/toko Indonesia;
- warna utama hijau `#0F7B5F` & oranye `#FF9F1C`, latar krem;
- orang Indonesia;
- **tanpa teks/tulisan dan tanpa logo**;
- area kosong di kiri.

Tulis prompt sampul (bahasa Inggris) di file `.atm.md`. Gambar dibuat terpisah.
