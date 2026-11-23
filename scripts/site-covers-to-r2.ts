/**
 * Pindahkan sampul blog ke R2: `<dir>/<slug>.webp`, `<slug>-600.webp`, `<slug>.jpg` → `site/blog/…`
 * (cache 1 tahun), cek bisa diunduh publik, lalu alihkan `site_posts.cover_url` yang masih
 * menunjuk `/img/blog/<slug>.webp|.jpg` ke URL R2. Aman diulang. Jalankan DI SERVER (kredensial R2 + DB):
 *   node --env-file=.env --import tsx scripts/site-covers-to-r2.ts [--dir /tmp/sampul] [slug ...]
 * Bawaan --dir = public/site/img/blog (repo). Sampul baru dari laptop: kirim dulu foldernya ke server.
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { putSiteObject } from '../src/services/site.service.js';
import { sql } from '../src/db/client.js';

const args = process.argv.slice(2);
const di = args.indexOf('--dir');
const DIR = di >= 0 ? args.splice(di, 2)[1]! : join(import.meta.dirname, '../public/site/img/blog');
const only = args;
const TYPES: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg' };

const slugs = (await readdir(DIR)).filter((f) => /^[a-z0-9-]+\.webp$/.test(f) && !f.endsWith('-600.webp')).map((f) => f.replace(/\.webp$/, ''));
let moved = 0;
for (const slug of slugs) {
  if (only.length && !only.includes(slug)) continue;
  let main = '';
  for (const name of [`${slug}.jpg`, `${slug}-600.webp`, `${slug}.webp`]) {
    if (!existsSync(join(DIR, name))) throw new Error(`File hilang: ${name} (jalankan scripts/site-covers-webp.ts dulu)`);
    const url = await putSiteObject(`site/blog/${name}`, TYPES[name.split('.').pop()!]!, await readFile(join(DIR, name)));
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) throw new Error(`Tak bisa diunduh publik: ${url} (HTTP ${res.status})`);
    if (name === `${slug}.webp`) main = url;
  }
  const upd = await sql`UPDATE site_posts SET cover_url = ${main}
    WHERE cover_url IN (${`/img/blog/${slug}.webp`}, ${`/img/blog/${slug}.jpg`}) RETURNING slug`;
  moved++;
  console.log(`✓ ${slug} → ${main}${upd.length ? ` (DB: ${upd.map((r) => r.slug).join(', ')})` : ''}`);
}
const left = await sql<{ slug: string; cover_url: string }[]>`SELECT slug, cover_url FROM site_posts WHERE cover_url LIKE '/img/blog/%'`;
console.log(`Selesai: ${moved} sampul di R2. Sisa cover_url lokal di DB: ${left.length}${left.length ? ` → ${left.map((r) => r.slug).join(', ')}` : ''}`);
await sql.end();
