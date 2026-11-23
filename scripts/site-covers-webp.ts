/**
 * Siapkan sampul di folder kerja (BUKAN repo; sampul disimpan di R2): `<dir>/<slug>.jpg` (1200×630)
 * → `<slug>.webp` + `<slug>-600.webp` + kompres ulang `<slug>.jpg` (og:image). Aman diulang.
 *   npx tsx scripts/site-covers-webp.ts [--dir ~/.sirko-sampul] [slug ...]
 * Lalu unggah ke R2 dari server: scripts/site-covers-to-r2.ts --dir <folder di server>.
 */
import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { makeCover } from '../src/lib/site-image.js';

const args = process.argv.slice(2);
const di = args.indexOf('--dir');
const DIR = di >= 0 ? args.splice(di, 2)[1]! : join(homedir(), '.sirko-sampul');
const only = args;
const files = (await readdir(DIR)).filter((f) => /^[a-z0-9-]+\.jpg$/.test(f) && !f.endsWith('-600.jpg'));
for (const f of files) {
  const slug = f.replace(/\.jpg$/, '');
  if (only.length && !only.includes(slug)) continue;
  const src = await readFile(join(DIR, f));
  const set = await makeCover(src);
  await writeFile(join(DIR, `${slug}.webp`), set.webp);
  await writeFile(join(DIR, `${slug}-600.webp`), set.webp600);
  if (set.jpg.length < src.length) await writeFile(join(DIR, f), set.jpg);
  if (existsSync(join(DIR, `${slug}-600.jpg`))) await rm(join(DIR, `${slug}-600.jpg`));
  const kb = (n: number) => `${Math.round(n / 1024)}KB`;
  console.log(`${slug}: webp ${kb(set.webp.length)} · 600 ${kb(set.webp600.length)} · jpg ${kb(Math.min(set.jpg.length, src.length))}`);
}
