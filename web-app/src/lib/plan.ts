/**
 * Paket langganan & hak fitur — salinan `PlanInfo` + `Entitlement` aplikasi Flutter
 * (lib/features/subscription/domain/plan.dart). Server = sumber kebenaran; saat offline
 * diputuskan dari objek `plan` terakhir dengan tenggang 3 hari (J8) dan jam tak boleh mundur.
 */

export type PlanFeature = 'multi_store' | 'staff' | 'advanced_reports' | 'receipt_branding';

export const PLAN_FEATURE_LABEL: Record<PlanFeature, string> = {
  multi_store: 'Multi-cabang',
  staff: 'Multi-karyawan',
  advanced_reports: 'Laporan lanjut (Excel/PDF)',
  receipt_branding: 'Logo di struk',
};

export interface PlanInfo {
  name: string; // warung | juragan
  period: 'monthly' | 'yearly' | null;
  expiresAt: number | null;
  maxStores: number;
  features: PlanFeature[];
  serverTime: number;
}

export const WARUNG: PlanInfo = { name: 'warung', period: null, expiresAt: null, maxStores: 1, features: [], serverTime: 0 };

const KNOWN = new Set<string>(Object.keys(PLAN_FEATURE_LABEL));

export function planFromJson(j: unknown): PlanInfo {
  const o = (j ?? {}) as Record<string, unknown>;
  return {
    name: typeof o.name === 'string' ? o.name : 'warung',
    period: o.period === 'monthly' || o.period === 'yearly' ? o.period : null,
    expiresAt: typeof o.expiresAt === 'number' ? o.expiresAt : null,
    maxStores: typeof o.maxStores === 'number' ? o.maxStores : 1,
    features: Array.isArray(o.features) ? (o.features.filter((f) => typeof f === 'string' && KNOWN.has(f)) as PlanFeature[]) : [],
    serverTime: typeof o.serverTime === 'number' ? o.serverTime : 0,
  };
}

export const GRACE_MS = 3 * 86_400_000;

/** Penguncian fitur paket aktif (sama dengan kJuraganGatingEnabled di app). */
export const GATING_ENABLED = true;

export const effectiveNow = (p: PlanInfo, deviceNow: number) => Math.max(deviceNow, p.serverTime);

export function isActive(p: PlanInfo, deviceNow: number): boolean {
  if (p.name !== 'juragan' || p.expiresAt == null) return false;
  return effectiveNow(p, deviceNow) < p.expiresAt + GRACE_MS;
}

export function allows(p: PlanInfo, f: PlanFeature, deviceNow: number, gating = GATING_ENABLED): boolean {
  if (!gating) return true;
  return isActive(p, deviceNow) && p.features.includes(f);
}

export function daysLeft(p: PlanInfo, deviceNow: number): number | null {
  if (p.name !== 'juragan' || p.expiresAt == null) return null;
  const ms = p.expiresAt - effectiveNow(p, deviceNow);
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}
