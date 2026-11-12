# 05 · Google Play (ASO)

Untuk aplikasi, pencarian di dalam Play Store sering jadi sumber unduhan terbesar. Listing yang baik juga
menjadi tautan dan sinyal merek untuk sirkopos.com.

## Listing
| Elemen | Isi yang disarankan |
|---|---|
| Nama aplikasi (≤ 30) | **Sirko: Kasir Warung & Kasbon** |
| Deskripsi singkat (≤ 80) | Kasir gratis untuk warung & toko. Jalan tanpa internet, catat kasbon, jual token. |
| Deskripsi panjang | Buka dengan tagline, lalu manfaat per paragraf: kasir & barcode, stok, kasbon, laporan laba, offline, pulsa & token listrik, data aman. Sebut kata kunci secara alami (kasir warung, toko kelontong, kasbon, offline). Tutup dengan tautan sirkopos.com, kebijakan privasi, WhatsApp. |
| Ikon | `pendukung/brand/out/playstore-icon-512.png` |
| Feature graphic | `pendukung/brand/out/playstore-feature-graphic-1024x500.png` |
| Screenshot | 8 layar dari agen mobile (`public/site/img/app/`), tiap layar diberi judul manfaat singkat |
| Kategori | Bisnis |
| Kebijakan privasi | https://sirkopos.com/kebijakan-privasi |
| Hapus akun (Data safety) | https://sirkopos.com/hapus-akun |
| Email developer | halo@sirkopos.com |
| Situs | https://sirkopos.com |

Hindari kata "gratis", "terbaik", "#1" di grafis dan judul. Kebijakan metadata Play melarang klaim promosi
semacam itu di aset grafis.

## Setelah rilis
- Isi env `PLAY_STORE_URL` → tombol unduh situs & schema `downloadUrl` aktif otomatis.
- Minta ulasan secara wajar di dalam aplikasi (In-App Review API) setelah pengguna sukses 10 transaksi.
  Jangan memberi imbalan untuk ulasan.
- Balas semua ulasan ≤ 48 jam.
- Uji A/B ikon & screenshot dengan Store Listing Experiments.
