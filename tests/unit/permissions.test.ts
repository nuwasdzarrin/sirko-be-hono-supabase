import { describe, it, expect } from 'vitest';
import {
  effectivePermissions,
  hasPermission,
  isRole,
  ALL_PERMISSIONS,
} from '../../src/lib/permissions.js';

describe('permissions', () => {
  it('owner/admin/sirko_admin dapat wildcard administrator', () => {
    for (const role of ['owner', 'admin', 'sirko_admin'] as const) {
      expect(effectivePermissions(role)).toEqual(['administrator']);
      expect(hasPermission(effectivePermissions(role), 'walletManagement')).toBe(true);
    }
  });

  it('cashier & staff dapat preset terbatas (bukan wildcard)', () => {
    const cashier = effectivePermissions('cashier');
    expect(cashier).toContain('transactionList');
    expect(cashier).not.toContain('administrator');
    expect(hasPermission(cashier, 'transactionList')).toBe(true);
    expect(hasPermission(cashier, 'administrator')).toBe(false);
    expect(hasPermission(cashier, 'walletManagement')).toBe(false);
  });

  it('custom memakai daftar tersimpan & memfilter permission tak dikenal', () => {
    const perms = effectivePermissions('custom', ['walletView', 'ngawur', 'addProduct']);
    expect(perms).toEqual(['walletView', 'addProduct']);
    expect(hasPermission(perms, 'walletView')).toBe(true);
    expect(hasPermission(perms, 'addUser')).toBe(false);
  });

  it('hasPermission: wildcard administrator mengizinkan apa saja', () => {
    for (const p of ALL_PERMISSIONS) expect(hasPermission(['administrator'], p)).toBe(true);
  });

  it('isRole guard', () => {
    expect(isRole('owner')).toBe(true);
    expect(isRole('sirko_admin')).toBe(true);
    expect(isRole('superman')).toBe(false);
    expect(isRole(123)).toBe(false);
  });
});
