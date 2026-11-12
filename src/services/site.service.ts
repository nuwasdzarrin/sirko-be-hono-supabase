import { z } from 'zod';
import { sql } from '../db/client.js';
import { uuid } from '../lib/uuid.js';
import { nowMs } from '../lib/time.js';
import { validation } from '../lib/errors.js';
import { slugify } from '../site/markdown.js';
import { submitUrls } from '../site/indexnow.js';

/**
 * Konten website publik (tabel site_posts, migrasi 0015).
 * - kind 'page' → https://sirkopos.com/<slug>; kind 'post' → /blog/<slug>.
 * - Tampil publik bila status 'published' DAN published_at <= sekarang (masa depan = terjadwal).
 * - Slug artikel/halaman yang sudah terbit diganti → pengalihan 301 otomatis (site_redirects).
 */

export type Kind = 'post' | 'page';
type Row = Record<string, unknown>;

export interface SitePost {
  id: string;
  kind: Kind;
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  excerpt: string;
  bodyMd: string;
  coverUrl: string | null;
  coverAlt: string;
  category: string;
  tags: string[];
  status: 'draft' | 'published';
  noindex: boolean;
  author: string;
  publishedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Path publik konten. */
export const pathOf = (p: Pick<SitePost, 'kind' | 'slug'>) => (p.kind === 'post' ? `/blog/${p.slug}` : `/${p.slug}`);

export const isLive = (p: Pick<SitePost, 'status' | 'publishedAt'>, now = nowMs()) =>
  p.status === 'published' && p.publishedAt != null && p.publishedAt <= now;

const toPost = (r: Row): SitePost => ({
  id: r.id as string,
  kind: r.kind as Kind,
  slug: r.slug as string,
  title: r.title as string,
  metaTitle: (r.meta_title as string) ?? '',
  metaDescription: (r.meta_description as string) ?? '',
  focusKeyword: (r.focus_keyword as string) ?? '',
  excerpt: (r.excerpt as string) ?? '',
  bodyMd: (r.body_md as string) ?? '',
  coverUrl: (r.cover_url as string) ?? null,
  coverAlt: (r.cover_alt as string) ?? '',
  category: (r.category as string) ?? '',
  tags: (r.tags as string[]) ?? [],
  status: r.status as SitePost['status'],
  noindex: Boolean(r.noindex),
  author: (r.author as string) || 'Tim Sirko',
  publishedAt: r.published_at == null ? null : Number(r.published_at),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

/** Slug yang dipakai rute sistem — tak boleh jadi slug halaman. */
const RESERVED = new Set([
  'blog', 'dashboard', 'v1', 'assets', 'img', 'sitemap', 'robots', 'feed', 'llms', 'favicon', 'kategori',
  'login', 'admin', 'api', 'static', 'site', 'manifest', 'kontak', 'hapus-akun', 'daftar-tunggu', 'fonts', '404',
]);

// ── Baca (publik) ────────────────────────────────────────────────────────────

export async function getLive(kind: Kind, slug: string): Promise<SitePost | null> {
  const r = await sql<Row[]>`
    SELECT * FROM site_posts WHERE kind = ${kind} AND slug = ${slug} AND deleted_at IS NULL
      AND status = 'published' AND published_at <= ${nowMs()}`;
  return r[0] ? toPost(r[0]) : null;
}

/** Versi apa pun (draf/terjadwal) — untuk pratinjau admin. */
export async function getAny(kind: Kind, slug: string): Promise<SitePost | null> {
  const r = await sql<Row[]>`SELECT * FROM site_posts WHERE kind = ${kind} AND slug = ${slug} AND deleted_at IS NULL`;
  return r[0] ? toPost(r[0]) : null;
}

export async function listLivePosts(opts: { page?: number; limit?: number; category?: string } = {}) {
  const limit = opts.limit ?? 12;
  const now = nowMs();
  const cat = opts.category ? sql`AND category = ${opts.category}` : sql``;
  const total =
    (await sql<{ c: number }[]>`
      SELECT count(*)::int c FROM site_posts WHERE kind = 'post' AND deleted_at IS NULL AND NOT noindex AND status = 'published' AND published_at <= ${now} ${cat}`)[0]?.c ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(Math.max(1, opts.page ?? 1), pages);
  const rows = await sql<Row[]>`
    SELECT * FROM site_posts WHERE kind = 'post' AND deleted_at IS NULL AND NOT noindex AND status = 'published' AND published_at <= ${now} ${cat}
    ORDER BY published_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
  return { items: rows.map(toPost), total, page, pages };
}

export async function liveCategories(): Promise<Array<{ name: string; slug: string; count: number }>> {
  const r = await sql<{ category: string; c: number }[]>`
    SELECT category, count(*)::int c FROM site_posts
    WHERE kind = 'post' AND deleted_at IS NULL AND NOT noindex AND status = 'published' AND published_at <= ${nowMs()} AND category <> ''
    GROUP BY category ORDER BY category`;
  return r.map((x) => ({ name: x.category, slug: slugify(x.category), count: x.c }));
}

/** Artikel terkait: kategori sama dulu, lalu berbagi tag, lalu terbaru. */
export async function related(p: SitePost, limit = 3): Promise<SitePost[]> {
  const rows = await sql<Row[]>`
    SELECT *, (CASE WHEN category = ${p.category} AND category <> '' THEN 2 ELSE 0 END)
              + cardinality(ARRAY(SELECT unnest(tags) INTERSECT SELECT unnest(${p.tags}::text[]))) AS score
    FROM site_posts
    WHERE kind = 'post' AND id <> ${p.id} AND deleted_at IS NULL AND NOT noindex AND status = 'published' AND published_at <= ${nowMs()}
    ORDER BY score DESC, published_at DESC LIMIT ${limit}`;
  return rows.map(toPost);
}

/** Semua URL terbit untuk sitemap/feed. */
export async function liveAll(): Promise<SitePost[]> {
  const r = await sql<Row[]>`
    SELECT * FROM site_posts WHERE deleted_at IS NULL AND status = 'published' AND published_at <= ${nowMs()}
    ORDER BY published_at DESC`;
  return r.map(toPost);
}

export async function redirectFor(path: string): Promise<string | null> {
  const r = await sql<{ to_path: string }[]>`SELECT to_path FROM site_redirects WHERE from_path = ${path}`;
  return r[0]?.to_path ?? null;
}

/** URL konten yang pernah terbit lalu dihapus (tanpa pengalihan) → 410 Gone. */
export async function wasDeleted(path: string): Promise<boolean> {
  const m = /^\/blog\/([a-z0-9-]+)$/.exec(path) ?? /^\/([a-z0-9-]+)$/.exec(path);
  if (!m) return false;
  const kind: Kind = path.startsWith('/blog/') ? 'post' : 'page';
  const r = await sql`
    SELECT 1 FROM site_posts WHERE kind = ${kind} AND slug = ${m[1]!} AND deleted_at IS NOT NULL AND published_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM site_posts x WHERE x.kind = ${kind} AND x.slug = ${m[1]!} AND x.deleted_at IS NULL)
    LIMIT 1`;
  return r.length > 0;
}

/** Kategori yang sudah dipakai (untuk pilihan di editor). */
export async function categoriesInUse(): Promise<string[]> {
  const r = await sql<{ category: string }[]>`
    SELECT DISTINCT category FROM site_posts WHERE kind = 'post' AND deleted_at IS NULL AND category <> '' ORDER BY category`;
  return r.map((x) => x.category);
}

// ── Kelola (dashboard) ───────────────────────────────────────────────────────

export async function adminList(opts: { kind: Kind; status?: 'semua' | 'draft' | 'published' | 'scheduled'; q?: string }) {
  const now = nowMs();
  const st =
    opts.status === 'draft'
      ? sql`AND status = 'draft'`
      : opts.status === 'published'
        ? sql`AND status = 'published' AND published_at <= ${now}`
        : opts.status === 'scheduled'
          ? sql`AND status = 'published' AND published_at > ${now}`
          : sql``;
  const like = `%${(opts.q ?? '').trim()}%`;
  const q = opts.q?.trim() ? sql`AND (title ILIKE ${like} OR slug ILIKE ${like} OR focus_keyword ILIKE ${like})` : sql``;
  const rows = await sql<Row[]>`
    SELECT * FROM site_posts WHERE kind = ${opts.kind} AND deleted_at IS NULL ${st} ${q}
    ORDER BY coalesce(published_at, updated_at) DESC LIMIT 200`;
  const counts = (
    await sql<Row[]>`
      SELECT count(*)::int semua,
        count(*) FILTER (WHERE status = 'draft')::int draft,
        count(*) FILTER (WHERE status = 'published' AND published_at <= ${now})::int published,
        count(*) FILTER (WHERE status = 'published' AND published_at > ${now})::int scheduled
      FROM site_posts WHERE kind = ${opts.kind} AND deleted_at IS NULL`
  )[0]!;
  return { items: rows.map(toPost), counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v)])) };
}

export async function getById(id: string): Promise<SitePost | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await sql<Row[]>`SELECT * FROM site_posts WHERE id = ${id} AND deleted_at IS NULL`;
  return r[0] ? toPost(r[0]) : null;
}

const str = (max: number) => z.string().trim().max(max).default('');
export const postInput = z.object({
  kind: z.enum(['post', 'page']),
  title: z.string().trim().min(3, 'Judul minimal 3 karakter').max(140),
  slug: z.string().trim().max(80).default(''),
  metaTitle: str(70),
  metaDescription: str(170),
  focusKeyword: str(80),
  excerpt: str(320),
  bodyMd: z.string().max(200_000).default(''),
  // URL https penuh (unggahan storage) atau path lokal situs (/img/...).
  coverUrl: z.union([z.literal(''), z.string().trim().url().max(500), z.string().trim().regex(/^\/img\/[\w\-/.]+$/, 'Path gambar tidak valid')]).default(''),
  coverAlt: str(160),
  category: str(60),
  tags: z.union([z.array(z.string()), z.string()]).default([]),
  status: z.enum(['draft', 'published']).default('draft'),
  noindex: z.union([z.boolean(), z.string()]).default(false),
  author: str(80),
  publishedAt: z.union([z.number(), z.string(), z.null()]).default(null),
});
export type PostInput = z.input<typeof postInput>;

function normTags(t: string[] | string): string[] {
  const arr = Array.isArray(t) ? t : t.split(',');
  return [...new Set(arr.map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
}

/** "2026-11-11T09:30" (WIB, dari input datetime-local) / epoch ms → epoch ms. */
export function parseWibDateTime(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(v).trim());
  if (!m) return Number.isFinite(Number(v)) ? Number(v) : null;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]! - 7, +m[5]!);
}

export async function save(id: string | null, input: PostInput, admin: string): Promise<SitePost> {
  const p = postInput.parse(input);
  const slug = slugify(p.slug || p.title);
  if (!slug) throw validation('Slug tidak valid — isi judul atau slug dengan huruf/angka.');
  if (p.kind === 'page' && RESERVED.has(slug)) throw validation(`Slug "${slug}" dipakai sistem. Pilih slug lain.`);
  const clash = await sql`
    SELECT 1 FROM site_posts WHERE kind = ${p.kind} AND slug = ${slug} AND deleted_at IS NULL ${id ? sql`AND id <> ${id}` : sql``}`;
  if (clash.length) throw validation(`Slug "${slug}" sudah dipakai. Ganti slug.`);
  const ts = nowMs();
  const noindex = p.noindex === true || p.noindex === 'on' || p.noindex === 'true';
  const before = id ? await getById(id) : null;
  if (id && !before) throw validation('Konten tidak ditemukan.');
  let publishedAt = parseWibDateTime(p.publishedAt);
  // Tanggal dikosongkan pada konten yang pernah terbit → pertahankan tanggal asli (jangan "terbit ulang").
  if (publishedAt == null) publishedAt = before?.publishedAt ?? (p.status === 'published' ? ts : null);
  // Kategori: samakan dengan kategori yang sudah ada (abaikan huruf besar/kecil) agar tak bercabang karena salah ketik.
  let category = p.kind === 'post' ? p.category.trim() : '';
  if (category) {
    const known = (await categoriesInUse()).find((k) => k.toLowerCase() === category.toLowerCase());
    if (known) category = known;
  }
  const data = {
    kind: p.kind,
    slug,
    title: p.title,
    meta_title: p.metaTitle,
    meta_description: p.metaDescription,
    focus_keyword: p.focusKeyword,
    excerpt: p.excerpt,
    body_md: p.bodyMd.replace(/\r\n/g, '\n'),
    cover_url: p.coverUrl || null,
    cover_alt: p.coverAlt,
    category,
    tags: p.kind === 'post' ? normTags(p.tags) : [],
    status: p.status,
    noindex,
    author: p.author || admin || 'Tim Sirko',
    published_at: publishedAt,
    updated_at: ts,
  };
  if (!id) {
    const newId = uuid();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO site_posts ${tx({ id: newId, ...data, created_at: ts })}`;
      // Path kini dipakai konten aktif → pengalihan lama dari path ini tak berlaku lagi.
      await tx`DELETE FROM site_redirects WHERE from_path = ${pathOf({ kind: data.kind, slug })}`;
    });
    const created = (await getById(newId))!;
    if (isLive(created) && !created.noindex) void submitUrls([pathOf(created), ...hubPaths(created)]);
    return created;
  }
  await sql.begin(async (tx) => {
    // Simpan versi sebelumnya sebagai revisi (30 terakhir).
    await tx`INSERT INTO site_post_revisions ${tx({ id: uuid(), post_id: id, snapshot: tx.json(revisionOf(before!) as never), created_by: admin, created_at: ts })}`;
    await tx`DELETE FROM site_post_revisions WHERE post_id = ${id} AND id NOT IN (
               SELECT id FROM site_post_revisions WHERE post_id = ${id} ORDER BY created_at DESC LIMIT 30)`;
    await tx`UPDATE site_posts SET ${tx(data)} WHERE id = ${id}`;
    // Slug/jenis berubah pada konten yang pernah terbit → 301 dari URL lama.
    const oldPath = before ? pathOf(before) : '';
    const newPath = pathOf({ kind: data.kind, slug });
    if (before && oldPath !== newPath && before.publishedAt != null && before.status === 'published') {
      await tx`INSERT INTO site_redirects (from_path, to_path, created_at) VALUES (${oldPath}, ${newPath}, ${ts})
               ON CONFLICT (from_path) DO UPDATE SET to_path = EXCLUDED.to_path, created_at = EXCLUDED.created_at`;
      // Rantai lama yang menunjuk ke URL lama ikut diarahkan langsung ke URL baru; buang loop.
      await tx`UPDATE site_redirects SET to_path = ${newPath} WHERE to_path = ${oldPath}`;
      await tx`DELETE FROM site_redirects WHERE from_path = ${newPath}`;
    }
  });
  const after = (await getById(id))!;
  // Kabari mesin pencari: URL kini (bila tayang) + URL lama bila slug berubah (agar 301-nya cepat terbaca).
  const changed = [isLive(after) && !after.noindex ? pathOf(after) : null, before && pathOf(before) !== pathOf(after) && isLive(before) ? pathOf(before) : null]
    .filter((x): x is string => Boolean(x));
  if (changed.length) void submitUrls([...changed, ...hubPaths(after)]);
  return after;
}

