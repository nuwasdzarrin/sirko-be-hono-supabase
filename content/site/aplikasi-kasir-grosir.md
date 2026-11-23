---
kind: page
slug: aplikasi-kasir-grosir
title: Aplikasi Kasir Grosir dan Eceran dengan Harga Bertingkat Otomatis
meta_title: Aplikasi Kasir Grosir dan Eceran, Gratis | Sirko
meta_description: Aplikasi kasir grosir dan eceran gratis: harga grosir bertingkat otomatis per jumlah beli, stok, pembelian & hutang supplier, serta kasbon. Lihat contohnya.
focus_keyword: aplikasi kasir grosir dan eceran
excerpt: Cara kerja harga grosir bertingkat di kasir, contoh nota grosir dan eceran, dan fitur Sirko untuk toko yang melayani pembeli satuan sekaligus partai.
published_at: 2026-12-15T08:00:00+07:00
---
Sirko adalah aplikasi kasir grosir dan eceran untuk toko sembako, toko kelontong, dan agen. Setiap barang bisa punya **harga eceran dan beberapa tingkat harga grosir berdasarkan jumlah beli**. Saat kasir mengetik jumlahnya, harga yang tepat terpasang otomatis, stok berkurang, dan laba tercatat. Fitur ini sudah termasuk di paket Warung yang gratis untuk satu toko. [Coba Sirko gratis di browser](/app/daftar).

## Cara kerja harga grosir dan eceran di aplikasi kasir

Harga eceran adalah harga normal per satuan. Harga grosir adalah harga per satuan yang lebih murah bila pembeli mengambil **minimal sejumlah tertentu**. Satu barang bisa punya beberapa tingkat.

Contoh mi instan goreng (*ilustrasi*, harga beli Rp3.000 per bungkus):

| Jumlah beli | Harga per bungkus | Keterangan |
|---|---|---|
| 1–9 bungkus | Rp3.500 | Harga eceran |
| 10–39 bungkus | Rp3.300 | Grosir tingkat 1 (minimal 10) |
| 40 bungkus ke atas | Rp3.150 | Grosir tingkat 2 (minimal 40, setara 1 dus) |

Aturannya di Sirko:

- Setiap tingkat diisi **jumlah minimal** (2 atau lebih) dan **harga per satuan**.
- Di kasir, Sirko memakai tingkat dengan jumlah minimal tertinggi yang terpenuhi. Beli 12 bungkus → Rp3.300 per bungkus. Beli 45 → Rp3.150 per bungkus.
- Harga grosir berlaku untuk **seluruh jumlah** barang itu di nota, bukan hanya kelebihannya.
- Tingkat dihitung **per barang** di nota. Beli 5 mi goreng dan 5 mi soto berarti masing-masing 5, jadi keduanya tetap harga eceran.

Pembeli eceran dan pembeli partai dilayani di layar kasir yang sama. Kasir tidak perlu menghafal daftar harga.

## Contoh satu nota grosir dan eceran

Seorang pemilik warung kecil belanja di toko Anda (*ilustrasi*):

| Barang | Jumlah | Harga dipakai | Subtotal |
|---|---|---|---|
| Mi instan goreng | 40 bungkus | Rp3.150 (grosir tingkat 2) | Rp126.000 |
| Gula pasir 1 kg | 10 bungkus | Rp17.000 (grosir, minimal 10) | Rp170.000 |
| Minyak goreng 1 L | 3 pouch | Rp18.000 (eceran) | Rp54.000 |
| Kopi sachet | 5 sachet | Rp2.000 (eceran) | Rp10.000 |
| **Total** | | | **Rp360.000** |

Dalam satu nota ada barang yang kena harga grosir dan barang yang tetap eceran. Laba per barang dihitung dari harga beli yang tersimpan, sehingga Anda tahu untung transaksi partai ini walaupun marginnya lebih tipis. Bila pembeli langganan itu bayar belakangan, nota bisa langsung dijadikan **kasbon** atas namanya.

## Fitur Sirko untuk toko grosir dan eceran

