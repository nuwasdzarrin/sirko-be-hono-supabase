import { writeFile, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sql } from './client.ts';
import { assetFilename } from '../lib/catalog-asset.ts';

/**
 * Ekspor Katalog Umum untuk di-BUNDLE ke mobile app (produk default/starter):
 *  - data/public_product.json          → seluruh baris (siap dipakai offline)
 *  - data/assets/public_products/<barcode>.<ext>  → foto produk (di-download)
 *
 * Tujuan: mobile app punya katalog awal tanpa bergantung server pihak ketiga.
 * Resumable: foto yang sudah ada di-skip → aman diulang bila terputus.
 *
 * Jalankan: npm run export:catalog:prod
 * Env opsional: ASSET_ROOT (default <repo>/../data), CONCURRENCY (default 10).
 */

const UA = 'SirkoCatalogBot/1.0 (nuwas@creativism.id) - bundling default catalog';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);

const here = dirname(fileURLToPath(import.meta.url)); // .../sirko-backend/src/db
const ROOT = process.env.ASSET_ROOT ?? join(here, '..', '..', 'data'); // sirko-backend/data
const ASSET_DIR = join(ROOT, 'assets', 'public_products');
const JSON_PATH = join(ROOT, 'public_product.json');
const ASSET_REL = 'assets/public_products';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function exists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.size > 0;
  } catch {
    return false;
  }
}

async function download(url: string, dest: string, attempt = 0): Promise<number | false> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      if (res.status >= 500 && attempt < 2) {
        await sleep(800 * (attempt + 1));
        return download(url, dest, attempt + 1);
      }
      return false;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return false;
    await writeFile(dest, buf);
    return buf.length;
  } catch {
    if (attempt < 2) {
      await sleep(800 * (attempt + 1));
      return download(url, dest, attempt + 1);
    }
    return false;
  }
}

/** Pool sederhana: `concurrency` worker menarik pekerjaan dari antrean. */
async function pool<T>(items: T[], worker: (t: T, i: number) => Promise<void>, concurrency: number) {
  let idx = 0;
  const run = async () => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

interface Row {
  id: string; barcode: string | null; barcode_type: string | null; name: string | null;
  short_description: string | null; photo_url: string | null; brand: string | null;
  category: string | null; manufacturer: string | null; default_unit: string | null;
  net_size: string | null; net_unit: string | null; packaging: string | null;
  variant: string | null; country_of_origin: string | null; keywords: string[] | null;
  verified: boolean; source: string; created_at: string | null; updated_at: string | null;
}

async function run() {
  await mkdir(ASSET_DIR, { recursive: true });

  const rows = await sql<Row[]>`
    SELECT id, barcode, barcode_type, name, short_description, photo_url, brand, category,
           manufacturer, default_unit, net_size, net_unit, packaging, variant,
           country_of_origin, keywords, verified, source, created_at, updated_at
    FROM public_products WHERE deleted_at IS NULL
    ORDER BY name
  `;
  console.log(`Mengekspor ${rows.length} produk katalog...`);

  // Bentuk entri JSON (camelCase, siap konsumsi mobile). imageFile = path lokal
  // (deterministik dari barcode); photoUrl tetap disimpan sbg cadangan.
  const num = (v: string | null) => (v === null ? null : Number(v));
  const entries = rows.map((r) => {
    const imageFile =
      r.barcode && r.photo_url ? `${ASSET_REL}/${assetFilename(r.name, r.barcode, r.photo_url)}` : null;
    return {
      id: r.id,
      barcode: r.barcode,
      barcodeType: r.barcode_type,
      name: r.name,
      shortDescription: r.short_description,
      brand: r.brand,
      category: r.category,
      manufacturer: r.manufacturer,
      defaultUnit: r.default_unit,
      netSize: num(r.net_size),
      netUnit: r.net_unit,
      packaging: r.packaging,
      variant: r.variant,
      countryOfOrigin: r.country_of_origin,
      keywords: r.keywords ?? [],
      verified: r.verified,
      source: r.source,
      imageFile, // path lokal (bundle) — cek keberadaan file
      photoUrl: r.photo_url, // URL asal (cadangan)
      createdAt: num(r.created_at),
      updatedAt: num(r.updated_at),
    };
  });

  // 1) Tulis JSON lebih dulu (deliverable data diamankan walau download lama).
  await writeFile(JSON_PATH, JSON.stringify(entries, null, 2), 'utf8');
  console.log(`✓ JSON: ${JSON_PATH} (${entries.length} entri)`);

  // 2) Download foto (resumable, skip yang sudah ada).
  const targets = rows.filter((r) => r.barcode && r.photo_url);
  let ok = 0, skip = 0, fail = 0, bytes = 0, done = 0;
  await pool(
    targets,
    async (r) => {
      const file = assetFilename(r.name, r.barcode!, r.photo_url!);
      const dest = join(ASSET_DIR, file);
      done++;
      if (await exists(dest)) { skip++; return; }
      const res = await download(r.photo_url!, dest);
      if (res === false) fail++;
      else { ok++; bytes += res; }
      if (done % 200 === 0) console.log(`  ...${done}/${targets.length} (unduh ${ok}, skip ${skip}, gagal ${fail})`);
    },
    CONCURRENCY,
  );

  const mb = (bytes / 1024 / 1024).toFixed(1);
  console.log(`\n✅ Selesai. Foto: unduh ${ok} (${mb} MB), skip ${skip}, gagal ${fail}.`);
  console.log(`   Aset: ${ASSET_DIR}`);
  console.log(`   Data: ${JSON_PATH}`);
}

run()
  .then(() => sql.end({ timeout: 5 }))
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('Ekspor GAGAL:', err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
