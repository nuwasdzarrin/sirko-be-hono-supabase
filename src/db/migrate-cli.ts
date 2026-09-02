import { sql } from './client.ts';
import { runMigrations } from './migrate.ts';

/**
 * CLI migrasi: `npm run migrate`
 * → node --env-file=.env --import tsx src/db/migrate-cli.ts
 */
runMigrations(sql, (msg) => console.log(msg))
  .then((r) => {
    console.log(
      r.applied.length === 0
        ? 'Tak ada migrasi baru — skema mutakhir.'
        : `Selesai: ${r.applied.length} migrasi diterapkan.`,
    );
  })
  .then(() => sql.end({ timeout: 5 }))
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('Migrasi GAGAL:', err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
