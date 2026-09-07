# Katalog Produk Umum — bundle untuk Mobile App

Dataset **produk default/starter** untuk aplikasi mobile Sirko, agar app punya
katalog awal (auto-fill saat scan barcode) **tanpa bergantung server pihak ketiga**.

Dihasilkan dari backend: `npm run export:catalog:prod` (script `src/db/export-catalog-assets.ts`).

## Isi

| Berkas | Keterangan |
|---|---|
| `public_product.json` | 2.400 produk (array JSON). ~1,8 MB |
| `assets/public_products/<slug-nama>_<barcode>.<ext>` | Foto produk (2.400 file, ~54 MB) |

Nama file foto = slug nama produk + barcode, mis. `milo_active_go_original_9556001299352.jpg`
(mudah dibaca, unik, deterministik → resumable saat re-export).

## Skema `public_product.json` (per entri)

```jsonc
{
  "id": "uuid",
  "barcode": "8991002101234",
  "barcodeType": "EAN13",          // EAN13 | UPC | EAN8 | QR | other
  "name": "Indomie Goreng ...",
  "shortDescription": null,
  "brand": "Indomie",
  "category": "Mie Instan",         // taksonomi Bahasa Indonesia (lihat di bawah)
  "manufacturer": null,
  "defaultUnit": null,              // pcs/botol/dus/... (bila ada)
  "netSize": 85,                    // angka; null bila tak diketahui
  "netUnit": "g",                   // ml/g/l/kg/...
  "packaging": null,
  "variant": null,
  "countryOfOrigin": "ID",          // 'ID' bila barcode prefix 899, else null
  "keywords": ["indomie","mi goreng"],  // untuk pencarian & sinonim
  "verified": false,
  "source": "crowdsource",
  "imageFile": "assets/public_products/indomie_goreng_8991002101234.jpg", // path lokal (bundle)
  "photoUrl": "https://images.openfoodfacts.org/...",                     // URL asal (cadangan)
  "createdAt": 1788700000000,
  "updatedAt": 1788700000000
}
```

**Pakai di app:** utamakan `imageFile` (aset bundle, offline). `photoUrl` hanya cadangan
bila suatu saat ingin ambil dari jaringan. Lakukan null/exists check pada `imageFile`.

## Kategori (16)
Sembako · Mie Instan · Makanan Ringan · Cokelat & Permen · Minuman · Kopi & Teh ·
Susu & Olahan Susu · Bumbu & Bahan Masak · Makanan Kaleng & Instan · Sarapan & Sereal ·
Roti & Kue · Perawatan Tubuh · Pembersih Rumah Tangga · Bayi & Anak · Kesehatan · Lainnya

## Lisensi & atribusi (WAJIB dibaca)
Data & foto berasal dari **Open Food Facts / Open Beauty Facts** di bawah
**Open Database License (ODbL)**; foto individual diunggah kontributor komunitas
(berbagai lisensi, umumnya CC). Bila menampilkan foto ke publik, **cantumkan atribusi**
ke Open Food Facts. Rujukan: https://world.openfoodfacts.org/terms-of-use

## Regenerasi
```bash
cd sirko-backend
npm run export:catalog:prod   # tulis ulang JSON + unduh foto (resumable, skip yang ada)
```