/** Halaman daftar yang ikut berubah saat artikel terbit/berubah (beranda, blog, kategori). */
function hubPaths(p: SitePost): string[] {
  return p.kind === 'post' ? ['/', '/blog', ...(p.category ? [`/blog/kategori/${slugify(p.category)}`] : [])] : [];
}

/** Artikel terjadwal yang baru saja tayang (published_at di antara `since` dan sekarang). */
export async function newlyLive(since: number, now = nowMs()): Promise<SitePost[]> {
  const r = await sql<Row[]>`
    SELECT * FROM site_posts WHERE deleted_at IS NULL AND status = 'published' AND NOT noindex
      AND published_at > ${since} AND published_at <= ${now} AND created_at < published_at`;
  return r.map(toPost);
}

/**
 * Hapus konten. `redirectTo` (path internal, mis. /blog/artikel-lain) → 301 dari URL lama;
 * tanpa itu URL lama menjawab 410 Gone (Google cepat membuangnya dari indeks).
 */
export async function remove(id: string, redirectTo?: string | null): Promise<void> {
  const p = await getById(id);
  if (!p) return;
  const to = (redirectTo ?? '').trim();
  if (to && !/^\/[a-z0-9\-/#]*$/.test(to)) throw validation('Alamat pengalihan harus path internal, mis. /blog/artikel-lain');
  await sql.begin(async (tx) => {
    await tx`UPDATE site_posts SET deleted_at = ${nowMs()}, updated_at = ${nowMs()} WHERE id = ${id}`;
    if (to && to !== pathOf(p)) {
      await tx`INSERT INTO site_redirects (from_path, to_path, created_at) VALUES (${pathOf(p)}, ${to}, ${nowMs()})
               ON CONFLICT (from_path) DO UPDATE SET to_path = EXCLUDED.to_path`;
    }
  });
  if (isLive(p)) void submitUrls([pathOf(p), ...hubPaths(p)]);
}

export interface SeedDoc {
  kind: Kind;
  slug: string;
  title: string;
  meta_title?: string;
  meta_description?: string;
  focus_keyword?: string;
  excerpt?: string;
  category?: string;
  tags?: string[];
  cover?: string;
  cover_alt?: string;
  body: string;
  published_at?: number;
}

/** Isi awal dari content/site/*.md — hanya bila slug belum ada (tak menimpa suntingan dashboard). */
export async function seedIfMissing(d: SeedDoc): Promise<boolean> {
  // Pernah ada (termasuk yang sudah dihapus admin) atau slug-nya sudah dialihkan → jangan dibuat lagi.
  const exists = await sql`
    SELECT 1 FROM site_posts WHERE kind = ${d.kind} AND slug = ${d.slug}
    UNION ALL SELECT 1 FROM site_redirects WHERE from_path = ${pathOf({ kind: d.kind, slug: d.slug })}
    LIMIT 1`;
  if (exists.length) return false;
  await save(
    null,
    {
      kind: d.kind,
      title: d.title,
      slug: d.slug,
      metaTitle: d.meta_title ?? '',
      metaDescription: d.meta_description ?? '',
      focusKeyword: d.focus_keyword ?? '',
      excerpt: d.excerpt ?? '',
      bodyMd: d.body,
      category: d.category ?? '',
      tags: d.tags ?? [],
      coverUrl: d.cover ?? '',
      coverAlt: d.cover_alt ?? '',
      status: 'published',
      publishedAt: d.published_at ?? nowMs(),
    },
    'Tim Sirko',
  );
  return true;
}

// ── Gambar (sampul & isi artikel) ────────────────────────────────────────────

export const MAX_SITE_IMAGE_BYTES = 400 * 1024;

/** Unggah gambar situs (sudah dikompres di browser) → URL publik. Isi file diperiksa ulang. */
export async function uploadImage(file: File, keyOverride?: string): Promise<string> {
  const { sniffImageType, photoFileName } = await import('./catalog-admin.service.js');
  const { getStorage } = await import('../lib/storage.js');
  if (file.size > MAX_SITE_IMAGE_BYTES) {
    throw validation(`Gambar ${Math.ceil(file.size / 1024)} KB — maksimal 400 KB. Pilih ulang agar dikompres otomatis.`);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) throw validation('Gambar harus JPG, PNG, atau WebP.');
  const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'webp';
  const d = new Date();
  const key = keyOverride ?? `site/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${photoFileName(file.name || 'gambar', ext)}`;
  const storage = getStorage();
  const res = await fetch(storage.signPut(key, type), {
    method: 'PUT',
    headers: { 'Content-Type': type },
    body: bytes,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw validation(`Unggah gambar gagal (HTTP ${res.status}).`);
  return storage.publicUrl(key);
}

// ── Formulir publik: daftar tunggu, kontak, hapus akun ───────────────────────

export type LeadKind = 'waitlist' | 'contact' | 'delete_account';
export interface SiteLead {
  id: string;
  kind: LeadKind;
  name: string;
  contact: string;
  storeType: string;
  message: string;
  status: 'new' | 'done';
  createdAt: number;
  handledAt: number | null;
  handledBy: string | null;
}

export const leadInput = z.object({
  kind: z.enum(['waitlist', 'contact', 'delete_account']),
  name: z.string().trim().max(80).default(''),
  contact: z
    .string()
    .trim()
    .min(5, 'Isi email atau nomor WhatsApp')
    .max(120)
    .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || /^(\+?62|0)8\d{7,12}$/.test(v.replace(/[\s-]/g, '')), 'Isi email atau nomor WhatsApp yang valid'),
  storeType: z.string().trim().max(60).default(''),
  message: z.string().trim().max(2000).default(''),
});

const LEAD_LABEL: Record<LeadKind, string> = { waitlist: '📝 Daftar tunggu', contact: '✉️ Pesan kontak', delete_account: '🗑 Permintaan hapus akun' };

/** Simpan formulir publik + beri tahu admin (Telegram). Batas laju per IP dicek pemanggil. */
export async function createLead(input: unknown, ip: string): Promise<SiteLead> {
  const p = leadInput.parse(input);
  if (p.kind === 'contact' && p.message.length < 5) throw validation('Tulis pesan Anda (minimal 5 karakter).');
  const id = uuid();
  const ts = nowMs();
  await sql`INSERT INTO site_leads ${sql({ id, kind: p.kind, name: p.name, contact: p.contact, store_type: p.storeType, message: p.message, ip, created_at: ts })}`;
  const { notifyAdmin, tgEsc } = await import('../lib/notify.js');
  void notifyAdmin({
    text:
      `${LEAD_LABEL[p.kind]} dari situs\n` +
      `${p.name ? `Nama: <b>${tgEsc(p.name)}</b>\n` : ''}Kontak: <code>${tgEsc(p.contact)}</code>\n` +
      `${p.storeType ? `Usaha: ${tgEsc(p.storeType)}\n` : ''}${p.message ? `\n${tgEsc(p.message.slice(0, 600))}` : ''}`,
    buttons: [[{ text: '📋 Salin kontak', copy_text: { text: p.contact } }]],
    linkPath: '/dashboard/site/leads',
    linkLabel: 'Buka pesan masuk',
  });
  return (await leadList({ id }))[0]!;
}

export async function leadList(opts: { id?: string; status?: 'new' | 'done' | 'semua'; kind?: LeadKind } = {}): Promise<SiteLead[]> {
  const rows = await sql<Row[]>`
    SELECT * FROM site_leads WHERE true
      ${opts.id ? sql`AND id = ${opts.id}` : sql``}
      ${opts.status && opts.status !== 'semua' ? sql`AND status = ${opts.status}` : sql``}
      ${opts.kind ? sql`AND kind = ${opts.kind}` : sql``}
    ORDER BY (status = 'new') DESC, created_at DESC LIMIT 300`;
  return rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as LeadKind,
    name: (r.name as string) ?? '',
    contact: r.contact as string,
    storeType: (r.store_type as string) ?? '',
    message: (r.message as string) ?? '',
    status: r.status as SiteLead['status'],
    createdAt: Number(r.created_at),
    handledAt: r.handled_at == null ? null : Number(r.handled_at),
    handledBy: (r.handled_by as string) ?? null,
  }));
}

