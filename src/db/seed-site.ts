import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from './client.js';
import { runMigrations } from './migrate.js';
import { seedIfMissing, type SeedDoc } from '../services/site.service.js';

/**
 * Isi awal website dari content/site/*.md (frontmatter sederhana + Markdown).
 * Idempoten: konten yang slug-nya sudah ada TIDAK ditimpa — setelah terbit, sumber
 * kebenarannya database (disunting dari dashboard → Website).
 *
 *   npm run seed:site
 *
 * Token `[EMAIL KONTAK]` dibiarkan di isi; diganti saat render (lihat site/markdown.ts → kontak).
 */

export const CONTENT_DIR = fileURLToPath(new URL('../../content/site/', import.meta.url));

/** Frontmatter YAML sederhana: `kunci: nilai`, nilai berkutip, dan daftar `[a, b]`. */
export function parseDoc(raw: string): SeedDoc {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) throw new Error('Frontmatter tidak ditemukan');
  const meta: Record<string, unknown> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.*?)\s*(#.*)?$/.exec(line);
    if (!kv) continue;
    let v: unknown = kv[2]!;
    const s = String(v);
    if (/^\[.*\]$/.test(s)) v = s.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else if (/^".*"$/.test(s) || /^'.*'$/.test(s)) v = s.slice(1, -1);
    meta[kv[1]!] = v;
  }
  const body = m[2]!;
  if (meta.kind !== 'page' && meta.kind !== 'post') throw new Error(`kind tidak valid: ${String(meta.kind)}`);
  return {
    kind: meta.kind,
    slug: String(meta.slug ?? ''),
    title: String(meta.title ?? ''),
    meta_title: meta.meta_title as string | undefined,
    meta_description: meta.meta_description as string | undefined,
    focus_keyword: meta.focus_keyword as string | undefined,
    excerpt: meta.excerpt as string | undefined,
    category: meta.category as string | undefined,
    tags: meta.tags as string[] | undefined,
    cover: meta.cover as string | undefined,
    published_at: meta.published_at ? Date.parse(String(meta.published_at)) || undefined : undefined,
    cover_alt: meta.cover_alt as string | undefined,
    body: body.trim() + '\n',
  };
}

export function loadContent(dir = CONTENT_DIR): SeedDoc[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      try {
        return parseDoc(readFileSync(join(dir, f), 'utf8'));
      } catch (e) {
        throw new Error(`${f}: ${(e as Error).message}`);
      }
    });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runMigrations(sql);
  const docs = loadContent();
  // Tanggal terbit = `published_at` di frontmatter (tanggal tulisan sebenarnya), bila kosong = sekarang.
  let n = 0;
  for (const d of docs) {
    if (await seedIfMissing(d)) {
      n++;
      console.log(`+ ${d.kind} /${d.kind === 'post' ? 'blog/' : ''}${d.slug}`);
    }
  }
  console.log(`Selesai: ${n} konten baru, ${docs.length - n} sudah ada.`);
  await sql.end({ timeout: 5 });
}
