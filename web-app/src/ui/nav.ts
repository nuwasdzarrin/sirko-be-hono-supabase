import type { IconName } from './icon';
import type { Permission } from '../lib/permissions';

/**
 * Satu sumber menu untuk HP & desktop — label, ikon & izin sama dengan aplikasi Flutter
 * (AppConstants.destinations + MorePage). HP: TABS = NavigationBar bawah, OWNER + MORE = halaman
 * Lainnya. Desktop: semuanya di sidebar (tanpa halaman Lainnya, tanpa Pintasan ganda di Beranda).
 */
export interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  iconOn?: IconName;
  perm?: Permission;
  ownerOnly?: boolean;
  /** Keterangan (kartu di halaman Lainnya HP). */
  sub?: string;
  /** Aktif hanya bila path persis sama (mis. /pembelian vs /pembelian/supplier). */
  exact?: boolean;
}

/** Tab utama (NavigationBar HP). "Lainnya" ditambahkan oleh kerangka HP. */
export const TABS: NavItem[] = [
  { path: '/', label: 'Beranda', icon: 'home', iconOn: 'homeFilled', perm: 'dashboardAccess', exact: true },
  { path: '/kasir', label: 'Kasir', icon: 'pointOfSale', iconOn: 'pointOfSaleFilled', perm: 'transactionList' },
  { path: '/produk', label: 'Produk', icon: 'inventory2', iconOn: 'inventory2Filled', perm: 'productManagement' },
  { path: '/laporan', label: 'Laporan', icon: 'barChart', iconOn: 'barChartFilled', perm: 'transactionExport' },
];

/** Kartu khusus pemilik di atas grid Lainnya. */
export const OWNER: NavItem[] = [
  { path: '/langganan', label: 'Paket Juragan', icon: 'workspacePremium', ownerOnly: true, sub: 'Multi-cabang, karyawan, laporan Excel/PDF, logo struk' },
  { path: '/ppob/poin', label: 'Poin Sirko', icon: 'bolt', ownerOnly: true, sub: 'Saldo, top-up & mutasi Poin untuk PPOB' },
  { path: '/toko', label: 'Toko Saya', icon: 'storefront', ownerOnly: true, sub: 'Pindah toko, tambah cabang, laporan gabungan' },
];

/** Grid menu Lainnya (urutan aplikasi HP; item yang belum ada di web dilewati). */
export const MORE: NavItem[] = [
  { path: '/transaksi', label: 'Riwayat Transaksi', icon: 'receiptLong', perm: 'transactionList' },
  { path: '/pelanggan', label: 'Pelanggan', icon: 'peopleAlt', perm: 'customerManagement' },
  { path: '/kas', label: 'Kas / Wallet', icon: 'wallet', perm: 'walletView' },
  { path: '/pembelian/supplier', label: 'Supplier', icon: 'storefront', perm: 'productManagement', exact: true },
  { path: '/pembelian', label: 'Pembelian', icon: 'localShipping', perm: 'productManagement', exact: true },
  { path: '/pembelian/opname', label: 'Stok Opname', icon: 'factCheck', perm: 'productManagement', exact: true },
  { path: '/ppob/riwayat', label: 'Riwayat PPOB', icon: 'bolt', perm: 'ppobSell', exact: true },
  { path: '/karyawan', label: 'Karyawan', icon: 'manageAccounts', perm: 'userService' },
  { path: '/data', label: 'Sinkronisasi', icon: 'cloudSync', perm: 'settingCompany' },
  { path: '/pengaturan', label: 'Pengaturan', icon: 'settings', perm: 'settingCompany' },
];

export const allowed = (i: NavItem, can: (p: Permission) => boolean, isOwner: boolean) =>
  (!i.ownerOnly || isOwner) && (!i.perm || can(i.perm));

export const isActive = (i: NavItem, path: string) =>
  i.exact || i.path === '/' ? path === i.path : path === i.path || path.startsWith(`${i.path}/`);

/** Judul halaman (app bar desktop & bar turunan HP), sama dengan judul layar aplikasi HP. */
const TITLES: Array<[RegExp, string, string]> = [
  [/^\/$/, 'Beranda', ''],
  [/^\/kasir/, 'Kasir', ''],
  [/^\/produk\/baru$/, 'Produk Baru', '/produk'],
  [/^\/produk\/.+/, 'Edit Produk', '/produk'],
  [/^\/produk$/, 'Produk', ''],
  [/^\/laporan/, 'Laporan', ''],
  [/^\/lainnya$/, 'Lainnya', ''],
  [/^\/transaksi\/.+/, 'Detail Transaksi', '/transaksi'],
  [/^\/transaksi$/, 'Riwayat Transaksi', ''],
  [/^\/pelanggan\/baru$/, 'Pelanggan Baru', '/pelanggan'],
  [/^\/pelanggan\/.+/, 'Detail Pelanggan', '/pelanggan'],
  [/^\/pelanggan$/, 'Pelanggan', ''],
  [/^\/kas\/.+/, 'Detail Kas', '/kas'],
  [/^\/kas$/, 'Kas / Wallet', ''],
  [/^\/karyawan$/, 'Karyawan', ''],
  [/^\/pembelian\/supplier$/, 'Supplier', ''],
  [/^\/pembelian\/opname$/, 'Stok Opname', ''],
  [/^\/pembelian/, 'Pembelian', ''],
  [/^\/ppob\/poin$/, 'Poin Sirko', ''],
  [/^\/ppob\/riwayat$/, 'Riwayat PPOB', ''],
  [/^\/ppob/, 'PPOB', ''],
  [/^\/toko/, 'Toko Saya', ''],
  [/^\/langganan$/, 'Paket Juragan', ''],
  [/^\/data$/, 'Sinkronisasi', ''],
  [/^\/pengaturan$/, 'Pengaturan', ''],
];

export function pageTitle(path: string): { title: string; parent: string } | null {
  const hit = TITLES.find(([re]) => re.test(path));
  return hit ? { title: hit[1], parent: hit[2] } : null;
}