export async function countNewLeads(): Promise<number> {
  return (await sql<{ c: number }[]>`SELECT count(*)::int c FROM site_leads WHERE status = 'new'`)[0]?.c ?? 0;
}

export async function markLead(id: string, done: boolean, admin: string): Promise<void> {
  await sql`UPDATE site_leads SET status = ${done ? 'done' : 'new'}, handled_at = ${done ? nowMs() : null}, handled_by = ${done ? admin : null} WHERE id = ${id}`;
}

/** Sampul: JPG 1200×630 + kembaran 600×315 (`-600.jpg`) untuk srcset. JPG agar pratinjau WhatsApp andal. */
export async function uploadCover(big: File, small: File): Promise<string> {
  const { sniffImageType } = await import('./catalog-admin.service.js');
  for (const f of [big, small]) {
    if (sniffImageType(Buffer.from(await f.slice(0, 16).arrayBuffer())) !== 'image/jpeg') throw validation('Sampul harus JPG (dibuat otomatis oleh editor).');
  }
  const url = await uploadImage(big);
  const key = new URL(url, 'https://x').pathname.split('/site/')[1];
  if (!key) return url;
  await uploadImage(small, `site/${key.replace(/\.jpg$/, '-600.jpg')}`);
  return url;
}

// ── Riwayat revisi ───────────────────────────────────────────────────────────

