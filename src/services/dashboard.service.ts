import { sql } from '../db/client.js';
import { nowMs } from '../lib/time.js';

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
  recentCatalog: Array<{ id: string; name: string | null; photoUrl: string | null; category: string | null }>;
  serverTime: number;
}

export async function getOverview(): Promise<Overview> {
  const [counts, catRows, recent] = await Promise.all([
    getCounts(),
    sql<{ category: string | null; n: string }[]>`
      SELECT coalesce(category, 'Lainnya') AS category, count(*)::int n
      FROM public_products WHERE deleted_at IS NULL
      GROUP BY 1 ORDER BY n DESC
    `,
    sql<{ id: string; name: string | null; photo_url: string | null; category: string | null }[]>`
      SELECT id, name, photo_url, category FROM public_products
      WHERE deleted_at IS NULL AND photo_url IS NOT NULL
      ORDER BY updated_at DESC NULLS LAST LIMIT 12
    `,
  ]);
  return {
    counts,
    categories: catRows.map((c) => ({ category: c.category ?? 'Lainnya', n: n(c.n) })),
    recentCatalog: recent.map((r) => ({ id: r.id, name: r.name, photoUrl: r.photo_url, category: r.category })),
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

export async function getCatalogPage(opts: { page: number; limit: number; q?: string }): Promise<Page<CatalogItem>> {
  const q = (opts.q ?? '').trim();
  const like = `%${q}%`;
  const where = q
    ? sql`deleted_at IS NULL AND (name ILIKE ${like} OR brand ILIKE ${like} OR barcode ILIKE ${like})`
    : sql`deleted_at IS NULL`;

  const totalRows = await sql<{ c: number }[]>`SELECT count(*)::int c FROM public_products WHERE ${where}`;
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
    ORDER BY updated_at DESC NULLS LAST, id
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
      id: string; invoice_no: string | null; business_name: string | null;
      grand_total: string | null; status: string | null; datetime: string | null;
    }[]
  >`
    SELECT t.id, t.invoice_no, b.name AS business_name, t.grand_total, t.status, t.datetime
    FROM transactions t JOIN businesses b ON b.id = t.business_id
    WHERE t.deleted_at IS NULL
    ORDER BY t.server_updated_at DESC
    LIMIT ${opts.limit} OFFSET ${offset}
  `;
  return {
    items: rows.map((t) => ({
      id: t.id,
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
