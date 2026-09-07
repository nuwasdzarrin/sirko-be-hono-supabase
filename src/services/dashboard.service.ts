import { sql } from '../db/client.ts';
import { nowMs } from '../lib/time.ts';

/**
 * Dashboard service — pembaca LINTAS-TENANT (mode admin/monitoring). Berbeda dari
 * TenantRepository: sengaja membaca semua toko untuk ringkasan. Cikal-bakal
 * "Panel Admin Sirko". Hanya baca; tak menulis.
 */

function n(v: unknown): number {
  return v === null || v === undefined ? 0 : Number(v);
}

export interface DashboardData {
  counts: {
    businesses: number;
    accounts: number;
    users: number;
    catalog: number;
    products: number;
    customers: number;
    transactions: number;
  };
  businesses: Array<{
    id: string;
    name: string;
    businessType: string | null;
    createdAt: number;
    users: number;
    products: number;
    transactions: number;
    lastBackupAt: number | null;
  }>;
  catalog: Array<{
    id: string;
    name: string | null;
    barcode: string | null;
    brand: string | null;
    category: string | null;
    verified: boolean;
    source: string;
    updatedAt: number;
  }>;
  recentTransactions: Array<{
    id: string;
    invoiceNo: string | null;
    businessName: string | null;
    grandTotal: number;
    status: string | null;
    datetime: number | null;
  }>;
  serverTime: number;
}

export async function getDashboardData(): Promise<DashboardData> {
  const [countsRow] = await sql<
    {
      businesses: string;
      accounts: string;
      users: string;
      catalog: string;
      products: string;
      customers: string;
      transactions: string;
    }[]
  >`
    SELECT
      (SELECT count(*) FROM businesses WHERE deleted_at IS NULL)      AS businesses,
      (SELECT count(*) FROM accounts)                                 AS accounts,
      (SELECT count(*) FROM users WHERE deleted_at IS NULL)           AS users,
      (SELECT count(*) FROM public_products WHERE deleted_at IS NULL) AS catalog,
      (SELECT count(*) FROM products WHERE deleted_at IS NULL)        AS products,
      (SELECT count(*) FROM customers WHERE deleted_at IS NULL)       AS customers,
      (SELECT count(*) FROM transactions WHERE deleted_at IS NULL)    AS transactions
  `;

  const businessRows = await sql<
    {
      id: string;
      name: string;
      business_type: string | null;
      created_at: string | null;
      users: string;
      products: string;
      transactions: string;
      last_backup_ms: string | null;
    }[]
  >`
    SELECT b.id, b.name, b.business_type, b.created_at,
      (SELECT count(*) FROM users u WHERE u.business_id = b.id AND u.deleted_at IS NULL)        AS users,
      (SELECT count(*) FROM products p WHERE p.business_id = b.id AND p.deleted_at IS NULL)     AS products,
      (SELECT count(*) FROM transactions t WHERE t.business_id = b.id AND t.deleted_at IS NULL) AS transactions,
      (SELECT (extract(epoch FROM max(t.server_updated_at)) * 1000)::bigint
         FROM transactions t WHERE t.business_id = b.id)                                        AS last_backup_ms
    FROM businesses b
    WHERE b.deleted_at IS NULL
    ORDER BY b.created_at DESC NULLS LAST
    LIMIT 50
  `;

  const catalogRows = await sql<
    {
      id: string;
      name: string | null;
      barcode: string | null;
      brand: string | null;
      category: string | null;
      verified: boolean;
      source: string;
      updated_at: string | null;
    }[]
  >`
    SELECT id, name, barcode, brand, category, verified, source, updated_at
    FROM public_products WHERE deleted_at IS NULL
    ORDER BY updated_at DESC NULLS LAST LIMIT 20
  `;

  const txRows = await sql<
    {
      id: string;
      invoice_no: string | null;
      business_name: string | null;
      grand_total: string | null;
      status: string | null;
      datetime: string | null;
    }[]
  >`
    SELECT t.id, t.invoice_no, b.name AS business_name, t.grand_total, t.status, t.datetime
    FROM transactions t JOIN businesses b ON b.id = t.business_id
    WHERE t.deleted_at IS NULL
    ORDER BY t.server_updated_at DESC LIMIT 15
  `;

  return {
    counts: {
      businesses: n(countsRow?.businesses),
      accounts: n(countsRow?.accounts),
      users: n(countsRow?.users),
      catalog: n(countsRow?.catalog),
      products: n(countsRow?.products),
      customers: n(countsRow?.customers),
      transactions: n(countsRow?.transactions),
    },
    businesses: businessRows.map((b) => ({
      id: b.id,
      name: b.name,
      businessType: b.business_type,
      createdAt: n(b.created_at),
      users: n(b.users),
      products: n(b.products),
      transactions: n(b.transactions),
      lastBackupAt: b.last_backup_ms === null ? null : n(b.last_backup_ms),
    })),
    catalog: catalogRows.map((c) => ({
      id: c.id,
      name: c.name,
      barcode: c.barcode,
      brand: c.brand,
      category: c.category,
      verified: c.verified,
      source: c.source,
      updatedAt: n(c.updated_at),
    })),
    recentTransactions: txRows.map((t) => ({
      id: t.id,
      invoiceNo: t.invoice_no,
      businessName: t.business_name,
      grandTotal: n(t.grand_total),
      status: t.status,
      datetime: t.datetime === null ? null : n(t.datetime),
    })),
    serverTime: nowMs(),
  };
}