const revisionOf = (p: SitePost) => ({
  title: p.title, slug: p.slug, metaTitle: p.metaTitle, metaDescription: p.metaDescription, focusKeyword: p.focusKeyword,
  excerpt: p.excerpt, bodyMd: p.bodyMd, coverUrl: p.coverUrl ?? '', coverAlt: p.coverAlt, category: p.category, tags: p.tags,
  status: p.status, noindex: p.noindex, author: p.author, publishedAt: p.publishedAt,
});

export interface Revision {
  id: string;
  createdAt: number;
  createdBy: string;
  title: string;
  words: number;
}

export async function revisions(postId: string): Promise<Revision[]> {
  const r = await sql<Row[]>`SELECT id, created_at, created_by, snapshot FROM site_post_revisions WHERE post_id = ${postId} ORDER BY created_at DESC LIMIT 30`;
  return r.map((x) => {
    const snap = x.snapshot as { title: string; bodyMd: string };
    return { id: x.id as string, createdAt: Number(x.created_at), createdBy: x.created_by as string, title: snap.title, words: (snap.bodyMd.match(/\S+/g) ?? []).length };
  });
}

/** Pulihkan revisi (versi saat ini ikut tersimpan sebagai revisi baru, jadi bisa dibatalkan). */
export async function restoreRevision(postId: string, revId: string, admin: string): Promise<SitePost> {
  const r = await sql<Row[]>`SELECT snapshot FROM site_post_revisions WHERE id = ${revId} AND post_id = ${postId}`;
  if (!r[0]) throw validation('Revisi tidak ditemukan.');
  const cur = await getById(postId);
  if (!cur) throw validation('Konten tidak ditemukan.');
  const snap = r[0].snapshot as ReturnType<typeof revisionOf>;
  return save(postId, { ...snap, kind: cur.kind }, admin);
}

/** Retensi formulir situs (kebijakan privasi): hapus kiriman > 12 bulan. */
export async function purgeOldLeads(now = nowMs()): Promise<number> {
  const r = await sql`DELETE FROM site_leads WHERE created_at < ${now - 365 * 86_400_000} RETURNING id`;
  return r.length;
}
