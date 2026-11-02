import { sql } from '../db/client.js';
import { nowMs } from '../lib/time.js';
import { CatalogContributionRepository } from '../db/repositories/catalog-contribution.repository.js';
import { BackupRepository } from '../db/repositories/backup.repository.js';
import { BACKUP_TABLE_BY_WIRE, BACKUP_TABLES, type BackupTable } from '../db/backup-tables.js';

/**
 * Dashboard service — pembaca LINTAS-TENANT (mode admin/monitoring). Sengaja
 * membaca semua toko untuk ringkasan & halaman detail berpaginasi. Hanya baca.
 */

function n(v: unknown): number {
  return v === null || v === undefined ? 0 : Number(v);
}

export interface Counts {
  businesses: number;
  accounts: number;
  users: number;
  catalog: number;
  products: number;
  customers: number;
  transactions: number;
}

async function getCounts(): Promise<Counts> {
  const rows = await sql<Record<string, string>[]>`
    SELECT
      (SELECT count(*) FROM businesses WHERE deleted_at IS NULL)      AS businesses,
      (SELECT count(*) FROM accounts)                                 AS accounts,
      (SELECT count(*) FROM users WHERE deleted_at IS NULL)           AS users,
      (SELECT count(*) FROM public_products WHERE deleted_at IS NULL) AS catalog,
      (SELECT count(*) FROM products WHERE deleted_at IS NULL)        AS products,
      (SELECT count(*) FROM customers WHERE deleted_at IS NULL)       AS customers,
      (SELECT count(*) FROM transactions WHERE deleted_at IS NULL)    AS transactions
  `;
  const r = rows[0] ?? {};
  return {
    businesses: n(r.businesses),
    accounts: n(r.accounts),
    users: n(r.users),
    catalog: n(r.catalog),
    products: n(r.products),
    customers: n(r.customers),
    transactions: n(r.transactions),
  };
}

// ── Overview (ringkasan) ──────────────────────────────────────────────────────

export interface Overview {
  counts: Counts;
  categories: Array<{ category: string; n: number }>;
  recentCatalog: Array<{
    id: string; name: string | null; barcode: string | null; photoUrl: string | null; category: string | null;
  }>;
  pendingContributions: number;
  serverTime: number;
}

export async function getOverview(): Promise<Overview> {
  const [counts, catRows, recent, pending] = await Promise.all([
    getCounts(),
    categoryCounts(),
    sql<{ id: string; name: string | null; barcode: string | null; photo_url: string | null; category: string | null }[]>`
      SELECT id, name, barcode, photo_url, category FROM public_products
      WHERE deleted_at IS NULL AND photo_url IS NOT NULL
      ORDER BY updated_at DESC NULLS LAST LIMIT 20
    `,
    contribRepo.countByStatus('pending'),
  ]);
  return {
    counts,
    categories: catRows.map((c) => ({ category: c.category, n: n(c.n) })),
    recentCatalog: recent.map((r) => ({
      id: r.id, name: r.name, barcode: r.barcode, photoUrl: r.photo_url, category: r.category,
    })),
    pendingContributions: pending,
    serverTime: nowMs(),
  };
}

// ── Paginasi umum ─────────────────────────────────────────────────────────────

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
  limit: number;
  q: string;
  serverTime: number;
}

function paging(total: number, reqPage: number, limit: number) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(Math.max(1, reqPage), pages);
  return { pages, page, offset: (page - 1) * limit };
}

export interface CatalogItem {
  id: string;
  name: string | null;
  barcode: string | null;
  brand: string | null;
  category: string | null;
  photoUrl: string | null;
  netSize: number | null;
  netUnit: string | null;
  verified: boolean;
  source: string;
  updatedAt: number;
}

/** Kategori tanpa nilai (NULL) ditampilkan & difilter sebagai 'Lainnya'. */
export const UNCATEGORIZED = 'Lainnya';
export const CATALOG_SOURCES = ['admin', 'crowdsource'] as const;
export type CatalogSource = (typeof CATALOG_SOURCES)[number];

export interface CatalogFilters {
  q: string;
  category?: string;
  source?: CatalogSource;
  verified?: boolean;
  /** true = tampilkan Sampah (produk terhapus) alih-alih produk hidup. */
  trash?: boolean;
}

export interface CatalogPage extends Page<CatalogItem> {
  filters: CatalogFilters;
  /** Kategori + jumlah (produk hidup, atau Sampah bila trash) untuk chip filter. */
  categories: Array<{ category: string; n: number }>;
  trashCount: number;
}

export function parseSource(v: string | undefined): CatalogSource | undefined {
  return (CATALOG_SOURCES as readonly string[]).includes(v ?? '') ? (v as CatalogSource) : undefined;
}

