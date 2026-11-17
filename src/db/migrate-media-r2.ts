import { sql } from './client.js';
import { createS3Storage, getStorage, type StorageProvider } from '../lib/storage.js';
import { env } from '../config/env.js';

/**
 * Pindahkan SEMUA objek media dari storage lama (mis. Supabase Storage) ke storage
 * aktif di env (Cloudflare R2), lalu ganti URL lama → URL baru di seluruh DB.
 *
 *   Sumber  : env MEDIA_SRC_S3_* (kredensial S3 storage lama).
 *   Tujuan  : env S3_* + STORAGE_ENV (objek ditulis ke `<STORAGE_ENV>/<key lama>`).
 *
 * Langkah: list semua key sumber → salin yang belum ada di tujuan (GET presigned →
 * PUT presigned, Content-Type dipertahankan) → bila SEMUA sukses, ganti URL di setiap
 * kolom text/jsonb skema public dalam SATU transaksi. Idempotent: aman diulang.
 *
 * Default = DRY RUN (hanya laporan). Eksekusi: `npm run migrate:media-r2 -- --apply`
 * Env opsional: CONCURRENCY (default 8), FORCE_COPY=1 (salin ulang walau sudah ada).
 */

const APPLY = process.argv.includes('--apply');
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8);
const FORCE_COPY = process.env.FORCE_COPY === '1';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Env ${name} wajib diisi (storage sumber)`);
  return v;
}

const srcBucket = required('MEDIA_SRC_S3_BUCKET');
const src = createS3Storage({
  endpoint: required('MEDIA_SRC_S3_ENDPOINT'),
  region: required('MEDIA_SRC_S3_REGION'),
  bucket: srcBucket,
  accessKeyId: required('MEDIA_SRC_S3_ACCESS_KEY_ID'),
  secretAccessKey: required('MEDIA_SRC_S3_SECRET_ACCESS_KEY'),
  publicBaseUrl: process.env.MEDIA_SRC_S3_PUBLIC_BASE_URL,
});
const dst = getStorage();

/**
 * Bentuk URL publik lama yang mungkin tersimpan di DB. Supabase memakai dua host
 * (`<ref>.supabase.co` & `<ref>.storage.supabase.co`) untuk path publik yang sama.
 */
function oldBases(): string[] {
  const set = new Set<string>();
  const add = (u?: string) => u && set.add(u.replace(/\/$/, '') + '/');
  add(src.publicUrl(''));
  for (const u of (process.env.MEDIA_SRC_EXTRA_BASE_URLS ?? '').split(',')) add(u.trim());
  for (const b of [...set]) {
    const m = /^https:\/\/([a-z0-9]+)\.(storage\.)?supabase\.co(\/.*)$/.exec(b);
    if (m) {
      add(`https://${m[1]}.supabase.co${m[3]}`);
      add(`https://${m[1]}.storage.supabase.co${m[3]}`);
    }
  }
  return [...set];
}

async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw new Error(`${label}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

async function copyObject(from: StorageProvider, to: StorageProvider, key: string): Promise<number> {
  const get = await fetch(from.signGet(key), { signal: AbortSignal.timeout(60000) });
  if (!get.ok) throw new Error(`GET HTTP ${get.status}`);
  const type = get.headers.get('content-type') ?? 'application/octet-stream';
  const body = Buffer.from(await get.arrayBuffer());
  const put = await fetch(to.signPut(key, type), {
    method: 'PUT',
    headers: { 'Content-Type': type },
    body,
    signal: AbortSignal.timeout(60000),
  });
  if (!put.ok) throw new Error(`PUT HTTP ${put.status}: ${(await put.text()).slice(0, 200)}`);
  return body.length;
}

async function copyAll(): Promise<boolean> {
  const keys = (await src.listKeys()).filter((k) => !k.endsWith('/') && !k.endsWith('.emptyFolderPlaceholder'));
  const existing = new Set(FORCE_COPY ? [] : await dst.listKeys());
  const todo = keys.filter((k) => !existing.has(k));
  console.log(`Objek sumber: ${keys.length} · sudah ada di tujuan: ${keys.length - todo.length} · perlu disalin: ${todo.length}`);
  if (!APPLY || todo.length === 0) return true;

  let done = 0;
  let bytes = 0;
  const failed: string[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < todo.length) {
        const key = todo[i++]!;
        try {
          bytes += await withRetry(() => copyObject(src, dst, key), key);
          done++;
          if (done % 200 === 0) console.log(`  … ${done}/${todo.length}`);
        } catch (e) {
          failed.push(key);
          console.error(`  ✗ ${(e as Error).message}`);
        }
      }
    }),
  );
  console.log(`Disalin: ${done} objek (${(bytes / 1048576).toFixed(1)} MB) · gagal: ${failed.length}`);
  return failed.length === 0;
}

interface Target {
  table: string;
  column: string;
  type: string;
}

async function rewriteUrls(): Promise<void> {
  const bases = oldBases();
  const newBase = dst.publicUrl('');
  console.log(`URL lama → baru:\n${bases.map((b) => `  ${b}`).join('\n')}\n  ⇒ ${newBase}`);

  const cols = await sql<Target[]>`
    SELECT table_name AS table, column_name AS column, data_type AS type
    FROM information_schema.columns c
    WHERE table_schema = 'public'
      AND data_type IN ('text', 'character varying', 'jsonb', 'json')
      AND EXISTS (SELECT 1 FROM information_schema.tables t
                  WHERE t.table_schema = 'public' AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE')
    ORDER BY 1, 2`;

  const hits: Array<Target & { n: number }> = [];
  for (const c of cols) {
    const conds = bases.map((b) => sql`${sql(c.column)}::text LIKE ${'%' + b + '%'}`);
    const where = conds.reduce((a, b) => sql`${a} OR ${b}`);
    const [r] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM ${sql(c.table)} WHERE ${where}`;
    if (r && r.n > 0) hits.push({ ...c, n: r.n });
  }
  if (hits.length === 0) {
    console.log('Tidak ada URL lama di DB.');
    return;
  }
  for (const h of hits) console.log(`  ${h.table}.${h.column}: ${h.n} baris`);
  if (!APPLY) return;

  await sql.begin(async (tx) => {
    for (const h of hits) {
      let expr = tx`${tx(h.column)}::text`;
      for (const b of bases) expr = tx`replace(${expr}, ${b}, ${newBase})`;
      const cast = h.type === 'jsonb' ? tx`::jsonb` : h.type === 'json' ? tx`::json` : tx``;
      const conds = bases.map((b) => tx`${tx(h.column)}::text LIKE ${'%' + b + '%'}`);
      const where = conds.reduce((a, b) => tx`${a} OR ${b}`);
      const res = await tx`UPDATE ${tx(h.table)} SET ${tx(h.column)} = (${expr})${cast} WHERE ${where}`;
      console.log(`  ✓ ${h.table}.${h.column}: ${res.count} baris diperbarui`);
    }
  });
}

async function main(): Promise<void> {
  console.log(`${APPLY ? 'EKSEKUSI' : 'DRY RUN (tambahkan --apply untuk eksekusi)'} — sumber: bucket ${srcBucket} → tujuan: ${env.S3_BUCKET}/${env.STORAGE_ENV}/`);
  const ok = await copyAll();
  if (!ok) {
    console.error('Ada objek gagal disalin → URL di DB TIDAK diganti. Jalankan ulang (yang sudah tersalin dilewati).');
    process.exitCode = 1;
    return;
  }
  await rewriteUrls();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
