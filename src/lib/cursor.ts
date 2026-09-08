import { BACKUP_WIRE_NAMES } from '../db/backup-tables.js';
import { validation } from './errors.js';

/**
 * Cursor pull = opaque base64(JSON). Menyimpan posisi keyset PER TABEL:
 *   { t: { <wire>: { ts: <server_updated_at dalam MIKRODETIK epoch>, id: <uuid> } } }
 *
 * Keyset `(micros, id) > (ts, id)` memakai MIKRODETIK integer (bukan teks
 * timestamptz — round-trip teks tak akurat di driver) → tie-break `id`
 * menghindari baris terlewat/dobel saat server_updated_at seri.
 * Client menyimpan & mengirim balik apa adanya.
 */

/** Posisi awal (sebelum semua baris). */
export const ZERO_TS = '0';
export const ZERO_ID = '00000000-0000-0000-0000-000000000000';

export interface TablePos {
  ts: string;
  id: string;
}
export type CursorState = Record<string, TablePos>;

export function decodeCursor(raw: string | undefined | null): CursorState {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    throw validation('Cursor tidak valid');
  }
  const t = (parsed as { t?: unknown })?.t;
  if (!t || typeof t !== 'object') throw validation('Cursor tidak valid');

  const state: CursorState = {};
  for (const [wire, pos] of Object.entries(t as Record<string, unknown>)) {
    if (!BACKUP_WIRE_NAMES.includes(wire)) continue; // abaikan tabel tak dikenal
    const p = pos as { ts?: unknown; id?: unknown };
    if (typeof p?.ts !== 'string' || typeof p?.id !== 'string') {
      throw validation('Cursor tidak valid');
    }
    state[wire] = { ts: p.ts, id: p.id };
  }
  return state;
}

export function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify({ t: state }), 'utf8').toString('base64');
}

/** Ambil posisi tabel (atau posisi awal bila belum ada). */
export function posFor(state: CursorState, wire: string): TablePos {
  return state[wire] ?? { ts: ZERO_TS, id: ZERO_ID };
}
