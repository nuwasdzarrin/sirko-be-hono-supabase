# Spec: template buku hutang warung (cetak) — `/alat/template-buku-hutang`

Tayang bersama artikel `/blog/contoh-buku-hutang-warung` (2 Des 2026). Artikel menjanjikan isi di bawah ini; jangan dikurangi tanpa mengubah artikel.

## Tujuan

Halaman alat sederhana: pengguna melihat pratinjau lalu **mencetak / simpan PDF** (dialog cetak browser) template buku hutang pelanggan. Tanpa login. Tanpa input wajib.

## Output cetak

- Ukuran **A4 portrait** (210 × 297 mm), margin 12 mm, `@page { size: A4 portrait; margin: 12mm }`.
- Hitam-putih, aman untuk printer biasa (garis abu tua #444, tanpa blok warna penuh).
- Font sans-serif, isi 10–11 pt, judul 14 pt.
- Dua jenis halaman: **A. Halaman pelanggan** dan **B. Halaman rekap daftar pelanggan**.
- Tiap halaman dicetak di lembar sendiri (`break-after: page`).

## A. Halaman pelanggan

### Kepala halaman (header)

Baris isian (label + garis kosong untuk tulisan tangan):

| Field | Lebar kira-kira | Catatan |
|---|---|---|
| Nama pelanggan | 60% | |
| Hal. no. | 15% | kanan atas |
| No. HP | 45% | |
| Alamat / RT | 55% | |
| Batas kasbon: Rp | 45% | |
| Nama toko | 55% | opsional, boleh diisi dari form (lihat Opsi) |

Di bawahnya satu baris: **"Pindahan dari hal. ____ Sisa: Rp ________"**.

### Tabel (≈25 baris)

| Kolom | Lebar | Rata | Catatan |
|---|---|---|---|
| No | 7% | tengah | nomor 1–25 tercetak |
| Tanggal | 12% | tengah | kosong |
| Keterangan (barang / bayar) | 31% | kiri | kosong |
| Hutang (Rp) | 13% | kanan | kosong |
| Bayar (Rp) | 13% | kanan | kosong |
| Sisa (Rp) | 14% | kanan | kosong, garis tepi sedikit lebih tebal agar menonjol |
| Paraf | 10% | tengah | inisial/tanda tangan pelanggan |

- Header tabel diulang bila tabel terpotong (`thead { display: table-header-group }`), meski target 1 halaman.
- Tinggi baris ±7,5–8 mm agar nyaman ditulis tangan; jumlah baris disesuaikan agar header + tabel + footer muat **satu A4** (target 25, minimal 22).

### Kaki halaman (footer)

- Baris: **"Dipindah ke hal. ____ Sisa: Rp ________"**.
- Baris: **"Janji bayar: ______________________"**.
- Teks kecil (8 pt, abu): `Template gratis dari Sirko · sirkopos.com/alat/template-buku-hutang`. Tanpa logo besar.

## B. Halaman rekap daftar pelanggan

Judul: **Daftar Pelanggan Kasbon**. Baris isian di atas: "Per tanggal: ________".

| Kolom | Lebar | Catatan |
|---|---|---|
| No | 7% | 1–30 tercetak |
| Nama pelanggan | 35% | |
| Hal. | 10% | nomor halaman pelanggan |
| Sisa (Rp) | 18% | rata kanan |
| Terakhir bayar | 15% | |
| Ket. | 15% | mis. "lunas", "ingatkan" |

±30 baris, satu A4.

## Opsi di halaman web (sebelum cetak)

- Jumlah halaman pelanggan: input angka, default **10**, min 1, maks 100.
- Sertakan halaman rekap: centang, default **ya** (dicetak paling depan).
- Nama toko (opsional): teks, dicetak di header setiap halaman pelanggan.
- Nomor halaman otomatis: centang, default **ya** → kolom "Hal. no." terisi 1, 2, 3… sesuai urutan (rekap tidak diberi nomor pelanggan).
- Tombol **Cetak / Simpan PDF** → `window.print()`. Opsional tombol unduh PDF statis (10 halaman pelanggan + 1 rekap) untuk yang tidak bisa cetak dari HP.

## Isi halaman web (di luar area cetak, `@media print { display:none }`)

- H1: "Template Buku Hutang Warung Gratis (A4, Siap Cetak)".
- 3–4 langkah singkat cara pakai: atur jumlah halaman → cetak → jilid/map → satu pelanggan satu halaman.
- Tautan ke `/blog/contoh-buku-hutang-warung` (contoh isian, pindah saldo) dan `/aplikasi-kasbon`.
- Ajakan: "Ingin sisa hutang terhitung otomatis? [Coba Sirko gratis](/app/daftar)".

## Uji terima

- Chrome Android & desktop, Safari iPhone: pratinjau cetak = 1 halaman A4 per lembar, tidak ada baris terpotong, tidak ada halaman kosong ekstra.
- Simpan sebagai PDF menghasilkan jumlah halaman = jumlah halaman pelanggan (+1 bila rekap).
- Tanpa elemen navigasi/footer situs di hasil cetak.
