// Build seed katalog bawaan → assets/seed/catalog_seed.sqlite
// (spec/13 §3-5). Sumber = data/public_product.json (terkurasi), FILTER: verified=true.
// Thumbnail webp ~128px dari data/assets/public_products/. Full-res TETAP di cloud (photoUrl).
//
// Jalankan (dari sirko-backend):  npm run build:seed
// Output: data/catalog_seed.sqlite  → disalin ke ../sirko/assets/seed/catalog_seed.sqlite

import { readFile, rm, mkdir, cp, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import Database from 'better-sqlite3';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url)); // sirko-backend/data
const JSON_PATH = join(HERE, 'public_product.json');
const ASSET_DIR = join(HERE, 'assets', 'public_products');
const OUT_SQLITE = join(HERE, 'catalog_seed.sqlite');
const MOBILE_DEST = join(HERE, '..', '..', 'sirko', 'assets', 'seed', 'catalog_seed.sqlite');

const THUMB_PX = 128;
const THUMB_Q = 70;
const CONCURRENCY = 8;

async function makeThumb(imageFile) {
  if (!imageFile) return null;
  try {
    const buf = await readFile(join(ASSET_DIR, basename(imageFile)));
    return await sharp(buf)
      .resize({ width: THUMB_PX, height: THUMB_PX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: THUMB_Q })
      .toBuffer();
  } catch {
    return null; // gambar hilang/rusak → tanpa thumb
  }
}

async function pool(items, worker, concurrency) {
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

async function run() {
  const all = JSON.parse(await readFile(JSON_PATH, 'utf8'));
  const rows = all.filter((r) => r.verified === true && r.deletedAt == null);
  console.log(`Sumber: ${all.length} → verified: ${rows.length}. Membuat thumbnail...`);

  // 1) Generate thumbnails (pool).
  const thumbs = new Array(rows.length);
  let done = 0, withThumb = 0;
  await pool(
    rows,
    async (r, idx) => {
      const t = await makeThumb(r.imageFile);
      thumbs[idx] = t;
      if (t) withThumb++;
      if (++done % 200 === 0) console.log(`  thumb ${done}/${rows.length}`);
    },
    CONCURRENCY,
  );
  console.log(`Thumbnail selesai: ${withThumb}/${rows.length} ada.`);

  // 2) Pack SQLite (bersih dari awal → idempoten).
  await rm(OUT_SQLITE, { force: true });
  const db = new Database(OUT_SQLITE);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE public_products (
      id TEXT PRIMARY KEY, barcode TEXT UNIQUE, barcode_type TEXT, name TEXT,
      short_description TEXT, photo_url TEXT, brand TEXT, category TEXT, manufacturer TEXT,
      default_unit TEXT, net_size REAL, net_unit TEXT, packaging TEXT, variant TEXT,
      country_of_origin TEXT, keywords TEXT, verified INTEGER, source TEXT,
      updated_at INTEGER, thumb_present INTEGER
    );
    CREATE INDEX idx_pp_barcode ON public_products(barcode);
    CREATE TABLE public_product_thumbs (barcode TEXT PRIMARY KEY, thumb BLOB);
  `);

  const insP = db.prepare(`INSERT INTO public_products
    (id,barcode,barcode_type,name,short_description,photo_url,brand,category,manufacturer,
     default_unit,net_size,net_unit,packaging,variant,country_of_origin,keywords,verified,source,updated_at,thumb_present)
    VALUES (@id,@barcode,@barcode_type,@name,@short_description,@photo_url,@brand,@category,@manufacturer,
     @default_unit,@net_size,@net_unit,@packaging,@variant,@country_of_origin,@keywords,@verified,@source,@updated_at,@thumb_present)`);
  const insT = db.prepare(`INSERT INTO public_product_thumbs (barcode,thumb) VALUES (?,?)`);

  const tx = db.transaction(() => {
    rows.forEach((r, idx) => {
      const thumb = thumbs[idx];
      insP.run({
        id: r.id,
        barcode: r.barcode ?? null,
        barcode_type: r.barcodeType ?? null,
        name: r.name ?? null,
        short_description: r.shortDescription ?? null,
        photo_url: r.photoUrl ?? null, // full-res cloud
        brand: r.brand ?? null,
        category: r.category ?? null,
        manufacturer: r.manufacturer ?? null,
        default_unit: r.defaultUnit ?? null,
        net_size: r.netSize ?? null,
        net_unit: r.netUnit ?? null,
        packaging: r.packaging ?? null,
        variant: r.variant ?? null,
        country_of_origin: r.countryOfOrigin ?? null,
        keywords: JSON.stringify(r.keywords ?? []),
        verified: 1,
        source: r.source ?? 'crowdsource',
        updated_at: r.updatedAt ?? null,
        thumb_present: thumb ? 1 : 0,
      });
      if (thumb && r.barcode) insT.run(r.barcode, thumb);
    });
  });
  tx();
  db.exec('VACUUM;');
  db.close();

  const size = (await stat(OUT_SQLITE)).size;
  console.log(`\n✓ SQLite: ${OUT_SQLITE} (${(size / 1024 / 1024).toFixed(1)} MB)`);

  // 3) Salin ke proyek mobile.
  await mkdir(dirname(MOBILE_DEST), { recursive: true });
  await cp(OUT_SQLITE, MOBILE_DEST);
  console.log(`✓ Disalin ke: ${MOBILE_DEST}`);
  console.log(`\n✅ Seed siap: ${rows.length} produk, ${withThumb} thumbnail.`);
}

run().catch((e) => { console.error('BUILD SEED GAGAL:', e); process.exit(1); });