function categoryCounts(trash = false) {
  return sql<{ category: string; n: number }[]>`
    SELECT coalesce(category, ${UNCATEGORIZED}) AS category, count(*)::int n
    FROM public_products WHERE ${trash ? sql`deleted_at IS NOT NULL` : sql`deleted_at IS NULL`}
    GROUP BY 1 ORDER BY n DESC, 1
  `;
}

export async function getCatalogPage(opts: {
  page: number;
  limit: number;
  q?: string;
  category?: string;
  source?: CatalogSource;
  verified?: boolean;
  trash?: boolean;
}): Promise<CatalogPage> {
  const q = (opts.q ?? '').trim();
  const category = opts.category?.trim() || undefined;
  const like = `%${q}%`;
  const trash = opts.trash === true;
  const conds = [trash ? sql`deleted_at IS NOT NULL` : sql`deleted_at IS NULL`];
  if (q) conds.push(sql`(name ILIKE ${like} OR brand ILIKE ${like} OR barcode ILIKE ${like})`);
  if (category) {
    conds.push(
      category === UNCATEGORIZED
        ? sql`(category IS NULL OR category = ${category})`
        : sql`category = ${category}`,
    );
  }
  if (opts.source) conds.push(sql`source = ${opts.source}`);
  if (opts.verified !== undefined) conds.push(sql`verified = ${opts.verified}`);
  const where = conds.reduce((acc, c) => sql`${acc} AND ${c}`);

  const [totalRows, categories, trashRows] = await Promise.all([
    sql<{ c: number }[]>`SELECT count(*)::int c FROM public_products WHERE ${where}`,
    categoryCounts(trash),
    sql<{ c: number }[]>`SELECT count(*)::int c FROM public_products WHERE deleted_at IS NOT NULL`,
  ]);
  const total = totalRows[0]?.c ?? 0;
  const { pages, page, offset } = paging(total, opts.page, opts.limit);

  const rows = await sql<
    {
      id: string; name: string | null; barcode: string | null; brand: string | null;
      category: string | null; photo_url: string | null; net_size: string | null;
      net_unit: string | null; verified: boolean; source: string; updated_at: string | null;
    }[]
  >`
    SELECT id, name, barcode, brand, category, photo_url, net_size, net_unit, verified, source, updated_at
    FROM public_products WHERE ${where}
    ORDER BY ${trash ? sql`deleted_at DESC,` : sql``} updated_at DESC NULLS LAST, id
    LIMIT ${opts.limit} OFFSET ${offset}
  `;
  return {
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      barcode: r.barcode,
      brand: r.brand,
      category: r.category,
      photoUrl: r.photo_url,
      netSize: r.net_size === null ? null : n(r.net_size),
      netUnit: r.net_unit,
      verified: r.verified,
      source: r.source,
      updatedAt: n(r.updated_at),
    })),
    total,
    page,
    pages,
    limit: opts.limit,
    q,
    filters: { q, category, source: opts.source, verified: opts.verified, trash: trash || undefined },
    categories,
    trashCount: trashRows[0]?.c ?? 0,
    serverTime: nowMs(),
  };
}

// ── Kontribusi katalog (antrean moderasi) ────────────────────────────────────

const contribRepo = new CatalogContributionRepository();

export interface ContribItem {
  id: string;
  businessName: string | null;
  targetId: string | null;
  barcode: string | null;
  name: string | null;
  brand: string | null;
  category: string | null;
  photoUrl: string | null;
  netSize: number | null;
  netUnit: string | null;
  keywords: string[];
  note: string | null;
  status: string;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: number | null;
  createdAt: number;
}

export interface ContribPage extends Page<ContribItem> {
  status: string;
  counts: { pending: number; approved: number; rejected: number };
}

export async function getContributionsPage(opts: {
  page: number;
  limit: number;
  status?: 'pending' | 'approved' | 'rejected';
}): Promise<ContribPage> {
  const [total, counts] = await Promise.all([
    contribRepo.countByStatus(opts.status),
    contribRepo.statusCounts(),
  ]);
  const { pages, page, offset } = paging(total, opts.page, opts.limit);
  const rows = await contribRepo.listByStatus(opts.status, opts.limit, offset);
  return {
    items: rows.map((r) => ({
      id: r.id as string,
      businessName: (r.business_name as string | null) ?? null,
      targetId: (r.target_id as string | null) ?? null,
      barcode: (r.barcode as string | null) ?? null,
      name: (r.name as string | null) ?? null,
      brand: (r.brand as string | null) ?? null,
      category: (r.category as string | null) ?? null,
      photoUrl: (r.photo_url as string | null) ?? null,
      netSize: r.net_size === null || r.net_size === undefined ? null : n(r.net_size),
      netUnit: (r.net_unit as string | null) ?? null,
      keywords: (r.keywords as string[]) ?? [],
      note: (r.note as string | null) ?? null,
      status: (r.status as string) ?? 'pending',
      reviewNote: (r.review_note as string | null) ?? null,
      reviewedBy: (r.reviewed_by as string | null) ?? null,
      reviewedAt: r.reviewed_at === null || r.reviewed_at === undefined ? null : n(r.reviewed_at),
      createdAt: n(r.created_at),
    })),
    total,
    page,
    pages,
    limit: opts.limit,
    q: '',
    status: opts.status ?? 'all',
    counts,
    serverTime: nowMs(),
  };
}

