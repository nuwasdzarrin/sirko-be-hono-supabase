/**
 * Hak akses per peran — salinan persis `PermissionResolver` + enum `Permission` di aplikasi Flutter
 * (lib/features/users/domain/permission*.dart). Owner selalu penuh; `custom` dari JSON array nama.
 */

export const PERMISSIONS = [
  'dashboardAccess',
  'productManagement',
  'addProduct',
  'variantManagement',
  'customerManagement',
  'transactionList',
  'transactionUpdate',
  'transactionExport',
  'orderManagement',
  'orderList',
  'creditList',
  'walletView',
  'walletManagement',
  'deleteClosedBill',
  'employeeSummary',
  'notificationSetting',
  'settingCompany',
  'recycleBin',
  'userService',
  'addUser',
  'administrator',
  'viewCostProfit',
  'ppobSell',
  'pointTopup',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type AppRole = 'owner' | 'admin' | 'cashier' | 'staff' | 'custom';

export const PERMISSION_LABEL: Record<Permission, string> = {
  dashboardAccess: 'Akses dashboard',
  productManagement: 'Kelola produk',
  addProduct: 'Tambah produk',
  variantManagement: 'Kelola varian',
  customerManagement: 'Kelola pelanggan',
  transactionList: 'Kasir & riwayat transaksi',
  transactionUpdate: 'Ubah/void transaksi',
  transactionExport: 'Ekspor & laporan',
  orderManagement: 'Kelola order',
  orderList: 'Daftar order',
  creditList: 'Daftar hutang/piutang',
  walletView: 'Lihat kas/wallet',
  walletManagement: 'Kelola kas/wallet',
  deleteClosedBill: 'Hapus bill yang sudah ditutup',
  employeeSummary: 'Ringkasan karyawan',
  notificationSetting: 'Pengaturan notifikasi',
  settingCompany: 'Pengaturan toko',
  recycleBin: 'Recycle Bin',
  userService: 'Kelola karyawan',
  addUser: 'Tambah karyawan',
  administrator: 'Administrator',
  viewCostProfit: 'Lihat laba & harga modal',
  ppobSell: 'Jual PPOB (pulsa, data, token)',
  pointTopup: 'Top-up Poin Sirko',
};

export const ROLE_DEFAULTS: Record<Exclude<AppRole, 'owner' | 'custom'>, readonly Permission[]> = {
  admin: [
    'dashboardAccess', 'productManagement', 'addProduct', 'variantManagement', 'customerManagement',
    'transactionList', 'transactionUpdate', 'transactionExport', 'orderManagement', 'orderList',
    'creditList', 'walletView', 'walletManagement', 'employeeSummary', 'notificationSetting',
    'recycleBin', 'viewCostProfit', 'ppobSell', 'pointTopup',
  ],
  cashier: ['dashboardAccess', 'transactionList', 'customerManagement', 'creditList', 'orderList', 'ppobSell'],
  staff: ['dashboardAccess', 'productManagement', 'addProduct', 'variantManagement', 'recycleBin'],
};

const KNOWN = new Set<string>(PERMISSIONS);

/** JSON array nama permission → set (nama asing diabaikan, JSON rusak → kosong). */
export function decodePermissions(json: unknown): Set<Permission> {
  let v: unknown = json;
  // String JSON (format lokal HP) — bisa juga ter-encode berlapis; buka sampai bukan string.
  for (let i = 0; i < 3 && typeof v === 'string'; i++) {
    if (!v.trim()) return new Set();
    try {
      v = JSON.parse(v);
    } catch {
      return new Set();
    }
  }
  if (!Array.isArray(v)) return new Set();
  return new Set(v.filter((e): e is Permission => typeof e === 'string' && KNOWN.has(e)));
}

export function encodePermissions(p: Iterable<Permission>): string {
  return JSON.stringify([...p].sort());
}

export function resolvePermissions(role: string, custom?: unknown): Set<Permission> {
  switch (role) {
    case 'owner':
      return new Set(PERMISSIONS);
    case 'custom':
      return decodePermissions(custom);
    case 'admin':
    case 'cashier':
    case 'staff':
      return new Set(ROLE_DEFAULTS[role]);
    default:
      return new Set();
  }
}
