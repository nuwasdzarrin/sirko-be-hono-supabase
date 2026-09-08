import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sql as defaultSql, type Sql } from './client.js';

/**
 * Migration runner — maju-saja, idempotent, portabel. Diekspor sebagai fungsi
 * (tanpa efek samping saat di-import) agar bisa dipakai test & CLI.
 *
 * - File `NNNN_*.sql` di `migrations/` dijalankan berurutan.
 * - Tabel `schema_migrations` mencatat versi yang sudah diterapkan → di-skip.
 * - Tiap file dibungkus SATU transaksi (all-or-nothing).
 * - Tak bergantung tooling Supabase; jalan di Postgres mana pun.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

async function ensureMigrationsTable(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

async function appliedVersions(sql: Sql): Promise<Set<string>> {
  const rows = await sql<{ version: string }[]>`SELECT version FROM schema_migrations`;
  return new Set(rows.map((r) => r.version));
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

/** Terapkan semua migrasi yang belum diterapkan. Aman dipanggil berulang. */
export async function runMigrations(
  sql: Sql = defaultSql,
  log: (msg: string) => void = () => {},
): Promise<MigrateResult> {
  await ensureMigrationsTable(sql);
  const done = await appliedVersions(sql);

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  const result: MigrateResult = { applied: [], skipped: [] };
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (done.has(version)) {
      result.skipped.push(version);
      log(`• skip   ${version} (sudah diterapkan)`);
      continue;
    }

    const content = await readFile(join(migrationsDir, file), 'utf8');
    log(`→ apply  ${version} ...`);

    await sql.begin(async (tx) => {
      // `.simple()` agar satu file berisi banyak statement dieksekusi sekaligus.
      await tx.unsafe(content).simple();
      await tx`INSERT INTO schema_migrations (version) VALUES (${version})`;
    });

    result.applied.push(version);
    log(`✓ done   ${version}`);
  }
  return result;
}
