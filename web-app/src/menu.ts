import type { Permission } from './lib/permissions';

/**
 * Menu aplikasi = modul aplikasi HP. `phase` = fase pengerjaan web (Fase 1 sudah jadi).
 * `perm` = izin yang dibutuhkan (sama dengan gerbang izin di aplikasi).
 */
export interface MenuItem {
  path: string;
  label: string;
  desc: string;
  /** Izin yang dibutuhkan; array = salah satu cukup. */
  perm?: Permission | Permission[];
  /** Hanya pemilik (mis. Toko Saya, Paket Juragan — sama dengan menu Lainnya di HP). */
  ownerOnly?: boolean;
  phase: number;
}

export const MENU: MenuItem[] = [
  { path: '/', label: 'Beranda', desc: 'Ringkasan & status sinkron', phase: 1 },
  { path: '/kasir', label: 'Kasir', desc: 'Jualan, scan barcode, bayar, struk', perm: 'transactionList', phase: 2 },
  { path: '/transaksi', label: 'Riwayat transaksi', desc: 'Nota, void, cetak ulang', perm: 'transactionList', phase: 2 },
  { path: '/produk', label: 'Produk & stok', desc: 'Produk, varian, grosir, stok', perm: 'productManagement', phase: 3 },
  { path: '/pelanggan', label: 'Pelanggan & kasbon', desc: 'Pelanggan, hutang, cicilan', perm: 'customerManagement', phase: 3 },
  { path: '/karyawan', label: 'Karyawan', desc: 'Akun karyawan & PIN', perm: 'userService', phase: 3 },
  { path: '/laporan', label: 'Laporan', desc: 'Laba rugi, penjualan, ekspor', perm: 'transactionExport', phase: 4 },
  { path: '/kas', label: 'Kas & dompet', desc: 'Saldo kas, transfer, arus kas', perm: 'walletView', phase: 4 },
  { path: '/pembelian', label: 'Pembelian & supplier', desc: 'Stok masuk, hutang supplier, opname', perm: 'productManagement', phase: 5 },
  { path: '/ppob', label: 'PPOB & Poin', desc: 'Riwayat PPOB, Poin Sirko, harga jual', perm: ['ppobSell', 'pointTopup'], phase: 5 },
  { path: '/toko', label: 'Toko Saya', desc: 'Pindah/tambah toko, laporan gabungan, transfer stok', ownerOnly: true, phase: 5 },
  { path: '/langganan', label: 'Paket Juragan', desc: 'Langganan & masa berlaku paket', ownerOnly: true, phase: 5 },
  { path: '/data', label: 'Data & sinkron', desc: 'Isi data toko di browser ini', phase: 1 },
  { path: '/pengaturan', label: 'Pengaturan', desc: 'Toko, struk, printer', perm: 'settingCompany', phase: 3 },
];

/** Fase yang sudah tersedia di web. */
export const CURRENT_PHASE = 5;

/** Menu terlihat untuk pengguna ini? (`can` & `isOwner` dari state). */
export const menuVisible = (m: MenuItem, can: (p: Permission) => boolean, isOwner: boolean) =>
  (!m.ownerOnly || isOwner) && (!m.perm || (Array.isArray(m.perm) ? m.perm.some(can) : can(m.perm)));