export interface BusinessItem {
  id: string;
  name: string;
  businessType: string | null;
  createdAt: number;
  users: number;
  products: number;
  transactions: number;
  lastBackupAt: number | null;
}

export async function getBusinessesPage(opts: { page: number; limit: number }): Promise<Page<BusinessItem>> {
  const totalRows = await sql<{ c: number }[]>`SELECT count(*)::int c FROM businesses WHERE deleted_at IS NULL`;
  const total = totalRows[0]?.c ?? 0;
  const { pages, page, offset } = paging(total, opts.page, opts.limit);

  const rows = await sql<
    {
      id: string; name: string; business_type: string | null; created_at: string | null;
      users: string; products: string; transactions: string; last_backup_ms: string | null;
    }[]
  >`
    SELECT b.id, b.name, b.business_type, b.created_at,
      (SELECT count(*) FROM users u WHERE u.business_id = b.id AND u.deleted_at IS NULL) AS users,
      (SELECT count(*) FROM products p WHERE p.business_id = b.id AND p.deleted_at IS NULL) AS products,
      (SELECT count(*) FROM transactions t WHERE t.business_id = b.id AND t.deleted_at IS NULL) AS transactions,
      (SELECT (extract(epoch FROM max(t.server_updated_at)) * 1000)::bigint FROM transactions t WHERE t.business_id = b.id) AS last_backup_ms
    FROM businesses b WHERE b.deleted_at IS NULL
    ORDER BY b.created_at DESC NULLS LAST
    LIMIT ${opts.limit} OFFSET ${offset}
  `;
  return {
    items: rows.map((b) => ({
      id: b.id,
      name: b.name,
      businessType: b.business_type,
      createdAt: n(b.created_at),
      users: n(b.users),
      products: n(b.products),
      transactions: n(b.transactions),
      lastBackupAt: b.last_backup_ms === null ? null : n(b.last_backup_ms),
    })),
    total,
    page,
    pages,
    limit: opts.limit,
    q: '',
    serverTime: nowMs(),
  };
}

export interface TxItem {
  id: string;
  businessId: string;
  invoiceNo: string | null;
  businessName: string | null;
  grandTotal: number;
  status: string | null;
  datetime: number | null;
}

export async function getTransactionsPage(opts: { page: number; limit: number }): Promise<Page<TxItem>> {
  const totalRows = await sql<{ c: number }[]>`SELECT count(*)::int c FROM transactions WHERE deleted_at IS NULL`;
  const total = totalRows[0]?.c ?? 0;
  const { pages, page, offset } = paging(total, opts.page, opts.limit);

  const rows = await sql<
    {
      id: string; business_id: string; invoice_no: string | null; business_name: string | null;
      grand_total: string | null; status: string | null; datetime: string | null;
    }[]
  >`
    SELECT t.id, t.business_id, t.invoice_no, b.name AS business_name, t.grand_total, t.status, t.datetime
    FROM transactions t JOIN businesses b ON b.id = t.business_id
    WHERE t.deleted_at IS NULL
    ORDER BY t.server_updated_at DESC
    LIMIT ${opts.limit} OFFSET ${offset}
  `;
  return {
    items: rows.map((t) => ({
      id: t.id,
      businessId: t.business_id,
      invoiceNo: t.invoice_no,
      businessName: t.business_name,
      grandTotal: n(t.grand_total),
      status: t.status,
      datetime: t.datetime === null ? null : n(t.datetime),
    })),
    total,
    page,
    pages,
    limit: opts.limit,
    q: '',
    serverTime: nowMs(),
  };
}

// ── Detail toko (data cadangan per toko) ─────────────────────────────────────

