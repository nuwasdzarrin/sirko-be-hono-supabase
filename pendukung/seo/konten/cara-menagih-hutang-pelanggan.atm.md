# ATM — cara-menagih-hutang-pelanggan

- Kata kunci fokus: **cara menagih hutang pelanggan** (sekunder: kata-kata menagih hutang yang sopan, contoh chat menagih hutang WhatsApp, menagih kasbon warung)
- Terbit: 22 Des 2026 · kategori Panduan Warung · penulis C
- Niat pencari: informasional-praktis. Ingin **kalimat siap pakai** dan langkah yang tidak merusak hubungan. Konteks kita: kasbon warung (tetangga, langganan), bukan invoice B2B.
- Hindari kanibalisasi dengan `/blog/cara-mencatat-hutang-pelanggan-warung` (punya bagian singkat "cara menagih" 5 poin). Artikel ini memperdalam: naskah lisan & WA, tahapan per waktu, cicilan, pencegahan. Tautkan balik ke artikel mencatat.

## Amati: 3 pesaing (SERP Google ID, 23 Nov 2026)

| # | URL | Struktur & panjang | Kekuatan | Kelemahan |
|---|---|---|---|---|
| 1 | https://pegadaian.co.id/artikel/keuangan/cara-menagih-utang | 4 H2 (cara sopan 6 H3, jika menghindar 4 H3, contoh kalimat, promosi gadai); ±1.100 kata; tanpa tabel/FAQ. Agu 2026 | Empatik; ada contoh kalimat; urutan chat → telepon → perantara → keluarga → hukum; dokumentasi komunikasi | Tidak ada naskah WhatsApp spesifik; tanpa jadwal cicilan tertulis; tanpa FAQ; tidak membahas hutang kecil/informal seperti kasbon; bagian promosi bercampur sudut pandang peminjam |
| 2 | https://www.paper.id/blog/tips-bisnis/cara-menagih-hutang-ke-customer-yang-sopan/ | 5 bagian (telepon, cek tagihan, jatuh tempo, humor, tegas); ±650 kata. Mar 2023 | Urutan halus → tegas; contoh kalimat pendek; jalur hukum disebut pilihan terakhir | Konteks invoice B2B; tanpa jarak waktu antar-tahap; tanpa cicilan; tanpa pencatatan; basi (2023) |
| 3 | https://penerbitdeepublish.com/netpromoter/cara-menagih-pembayaran-ke-customer/ | 5 H2 (pentingnya, persiapan, 9 langkah, contoh kata, jika tak membayar 8 H3); ±2.100 kata; tanpa tabel/FAQ. Mei 2025 | Paling lengkap; persiapan sebelum menagih; opsi solusi (jadwal ulang, cicilan); 5 contoh pesan | Untuk perusahaan (faktur pajak, pimpinan, debt collector); menyarankan pengumuman publik & kunjungan tanpa membahas risiko hubungan tetangga; tanpa tabel/FAQ |

## Tiru (subtopik wajib)

- Prinsip menagih sopan (pribadi, waktu tepat, tanpa emosi).
- Persiapan: data hutang yang jelas.
- Contoh kalimat menagih.
- Tahapan eskalasi dari halus ke tegas, termasuk saat pelanggan menghindar.
- Solusi: cicilan / jadwal ulang.
- Dokumentasi; jalur hukum sebagai pilihan terakhir.

## Modifikasi

1. **Naskah siap pakai** dipisah: lisan di warung vs pesan WhatsApp, per tahap (pengingat ringan, jatuh tempo, terlambat, terakhir), plus balasan untuk alasan umum.
2. **Tabel tahapan dengan jarak waktu** (hari ke-0, +7, +14, +30, >60) — tidak ada di pesaing.
3. **Konteks warung**: tetangga/RT, menagih di depan pembeli lain, menghentikan kasbon baru tapi tetap melayani tunai, mediasi lewat RT, jangan unggah nama di medsos.
4. **Cicilan dengan contoh angka** (*ilustrasi*) & cara mencatatnya.
5. **Pencegahan**: batas kasbon, aturan tertulis, kapan menolak kasbon.
6. **Kesalahan umum** + **FAQ**.

## Kerangka akhir

- Pembuka (jawab langsung + kata kunci)
- ## Siapkan dulu sebelum menagih (catatan, angka pasti)
- ## Cara menagih hutang pelanggan langkah demi langkah (tabel tahapan + uraian bernomor)
- ## Contoh kalimat menagih secara langsung
- ## Contoh pesan WhatsApp untuk menagih kasbon (4 tahap)
- ## Menjawab alasan yang sering muncul (tabel)
- ## Tawarkan cicilan bila pelanggan kesulitan (contoh jadwal)
- ## Kalau pelanggan menghindar
- ## Yang sebaiknya tidak dilakukan
- ## Cegah kasbon macet sejak awal
- ## Bantuan dari aplikasi kasbon
- ## Tanya jawab (5)
- Penutup + CTA

## Tautan internal

- Fitur: `/aplikasi-kasbon`
- Artikel: `/blog/cara-mencatat-hutang-pelanggan-warung`, `/blog/contoh-buku-hutang-warung` (terbit 2 Des)
- CTA: `/app/daftar`

## Fakta Sirko yang dipakai (dicek di kode `web-app/src/pages/pelanggan.tsx`, `manage/repo.ts`)

- Tombol WhatsApp di halaman pelanggan membuka WhatsApp dengan pesan terisi: "Halo <nama>, mengingatkan sisa kasbon Anda <Rp>. Terima kasih." (pemilik yang menekan kirim; pesan bisa diubah sebelum dikirim).
- Jadwal cicilan: hutang dibagi rata ke beberapa cicilan (sisa pembagian di cicilan terakhir), status lunas / lewat jatuh tempo / menunggu; bisa dijadwal ulang selama belum ada angsuran terbayar.

## Kenapa artikel kita lebih baik

- Satu-satunya yang khusus kasbon warung (tetangga, langganan), bukan invoice perusahaan.
- Naskah lisan + WhatsApp per tahap yang bisa langsung disalin, plus jawaban untuk alasan umum.
- Tabel tahapan dengan jarak waktu yang jelas.
- Contoh jadwal cicilan berangka dan cara mencatatnya.
- Bagian pencegahan, larangan (mempermalukan, ancaman), dan FAQ.

## Prompt sampul (Gemini)

```
Flat warm vector illustration, 1200x630, cream background. Friendly conversation at the counter of a small Indonesian warung: a smiling Indonesian man shop owner in his 40s, wearing a peci and casual shirt, shows an Android phone screen with an abstract chat bubble to a female neighbor customer in a simple hijab, who nods politely while holding her wallet. Shelves behind with snacks, rice packs, cooking oil and sachet strips. Relaxed, respectful mood, no tension. Main colors deep green #0F7B5F and warm orange #FF9F1C, soft shadows. All people and objects on the right two-thirds; the left third is empty cream space. No text, no letters, no numbers, no logos anywhere.
```
