import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sql } from './client.ts';
import { getStorage } from '../lib/storage.ts';
import { assetFilename, contentTypeFor } from '../lib/catalog-asset.ts';
import { nowMs } from '../lib/time.ts';

/**
 * Mirror foto Katalog Umum ke bucket S3 sendiri (sirko-media) lalu update
 * `photo_url` di DB ke URL publik bucket → tak lagi bergantung server pihak ketiga.
 *
 * Sumber byte: berkas bundle lokal `data/assets/public_products/` (hasil
 * export:catalog); bila tak ada, di-download dari photo_url saat ini.
 * Key S3 deterministik: `catalog/<slug-nama>_<barcode>.<ext>` → idempotent
 * (re-run menimpa objek yang sama & set URL yang sama). Update DB per-batch.
 *
 * Jalankan: npm run mirror:catalog:prod
 * Env opsional: CONCURRENCY (default 10), MIRROR_LIMIT (uji subset).
 */

const UA = 'SirkoCatalogBot/1.0 (nuwas@creativism.id) - mirror catalog photos';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const LIMIT = process.env.MIRROR_LIMIT ? Number(process.env.MIRROR_LIMIT) : null;
const CHUNK = 200;

const here = dirname(fileURLToPath(import.meta.url));
const ASSET_DIR = join(here, '..', '..', 'data', 'assets', 'public_products');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row {
  id: string;
  name: string | null;
  barcode: string;
  photo_url: string;
}

async function loadBytes(name: string | null, barcode: string, photoUrl: string): Promise<Buffer | null> {
  const file = assetFilename(name, barcode, photoUrl);
  try {
    return await readFile(join(ASSET_DIR, file));
  } catch {
    // fallback: unduh dari sumber saat ini
    try {
      const res = await fetch(photoUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length > 0 ? buf : null;
    } catch {
      return null;
    }
  }
}

async function putObject(url: string, bytes: Buffer, contentType: string, attempt = 0): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: bytes,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok && res.status >= 500 && attempt < 2) {
      await sleep(800 * (attempt + 1));
      return putObject(url, bytes, contentType, attempt + 1);
    }
    return res.ok;
  } catch {
    if (attempt < 2) {
      await sleep(800 * (attempt + 1));
      return putObject(url, bytes, contentType, attempt + 1);
    }
    return false;
  }
}

async function pool<T>(items: T[], worker: (t: T) => Promise<void>, concurrency: number) {
  let i = 0;
  const run = async () => {
    while (i < items.length) await worker(items[i++]!);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

async function flush(updates: { id: string; url: string }[]) {
  if (updates.length === 0) return;
  const ids = updates.map((u) => u.id);
  const urls = updates.map((u) => u.url);
  await sql`
    UPDATE public_products p SET photo_url = u.url, updated_at = ${nowMs()}
    FROM unnest(${ids}::uuid[], ${urls}::text[]) AS u(id, url)
    WHERE p.id = u.id
  `;
}

async function run() {
  const storage = getStorage();
  const rows = LIMIT
    ? await sql<Row[]>`SELECT id, name, barcode, photo_url FROM public_products
        WHERE deleted_at IS NULL AND photo_url IS NOT NULL AND barcode IS NOT NULL
        ORDER BY name LIMIT ${LIMIT}`
    : await sql<Row[]>`SELECT id, name, barcode, photo_url FROM public_products
        WHERE deleted_at IS NULL AND photo_url IS NOT NULL AND barcode IS NOT NULL
        ORDER BY name`;

  console.log(`Mirror ${rows.length} foto → sirko-media (concurrency ${CONCURRENCY})...`);
  let up = 0, fail = 0, done = 0;

  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    const updates: { id: string; url: string }[] = [];
    await pool(
      chunk,
      async (r) => {
        done++;
        const bytes = await loadBytes(r.name, r.barcode, r.photo_url);
        if (!bytes) { fail++; return; }
        const file = assetFilename(r.name, r.barcode, r.photo_url);
        const key = `catalog/${file}`;
        const ct = contentTypeFor(file);
        const ok = await putObject(storage.signPut(key, ct), bytes, ct);
        if (!ok) { fail++; return; }
        updates.push({ id: r.id, url: storage.publicUrl(key) });
        up++;
      },
      CONCURRENCY,
    );
    await flush(updates); // persist per-batch
    console.log(`  ...${done}/${rows.length} (upload ${up}, gagal ${fail})`);
  }

  console.log(`\n✅ Selesai. Ter-mirror & photo_url diperbarui: ${up}. Gagal: ${fail}.`);
}

run()
  .then(() => sql.end({ timeout: 5 }))
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('Mirror GAGAL:', err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
