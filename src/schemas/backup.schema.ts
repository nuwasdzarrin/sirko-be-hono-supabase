import { z } from 'zod';
import { BACKUP_TABLES, type BackupTable, type Col } from '../db/backup-tables.js';

/**
 * Skema zod backup. Filosofi: validasi STRUKTUR, bukan nilai bisnis — agar server
 * "tak menolak sale" (spec 08 §1). Yang wajib hanya `id` (uuid) & `updatedAt`
 * (epoch ms); kolom domain nullable; enum divalidasi bila hadir; `businessId` di
 * baris diabaikan (di-strip). Baris cacat struktur → masuk `rejected` (bukan
 * menggagalkan batch).
 */

const safeInt = z
  .number()
  .int()
  .refine((n) => Number.isSafeInteger(n), 'Integer di luar rentang aman');

function colSchema(col: Col): z.ZodTypeAny {
  switch (col.type) {
    case 'text':
      return z.string().nullish();
    case 'int':
    case 'money':
      return safeInt.nullish();
    case 'bool':
      return z.boolean().nullish();
    case 'uuid':
      return z.string().uuid().nullish();
    case 'enum':
      return z.enum(col.enum as [string, ...string[]]).nullish();
    case 'json':
      return z.any().nullish();
  }
}

function rowSchema(table: BackupTable): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {
    id: z.string().uuid(),
    updatedAt: safeInt,
    createdAt: safeInt.nullish(),
    deletedAt: safeInt.nullish(),
  };
  for (const col of table.cols) shape[col.wire] = colSchema(col);
  // Strip field tak dikenal (mis. businessId) → diabaikan, bukan ditolak.
  return z.object(shape);
}

/** Skema per-baris per tabel (dipakai service untuk validasi tiap baris). */
export const ROW_SCHEMAS: Map<string, z.ZodTypeAny> = new Map(
  BACKUP_TABLES.map((t) => [t.wire, rowSchema(t)]),
);

/** Envelope push (spec 10 §2.1) — baris divalidasi per-baris di service. */
export const pushEnvelopeSchema = z.object({
  clientInfo: z
    .object({
      deviceId: z.string().optional(),
      appVersion: z.string().optional(),
      schemaVersion: z.number().int().optional(),
    })
    .optional(),
  tables: z.record(z.string(), z.array(z.unknown())).default({}),
});
export type PushEnvelope = z.infer<typeof pushEnvelopeSchema>;

/** Query pull (spec 10 §2.2). `cursor` opaque; `limit` 1..1000 default 500. */
export const pullQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});
export type PullQuery = z.infer<typeof pullQuerySchema>;
