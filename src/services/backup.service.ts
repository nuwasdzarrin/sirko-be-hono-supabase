import { sql } from '../db/client.ts';
import { BackupRepository } from '../db/repositories/backup.repository.ts';
import {
  BACKUP_TABLES,
  SUPPORTED_SCHEMA_VERSION,
  type BackupTable,
} from '../db/backup-tables.ts';
import { ROW_SCHEMAS, type PushEnvelope, type PullQuery } from '../schemas/backup.schema.ts';
import { decodeCursor, encodeCursor, posFor, type CursorState } from '../lib/cursor.ts';
import { nowMs } from '../lib/time.ts';
import { upgradeRequired } from '../lib/errors.ts';

/**
 * Backup service — orkestrasi push/pull/status.
 *
 * NON-NEGOSIASI:
 *  - Server TIDAK menolak sale yang sudah terjadi: hanya `rejected` bila payload
 *    cacat STRUKTUR (zod). Baris valid selalu disimpan (LWW/append).
 *  - `businessId` SELALU dari JWT (parameter), tak pernah dari body.
 */

// ── Push ─────────────────────────────────────────────────────────────────────

interface RejectedRow {
  table: string;
  id: string | null;
  code: 'VALIDATION';
  message: string;
}
interface SkippedRow {
  table: string;
  id: string;
  reason: 'STALE';
}
export interface PushResult {
  serverTime: number;
  applied: Record<string, number>;
  skipped: SkippedRow[];
  rejected: RejectedRow[];
}

export async function push(
  businessId: string,
  envelope: PushEnvelope,
  idempotencyKey?: string,
): Promise<PushResult> {
  const version = envelope.clientInfo?.schemaVersion;
  if (version != null && version > SUPPORTED_SCHEMA_VERSION) {
    throw upgradeRequired(
      `schemaVersion ${version} belum didukung server (maks ${SUPPORTED_SCHEMA_VERSION})`,
      { code: 'UPGRADE_REQUIRED', supported: SUPPORTED_SCHEMA_VERSION },
    );
  }

  // Retry seluruh batch dikenali via Idempotency-Key.
  if (idempotencyKey) {
    const cached = await new BackupRepository(businessId).findIdempotent(idempotencyKey);
    if (cached) return cached as PushResult;
  }

  // 1) Validasi per-baris + dedupe by id (ambil updatedAt tertinggi).
  const rejected: RejectedRow[] = [];
  const perTable = new Map<string, Record<string, unknown>[]>();

  for (const table of BACKUP_TABLES) {
    const raw = envelope.tables[table.wire];
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const schema = ROW_SCHEMAS.get(table.wire)!;
    const byId = new Map<string, Record<string, unknown>>();

    for (const item of raw) {
      const parsed = schema.safeParse(item);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        rejected.push({
          table: table.wire,
          id: typeof (item as { id?: unknown })?.id === 'string' ? (item as { id: string }).id : null,
          code: 'VALIDATION',
          message: issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : 'Validasi gagal',
        });
        continue;
      }
      const row = parsed.data as Record<string, unknown> & { id: string; updatedAt: number };
      const existing = byId.get(row.id) as { updatedAt: number } | undefined;
      if (!existing || row.updatedAt > existing.updatedAt) byId.set(row.id, row);
    }
    if (byId.size > 0) perTable.set(table.wire, [...byId.values()]);
  }

  // 2) Terapkan dalam SATU transaksi DB (all-or-nothing per request).
  const applied: Record<string, number> = {};
  const skipped: SkippedRow[] = [];

  await sql.begin(async (tx) => {
    const repo = new BackupRepository(businessId, tx);
    for (const table of BACKUP_TABLES) {
      const rows = perTable.get(table.wire);
      if (!rows || rows.length === 0) continue;

      if (table.kind === 'singleton') {
        const row = rows[rows.length - 1]!; // business = 1 baris
        const ok = await repo.updateSingletonBusiness(row);
        applied[table.wire] = ok ? 1 : 0;
        if (!ok) skipped.push({ table: table.wire, id: row.id as string, reason: 'STALE' });
      } else if (table.kind === 'lww') {
        const { appliedIds } = await repo.upsertLww(table, rows);
        applied[table.wire] = appliedIds.size;
        for (const r of rows) {
          if (!appliedIds.has(r.id as string)) {
            skipped.push({ table: table.wire, id: r.id as string, reason: 'STALE' });
          }
        }
      } else {
        // append-only: semua tersimpan/idempotent (DO NOTHING tak menggandakan).
        await repo.insertAppend(table, rows);
        applied[table.wire] = rows.length;
      }
    }
  });

  const result: PushResult = { serverTime: nowMs(), applied, skipped, rejected };

  if (idempotencyKey) {
    await new BackupRepository(businessId).saveIdempotent(idempotencyKey, result, nowMs());
  }
  return result;
}

// ── Pull ─────────────────────────────────────────────────────────────────────

export interface PullResult {
  data: { serverTime: number; tables: Record<string, Record<string, unknown>[]> };
  meta: { nextCursor: string; hasMore: boolean };
}

export async function pull(businessId: string, query: PullQuery): Promise<PullResult> {
  const state = decodeCursor(query.cursor);
  const limit = query.limit;
  const repo = new BackupRepository(businessId);

  const tables: Record<string, Record<string, unknown>[]> = {};
  const nextState: CursorState = { ...state };
  let hasMore = false;

  for (const table of BACKUP_TABLES) {
    const pos = posFor(state, table.wire);
    const rows = await repo.pullTable(table, pos.ts, pos.id, limit);
    if (rows.length === 0) continue;

    tables[table.wire] = rows.map((r) => serializeRow(table, r));
    const last = rows[rows.length - 1]!;
    nextState[table.wire] = { ts: String(last.ssu_us), id: last.id as string };
    if (rows.length === limit) hasMore = true;
  }

  return {
    data: { serverTime: nowMs(), tables },
    meta: { nextCursor: encodeCursor(nextState), hasMore },
  };
}

/** Baris DB (snake_case) → baris wire (camelCase) + serverUpdatedAt (epoch ms). */
function serializeRow(table: BackupTable, db: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: db.id,
    updatedAt: toNum(db.updated_at),
    deletedAt: toNum(db.deleted_at),
    createdAt: toNum(db.created_at),
    serverUpdatedAt: toNum(db.ssu_ms),
  };
  for (const c of table.cols) {
    const v = db[c.db];
    switch (c.type) {
      case 'int':
      case 'money':
        out[c.wire] = toNum(v);
        break;
      default:
        out[c.wire] = v ?? null; // text/uuid/enum/bool/json
    }
  }
  return out;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'number' ? v : Number(v);
}

// ── Status ───────────────────────────────────────────────────────────────────

export interface StatusResult {
  lastBackupAt: number | null;
  counts: Record<string, number>;
  serverTime: number;
}

export async function status(businessId: string): Promise<StatusResult> {
  const { counts, lastBackupAt } = await new BackupRepository(businessId).statusSummary();
  return { lastBackupAt, counts, serverTime: nowMs() };
}
