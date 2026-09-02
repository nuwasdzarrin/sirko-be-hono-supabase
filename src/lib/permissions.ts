/**
 * RBAC — peran & permission (spec 02 §Multi-User, spec 08 §5).
 *
 * Role: owner / admin / cashier / staff / custom (per-toko) + sirko_admin (internal).
 * Owner selalu punya semua permission atas toko-nya.
 *
 * `administrator` = penanda superuser (wildcard) — memberi semua izin. /v1/me
 * mengembalikan `["administrator"]` untuk owner/admin (sesuai contoh kontrak 10 §1.4).
 */

export const ROLES = ['owner', 'admin', 'cashier', 'staff', 'custom', 'sirko_admin'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

/** Semua konstanta permission (spec 02 §Permission constants). */
export const ALL_PERMISSIONS = [
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
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

const WILDCARD: Permission = 'administrator';

/** Preset permission per peran non-custom. */
const ROLE_PRESETS: Record<Exclude<Role, 'custom'>, Permission[]> = {
  owner: [WILDCARD],
  admin: [WILDCARD],
  sirko_admin: [WILDCARD],
  cashier: ['dashboardAccess', 'transactionList', 'creditList', 'customerManagement', 'walletView'],
  staff: ['dashboardAccess', 'transactionList'],
};

/**
 * Permission efektif seorang user. Untuk `custom`, dipakai daftar tersimpan
 * (kolom `users.permissions`). Untuk peran lain, dipakai preset.
 */
export function effectivePermissions(role: Role, customPermissions: string[] = []): string[] {
  if (role === 'custom') {
    return customPermissions.filter((p): p is Permission =>
      (ALL_PERMISSIONS as readonly string[]).includes(p),
    );
  }
  return ROLE_PRESETS[role];
}

/** True bila daftar permission mencakup `required` (atau punya wildcard administrator). */
export function hasPermission(permissions: string[], required: Permission): boolean {
  return permissions.includes(WILDCARD) || permissions.includes(required);
}
