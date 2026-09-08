import { sql } from './client.js';
import { classifyCategory, CATALOG_CATEGORIES } from '../lib/catalog-category.js';
import { nowMs } from '../lib/time.js';

/**
 * Petakan ulang kolom `category` public_products ke taksonomi Bahasa Indonesia
 * (lihat lib/catalog-category.ts). Idempotent — aman diulang.
 *
 * Jalankan: npm run reclassify:catalog | reclassify:catalog:prod
 */

interface Row {
  id: string;
  name: string | null;
  category: string | null;
  keywords: string[] | null;
  brand: string | null;
  photo_url: string | null;
}

async function run() {
  const rows = await sql<Row[]>`
    SELECT id, name, category, keywords, brand, photo_url
    FROM public_products WHERE deleted_at IS NULL
  `;
  console.log(`Memproses ${rows.length} produk...`);

  const byCat = new Map<string, string[]>();
  let changed = 0;
  for (const r of rows) {
    const cat = classifyCategory({
      name: r.name,
      offCategory: r.category,
      keywords: r.keywords,
      brand: r.brand,
      photoUrl: r.photo_url,
    });
    if (cat !== r.category) changed += 1;
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(r.id);
  }

  const ts = nowMs();
  for (const [cat, ids] of byCat) {
    const CHUNK = 1000;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      await sql`
        UPDATE public_products SET category = ${cat}, updated_at = ${ts}
        WHERE id::text = ANY(${slice}) AND category IS DISTINCT FROM ${cat}
      `;
    }
  }

  console.log(`\n✅ Selesai. ${changed} produk diubah kategorinya.\nDistribusi kategori:`);
  const dist = await sql<{ category: string | null; n: number }[]>`
    SELECT category, count(*)::int n FROM public_products WHERE deleted_at IS NULL
    GROUP BY category ORDER BY n DESC
  `;
  for (const d of dist) console.log(`  ${String(d.n).padStart(5)}  ${d.category ?? '(kosong)'}`);
  const unknown = CATALOG_CATEGORIES.filter((c) => !dist.some((d) => d.category === c));
  if (unknown.length) console.log(`  (kategori tanpa produk: ${unknown.join(', ')})`);
}

run()
  .then(() => sql.end({ timeout: 5 }))
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('Reclassify GAGAL:', err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
