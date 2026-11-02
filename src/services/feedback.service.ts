import { z } from 'zod';
import { sql } from '../db/client.js';
import { uuid } from '../lib/uuid.js';
import { nowMs } from '../lib/time.js';
import { AppError } from '../lib/errors.js';

/**
 * Saran dari pengguna app Sirko. Dikirim app (POST /v1/feedback, business_id &
 * user dari JWT), ditinjau admin di dashboard (/dashboard/feedback).
 */

export const FEEDBACK_CATEGORIES = ['saran', 'masalah', 'pertanyaan', 'lainnya'] as const;
export const FEEDBACK_STATUSES = ['baru', 'dibaca', 'diproses', 'selesai', 'ditolak'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** Batas kiriman per toko per 24 jam (cegah spam/bot). */
const DAILY_LIMIT = 20;

export const feedbackCreateSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES).default('saran'),
  message: z.string().trim().min(3, 'Saran minimal 3 karakter').max(2000),
  contact: z.string().trim().max(120).nullish(),
  appVersion: z.string().trim().max(40).nullish(),
  platform: z.string().trim().max(40).nullish(),
});
export type FeedbackCreateInput = z.infer<typeof feedbackCreateSchema>;

type Row = Record<string, unknown>;

function serialize(r: Row) {
  return {
    id: r.id as string,
    category: r.category as string,
    message: r.message as string,
    contact: (r.contact as string) ?? null,
    status: r.status as string,
    /** Balasan/catatan admin — boleh ditampilkan ke pengirim di app. */
    adminNote: (r.admin_note as string) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export async function create(
  auth: { businessId: string; userId: string },
  input: FeedbackCreateInput,
): Promise<ReturnType<typeof serialize>> {
  const ts = nowMs();
  const recent = await sql<{ c: number }[]>`
    SELECT count(*)::int c FROM feedback WHERE business_id = ${auth.businessId} AND created_at > ${ts - 86_400_000}`;
  if ((recent[0]?.c ?? 0) >= DAILY_LIMIT) {
    throw new AppError('RATE_LIMITED', 'Batas kirim saran hari ini tercapai. Coba lagi besok.');
  }
  const users = await sql<{ name: string | null }[]>`
    SELECT name FROM users WHERE id = ${auth.userId} AND business_id = ${auth.businessId}`;
  const rows = await sql<Row[]>`
    INSERT INTO feedback ${sql({
      id: uuid(),
      business_id: auth.businessId,
      user_id: auth.userId,
      user_name: users[0]?.name ?? null,
      category: input.category,
      message: input.message,
      contact: input.contact ?? null,
      app_version: input.appVersion ?? null,
      platform: input.platform ?? null,
      created_at: ts,
      updated_at: ts,
    })}
    RETURNING *`;
  return serialize(rows[0]!);
}

/** Saran milik toko ini (terbaru dulu) — untuk riwayat di app. */
export async function listMine(businessId: string, limit = 50) {
  const rows = await sql<Row[]>`
    SELECT * FROM feedback WHERE business_id = ${businessId} ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map(serialize);
}

// ── Dashboard admin ──────────────────────────────────────────────────────────

export interface FeedbackItem {
  id: string;
  businessId: string;
  businessName: string | null;
  userName: string | null;
  category: string;
  message: string;
  contact: string | null;
  appVersion: string | null;
  platform: string | null;
  status: string;
  adminNote: string | null;
  handledBy: string | null;
  handledAt: number | null;
  createdAt: number;
}

export interface FeedbackPage {
  items: FeedbackItem[];
  total: number;
  page: number;
  pages: number;
  status: FeedbackStatus | 'semua';
  category: string | undefined;
  counts: Record<string, number>;
  serverTime: number;
}

export async function adminList(opts: {
  page: number;
  limit: number;
  status: FeedbackStatus | 'semua';
  category?: string;
  businessId?: string;
}): Promise<FeedbackPage> {
  const conds = [sql`true`];
  if (opts.status !== 'semua') conds.push(sql`f.status = ${opts.status}`);
  if (opts.category) conds.push(sql`f.category = ${opts.category}`);
  if (opts.businessId) conds.push(sql`f.business_id = ${opts.businessId}`);
  const where = conds.reduce((a, c) => sql`${a} AND ${c}`);

  const [totalRows, countRows] = await Promise.all([
    sql<{ c: number }[]>`SELECT count(*)::int c FROM feedback f WHERE ${where}`,
    sql<{ status: string; c: number }[]>`SELECT status, count(*)::int c FROM feedback GROUP BY status`,
  ]);
  const total = totalRows[0]?.c ?? 0;
  const pages = Math.max(1, Math.ceil(total / opts.limit));
  const page = Math.min(Math.max(1, opts.page), pages);
  const rows = await sql<Row[]>`
    SELECT f.*, b.name AS business_name FROM feedback f
    LEFT JOIN businesses b ON b.id = f.business_id
    WHERE ${where} ORDER BY f.created_at DESC
    LIMIT ${opts.limit} OFFSET ${(page - 1) * opts.limit}`;

  const counts: Record<string, number> = Object.fromEntries(FEEDBACK_STATUSES.map((s) => [s, 0]));
  for (const r of countRows) counts[r.status] = r.c;
  counts.semua = Object.values(counts).reduce((a, b) => a + b, 0);

  return {
    items: rows.map((r) => ({
      id: r.id as string,
      businessId: r.business_id as string,
      businessName: (r.business_name as string) ?? null,
      userName: (r.user_name as string) ?? null,
      category: r.category as string,
      message: r.message as string,
      contact: (r.contact as string) ?? null,
      appVersion: (r.app_version as string) ?? null,
      platform: (r.platform as string) ?? null,
      status: r.status as string,
      adminNote: (r.admin_note as string) ?? null,
      handledBy: (r.handled_by as string) ?? null,
      handledAt: r.handled_at == null ? null : Number(r.handled_at),
      createdAt: Number(r.created_at),
    })),
    total,
    page,
    pages,
    status: opts.status,
    category: opts.category,
    counts,
    serverTime: nowMs(),
  };
}

export async function countNew(): Promise<number> {
  const r = await sql<{ c: number }[]>`SELECT count(*)::int c FROM feedback WHERE status = 'baru'`;
  return r[0]?.c ?? 0;
}

/** Ubah status + catatan admin. False bila tak ditemukan. */
export async function adminUpdate(
  id: string,
  patch: { status: FeedbackStatus; adminNote: string | null },
  admin: string,
): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const ts = nowMs();
  const rows = await sql`
    UPDATE feedback SET status = ${patch.status}, admin_note = ${patch.adminNote},
      handled_by = ${admin}, handled_at = ${ts}, updated_at = ${ts}
    WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}