- **Harga grosir bertingkat per jumlah beli** untuk setiap barang.
- **Stok otomatis.** Berkurang saat terjual, bertambah saat barang masuk. Ada peringatan stok menipis dan mendekati kedaluwarsa.
- **Pembelian dari supplier.** Catat belanja ke distributor; stok dan harga beli ikut tercatat.
- **Hutang ke supplier.** Belanja tempo tercatat sebagai hutang, lengkap dengan pembayarannya.
- **Kasbon pelanggan & cicilan.** Cocok untuk warung langganan yang membayar mingguan, dengan pengingat lewat WhatsApp. Lihat [aplikasi kasbon](/aplikasi-kasbon).
- **Stok opname** untuk mencocokkan stok di aplikasi dengan barang di gudang. Panduannya ada di [cara stok opname toko kelontong](/blog/cara-stok-opname-toko-kelontong).
- **Scan barcode** pakai kamera HP, webcam laptop, atau scanner USB/bluetooth.
- **Laporan penjualan, laba, arus stok, dan produk terlaris.**
- **Jalan tanpa internet.** Kasir, stok, dan kasbon tetap berjalan saat sinyal hilang, lalu tersinkron saat online.

## Menjual per dus tanpa salah stok

Di Sirko, satuan (pcs, bungkus, dus, kg) adalah **label** per barang. Sirko tidak mengubah satuan secara otomatis, misalnya dari dus ke bungkus. Agar stok tetap akurat, ada dua cara yang umum dipakai:

1. **Simpan stok dalam satuan terkecil** (misalnya bungkus), lalu buat tingkat grosir dengan jumlah minimal sama dengan isi dus. Pembeli ambil 1 dus mi isi 40 → kasir mengetik jumlah 40, harga grosir tingkat 2 langsung terpakai, stok berkurang 40 bungkus.
2. **Buat barang terpisah untuk kemasan besar** yang memang dijual utuh, misalnya beras karung 25 kg dan beras 5 kg, masing-masing dengan stok sendiri.

Cara pertama paling cocok untuk barang yang sering dijual eceran maupun per dus.

## Langkah mengatur harga grosir di Sirko

1. Buka [sirkopos.com/app](/app/daftar) di browser HP atau laptop, lalu daftar dan buat toko.
2. Tambahkan barang: scan barcode untuk mengambil nama dan kategori dari Katalog Umum, lalu isi harga beli dan harga eceran.
3. Di detail barang, tambahkan tingkat harga grosir: jumlah minimal dan harga per satuan. Ulangi untuk tingkat berikutnya.
4. Coba di kasir: masukkan barang, ubah jumlahnya, dan lihat harga berganti otomatis.
5. Catat pembelian dari supplier saat barang datang, supaya stok dan harga beli selalu terbaru.

[Daftar Sirko gratis](/app/daftar) dan atur harga grosir barang terlaris Anda hari ini.

## Tips menentukan tingkat harga grosir

- **Tingkat termurah tetap harus untung.** Harga grosir terendah harus di atas harga beli ditambah biaya seperti ongkos angkut dan kantong. Panduan hitungannya ada di [cara menentukan harga jual barang warung](/blog/cara-menentukan-harga-jual-barang-warung).
- **Pakai jumlah minimal yang masuk akal**, misalnya isi setengah dus dan satu dus, supaya mudah diingat pembeli.
- **Jangan terlalu banyak tingkat.** Dua sampai tiga tingkat biasanya cukup.
- **Perbarui saat harga beli naik.** Harga grosir yang lupa diubah adalah sumber rugi paling sering di toko partai.
- **Cek laporan laba per barang** setiap bulan untuk melihat apakah penjualan grosir benar-benar menguntungkan.

## Tanya jawab

### Apakah harga grosir bertingkat ada di paket gratis?

Ada. Harga grosir bertingkat per jumlah beli termasuk paket Warung yang gratis untuk satu toko, tanpa batas jumlah barang dan transaksi.

### Bagaimana aplikasi tahu harus memakai harga grosir atau eceran?

Dari jumlah yang diketik di kasir. Bila jumlahnya mencapai jumlah minimal sebuah tingkat, harga tingkat tertinggi yang terpenuhi dipakai otomatis untuk barang itu.

### Apakah Sirko bisa mengubah satuan dus menjadi bungkus otomatis?

Tidak. Satuan di Sirko hanya label. Simpan stok dalam satuan terkecil dan buat tingkat grosir sesuai isi dus, seperti contoh di atas.

### Bisakah mencatat utang ke supplier dan kasbon pelanggan sekaligus?

Bisa. Pembelian tempo tercatat sebagai hutang ke supplier, sedangkan pembeli yang belum bayar dicatat sebagai kasbon pelanggan, lengkap dengan cicilan.

### Apakah bisa dipakai di laptop untuk toko grosir?

Bisa. Sirko berjalan di browser laptop atau komputer, dan bisa dipakai bersamaan dengan HP dengan data yang sama.

Siap melayani pembeli eceran dan partai dengan harga yang selalu tepat? [Mulai pakai Sirko gratis di browser](/app/daftar), langsung dari HP atau laptop Anda.
