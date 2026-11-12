# 03 · SEO teknis

## Sudah terpasang (jangan dirusak saat mengubah kode)
- Canonical ke https://sirkopos.com, `www` & host lama → 301, huruf besar → 301, garis miring akhir → 301.
- Sitemap dinamis `/sitemap.xml` (lastmod + gambar), `robots.txt`, RSS `/feed.xml`, `/llms.txt`, manifest.
- Schema: Organization (legalName, contactPoint email & WA), WebSite, SoftwareApplication (harga),
  FAQPage otomatis dari "## Tanya jawab", BlogPosting, BreadcrumbList, CollectionPage, WebPage, ContactPage.
- Slug berubah → 301 otomatis; konten dihapus → 410 / 301 pilihan; draf & terjadwal tidak bocor.
- Kinerja: HTML server-side tanpa framework JS, font lokal 27 KB + preload, gambar JPG + srcset 600/1200,
  gzip, cache header, CSP hash (tanpa `unsafe-inline` skrip), HSTS.
- Aksesibilitas WCAG AA: axe-core 0 pelanggaran (latar teks solid, kontras ≥ 4,5:1).
- `X-Robots-Tag: noindex` untuk dashboard; preview draf noindex & no-store.

## Pekerjaan teknis berikutnya
| Prioritas | Pekerjaan | Pemilik |
|---|---|---|
| Segera | GSC: kirim `https://sirkopos.com/sitemap.xml` di menu Sitemaps; URL Inspection → "Request indexing" untuk beranda + 4 halaman fitur | Pemilik |
| Segera | GSC: tambahkan juga properti **Domain** (DNS) bila yang terdaftar baru URL-prefix | Pemilik |
| Minggu 1 | Bing Webmaster Tools: impor dari GSC (Bing juga memasok ChatGPT/Copilot search) | Pemilik |
| Minggu 1 | IndexNow: kirim URL baru/berubah otomatis ke Bing/Yandex saat terbit di CMS | Claude |
| Minggu 2 | Halaman `/alat/*` dengan schema `SoftwareApplication`/`WebApplication` | Claude |
| Minggu 2 | Tautan internal otomatis: kotak "Baca juga" berdasar kata kunci yang cocok di artikel lama | Claude |
| Minggu 3 | Pantau Core Web Vitals (GSC → Pengalaman) & PageSpeed mobile ≥ 90 untuk 5 URL teratas | Claude |
| Minggu 4 | Laporan 404 & pengalihan dari log server → buat 301 bila ada URL lama/typo yang sering diakses | Claude |
| Setelah rilis | Schema `SoftwareApplication` + `aggregateRating` **hanya** dari rating Play Store asli; `downloadUrl` | Claude |
| Setelah rilis | App Links / `.well-known/assetlinks.json` agar tautan sirkopos.com bisa membuka aplikasi | Claude + agen mobile |
| Bulanan | Cek indeks: GSC → Halaman; "Ditemukan – tidak diindeks" → perkuat tautan internal / perbaiki isi | Claude |

## Aturan saat menambah halaman/skrip
- Skrip inline baru di halaman publik **wajib** masuk hash CSP (`SITE_SCRIPT_SRC` di `src/site/layout.ts`),
  atau jadikan file statis di `public/site`.
- Teks di atas latar gradien tak terukur oleh Lighthouse → pakai latar solid untuk area berisi teks.
- Gambar baru: JPG/WebP ≤ 200 KB, beri `width`/`height`, alt deskriptif.