export interface BusinessDetail {
  business: Record<string, unknown>;
  owner: { name: string | null; email: string | null; phone: string | null } | null;
  counts: Record<string, number>;
  lastBackupAt: number | null;
  feedbackCount: number;
  serverTime: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tabel backup yang ditampilkan per toko (semua kecuali singleton `business`). */
export const BUSINESS_TABS: BackupTable[] = BACKUP_TABLES.filter((t) => t.kind !== 'singleton');

export async function getBusinessDetail(id: string): Promise<BusinessDetail | null> {
  if (!UUID_RE.test(id)) return null;
  const [biz, owner, summary, fb] = await Promise.all([
    sql<Record<string, unknown>[]>`SELECT * FROM businesses WHERE id = ${id} LIMIT 1`,
    sql<{ name: string | null; email: string | null; phone: string | null }[]>`
      SELECT u.name, a.email::text AS email, a.phone
      FROM users u LEFT JOIN accounts a ON a.id = u.account_id
      WHERE u.business_id = ${id} AND u.role = 'owner'
      ORDER BY u.created_at LIMIT 1`,
    new BackupRepository(id).statusSummary(),
    sql<{ c: number }[]>`SELECT count(*)::int c FROM feedback WHERE business_id = ${id}`,
  ]);
  if (!biz[0]) return null;
  return {
    business: biz[0],
    owner: owner[0] ?? null,
    counts: summary.counts,
    lastBackupAt: summary.lastBackupAt,
    feedbackCount: fb[0]?.c ?? 0,
    serverTime: nowMs(),
  };
}

export interface BusinessTablePage extends Page<Record<string, unknown>> {
  table: BackupTable;
  deleted: boolean;
  /** Nama tampilan untuk kolom relasi: wire kolom → (id → nama). */
  refs: Record<string, Record<string, string>>;
}

/** Kolom relasi (uuid) → tabel tujuan + kolom nama tampilan. */
const REF_TARGETS: Record<string, { db: string; label: string }> = {
  categoryId: { db: 'categories', label: 'name' },
  unitId: { db: 'units', label: 'name' },
  productId: { db: 'products', label: 'name' },
  variantId: { db: 'product_variants', label: 'name' },
  customerId: { db: 'customers', label: 'name' },
  cashierId: { db: 'users', label: 'name' },
  employeeId: { db: 'users', label: 'name' },
  userId: { db: 'users', label: 'name' },
  supplierId: { db: 'suppliers', label: 'name' },
  walletId: { db: 'wallets', label: 'name' },
  targetWalletId: { db: 'wallets', label: 'name' },
  transactionId: { db: 'transactions', label: 'invoice_no' },
  purchaseId: { db: 'purchases', label: 'ref_no' },
};

/** Ambil nama tampilan untuk semua id relasi di halaman ini (1 query per kolom). */
async function resolveRefs(
  businessId: string,
  table: BackupTable,
  rows: Record<string, unknown>[],
): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {};
  await Promise.all(
    table.cols
      .filter((c) => c.type === 'uuid' && REF_TARGETS[c.wire])
      .map(async (c) => {
        const ids = [...new Set(rows.map((r) => r[c.db]).filter((v): v is string => typeof v === 'string'))];
        if (ids.length === 0) return;
        const target = REF_TARGETS[c.wire]!;
        const found = await sql<{ id: string; label: string | null }[]>`
          SELECT id, ${sql(target.label)} AS label FROM ${sql(target.db)}
          WHERE business_id = ${businessId} AND id = ANY(${ids}::uuid[])`;
        out[c.wire] = Object.fromEntries(found.filter((f) => f.label).map((f) => [f.id, f.label as string]));
      }),
  );
  return out;
}

/** Baris satu tabel backup milik toko (generik dari registry), terbaru dulu. */
export async function getBusinessTable(
  businessId: string,
  wire: string,
  opts: { page: number; limit: number; deleted: boolean },
): Promise<BusinessTablePage | null> {
  const table = BACKUP_TABLE_BY_WIRE.get(wire);
  if (!table || table.kind === 'singleton' || !UUID_RE.test(businessId)) return null;
  const t = sql(table.db);
  const del = opts.deleted ? sql`deleted_at IS NOT NULL` : sql`deleted_at IS NULL`;
  const totalRows = await sql<{ c: number }[]>`
    SELECT count(*)::int c FROM ${t} WHERE business_id = ${businessId} AND ${del}`;
  const total = totalRows[0]?.c ?? 0;
  const { pages, page, offset } = paging(total, opts.page, opts.limit);
  const cols = ['id', 'created_at', 'updated_at', 'deleted_at', ...table.cols.map((c) => c.db)];
  const rows = await sql<Record<string, unknown>[]>`
    SELECT ${sql(cols)} FROM ${t}
    WHERE business_id = ${businessId} AND ${del}
    ORDER BY ${table.cols.some((c) => c.db === 'datetime') ? sql`datetime DESC NULLS LAST,` : sql``} updated_at DESC, id
    LIMIT ${opts.limit} OFFSET ${offset}`;
  return {
    table,
    deleted: opts.deleted,
    refs: await resolveRefs(businessId, table, rows),
    items: rows,
    total,
    page,
    pages,
    limit: opts.limit,
    q: '',
    serverTime: nowMs(),
  };
}
