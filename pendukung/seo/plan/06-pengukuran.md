# 06 · Pengukuran & laporan

Situs sengaja tanpa pelacak pihak ketiga. Sumber data: **Google Search Console** (dan Bing Webmaster),
**dashboard Sirko** (daftar tunggu, kontak, pendaftaran akun), dan klik WhatsApp (pesan masuk dengan teks
"saya dari halaman …" → tahu halaman asal).

## KPI
| KPI | Sumber | Frekuensi |
|---|---|---|
| Klik & impresi organik, CTR, posisi rata-rata | GSC → Kinerja | Mingguan |
| Jumlah halaman terindeks vs. di sitemap | GSC → Halaman | Mingguan |
| Kueri baru yang memberi impresi | GSC → Kinerja → Kueri (filter tanggal) | Mingguan |
| Daftar tunggu & pesan kontak | Dashboard → Website → Pesan masuk | Mingguan |
| Chat WhatsApp per halaman asal | WA Business (label per topik) | Mingguan |
| Akun terdaftar baru (setelah rilis) | Dashboard → Pengguna | Mingguan |
| Domain merujuk | GSC → Tautan | Bulanan |
| Core Web Vitals & PageSpeed mobile | GSC → Pengalaman, PageSpeed | Bulanan |

## Rutinitas mingguan (30 menit)
1. GSC Kinerja 28 hari: catat klik, impresi, CTR, posisi.
2. Kueri dengan impresi tinggi tapi CTR < 2% → perbaiki title/meta halaman itu.
3. Kueri di posisi 5–20 → masuk daftar "perbarui artikel".
4. Kueri yang belum punya halaman sendiri → usulan artikel baru (02-kalender-konten.md).
5. GSC Halaman: URL baru "tidak diindeks" → cek tautan internal & isi.

## Laporan bulanan (template)
```
Bulan: …
Klik: … (± …% dari bulan lalu)   Impresi: …   CTR: …   Posisi rata-rata: …
Halaman terindeks: … / … di sitemap
Top 5 halaman (klik): …
Top 10 kueri (klik/posisi): …
Kueri yang naik ke top 10: …
Konten terbit: … artikel, … halaman, … diperbarui
Domain merujuk baru: …
Konversi: daftar tunggu …, pesan kontak …, chat WA …, akun baru …
Rencana bulan depan: …
```
Simpan laporan sebagai `pendukung/seo/laporan/YYYY-MM.md`.
