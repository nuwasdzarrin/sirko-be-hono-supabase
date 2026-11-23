import { ApiError } from '../lib/api';
import { accessToken, authed, refreshActive } from '../session/auth';

/**
 * Katalog Umum — klien API yang sama dengan aplikasi HP (cloud_catalog_repository.dart,
 * cloud_contribution_repository.dart, cloud_media_repository.dart). Butuh internet.
 */

export interface CatalogItem {
  id: string;
  barcode: string | null;
  barcodeType: string | null;
  name: string;
  shortDescription: string | null;
  photoUrl: string | null;
  brand: string | null;
  category: string | null;
  manufacturer: string | null;
  defaultUnit: string | null;
  netSize: number | null;
  netUnit: string | null;
  packaging: string | null;
  variant: string | null;
  countryOfOrigin: string | null;
  keywords: string[];
  verified: boolean;
  source: string | null;
  updatedAt: number;
}

const s = (v: unknown) => (v == null || v === '' ? null : String(v));

export function itemFromJson(j: Record<string, unknown>): CatalogItem {
  const kw = j.keywords;
  return {
    id: String(j.id ?? j.barcode ?? crypto.randomUUID()),
    barcode: s(j.barcode),
    barcodeType: s(j.barcodeType),
    name: String(j.name ?? ''),
    shortDescription: s(j.shortDescription),
    photoUrl: s(j.photoUrl),
    brand: s(j.brand),
    category: s(j.category),
    manufacturer: s(j.manufacturer),
    defaultUnit: s(j.defaultUnit),
    netSize: j.netSize == null || j.netSize === '' ? null : Number(j.netSize),
    netUnit: s(j.netUnit),
    packaging: s(j.packaging),
    variant: s(j.variant),
    countryOfOrigin: s(j.countryOfOrigin),
    keywords: Array.isArray(kw) ? kw.map(String) : typeof kw === 'string' && kw ? safeList(kw) : [],
    verified: j.verified === true,
    source: s(j.source),
    updatedAt: Number(j.updatedAt ?? 0) || 0,
  };
}

function safeList(v: string): string[] {
  try {
    const x = JSON.parse(v);
    return Array.isArray(x) ? x.map(String) : [];
  } catch {
    return [];
  }
}

/** "85 g" — angka bulat tanpa desimal (sizeLabel aplikasi). */
export function sizeLabel(i: Pick<CatalogItem, 'netSize' | 'netUnit'>): string | null {
  if (i.netSize == null || !Number.isFinite(i.netSize)) return null;
  const n = Number.isInteger(i.netSize) ? String(i.netSize) : String(i.netSize).replace('.', ',');
  return i.netUnit ? `${n} ${i.netUnit}` : n;
}

export async function searchCatalog(q: string, cursor?: string | null, limit = 20): Promise<{ items: CatalogItem[]; nextCursor: string | null; hasMore: boolean }> {
  const p = new URLSearchParams();
  if (q.trim()) p.set('q', q.trim());
  if (cursor) p.set('cursor', cursor);
  p.set('limit', String(limit));
  const r = await authed<Array<Record<string, unknown>>>('GET', `/v1/catalog/search?${p}`, undefined, { timeoutMs: 15_000 });
  return {
    items: (r.data ?? []).map(itemFromJson),
    nextCursor: (r.meta?.nextCursor as string | null) ?? null,
    hasMore: r.meta?.hasMore === true,
  };
}

/** 1 produk untuk barcode ini, atau null bila tak ada di katalog (404). */
export async function lookupBarcode(barcode: string, timeoutMs = 8_000): Promise<CatalogItem | null> {
  try {
    const r = await authed<Record<string, unknown>>('GET', `/v1/catalog/lookup?barcode=${encodeURIComponent(barcode.trim())}`, undefined, { timeoutMs });
    return r.data ? itemFromJson(r.data) : null;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

// ── Usulan (kontribusi) ──────────────────────────────────────────────────────

export interface ContributionInput {
  name: string;
  barcode?: string;
  brand?: string;
  category?: string;
  photoUrl?: string;
  netSize?: number;
  netUnit?: string;
  note?: string;
  targetId?: string;
}

export async function submitContribution(c: ContributionInput): Promise<{ id: string; status: string }> {
  const body: Record<string, unknown> = { name: c.name.trim() };
  for (const k of ['barcode', 'brand', 'category', 'photoUrl', 'netUnit', 'note', 'targetId'] as const) {
    const v = c[k]?.trim();
    if (v) body[k] = v;
  }
  if (c.netSize != null && Number.isFinite(c.netSize)) body.netSize = c.netSize;
  const r = await authed<Record<string, unknown>>('POST', '/v1/catalog/contributions', body);
  return { id: String(r.data.id), status: String(r.data.status ?? 'pending') };
}

export interface Contribution {
  id: string;
  name: string;
  status: 'pending' | 'approved' | 'rejected' | string;
  barcode: string | null;
  reviewNote: string | null;
  resultProductId: string | null;
  createdAt: number;
}

export async function myContributions(): Promise<Contribution[]> {
  const r = await authed<Array<Record<string, unknown>>>('GET', '/v1/catalog/contributions?limit=50');
  return (r.data ?? []).map((j) => ({
    id: String(j.id),
    name: s(j.name) ?? '(tanpa nama)',
    status: String(j.status ?? 'pending'),
    barcode: s(j.barcode),
    reviewNote: s(j.reviewNote),
    resultProductId: s(j.resultProductId),
    createdAt: Number(j.createdAt ?? 0) || 0,
  }));
}

// ── Foto usulan: kompres ≤ 200 KB JPEG → sign-upload scope "product" → PUT ────

/** Kompres gambar (sama dengan image_compressor aplikasi): sisi terpanjang ≤ 1280, JPEG ≤ 200 KB. */
export async function compressImage(file: Blob, maxBytes = 200 * 1024): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  let side = Math.min(1280, Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const draw = (longest: number) => {
    const k = longest / Math.max(bmp.width, bmp.height);
    canvas.width = Math.max(1, Math.round(bmp.width * k));
    canvas.height = Math.max(1, Math.round(bmp.height * k));
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  };
  const toBlob = (q: number) => new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Gagal memproses gambar'))), 'image/jpeg', q));
  draw(side);
  for (const q of [0.85, 0.75, 0.65, 0.55, 0.45, 0.35]) {
    const b = await toBlob(q);
    if (b.size <= maxBytes) return b;
  }
  while (side > 240) {
    side = Math.max(240, Math.round(side * 0.75));
    draw(side);
    const b = await toBlob(0.35);
    if (b.size <= maxBytes) return b;
  }
  return toBlob(0.3);
}

/**
 * Foto usulan: kompres seperti aplikasi lalu unggah lewat server (`POST /v1/media/upload`, key scope
 * `product`). Browser tak bisa PUT langsung ke bucket (CSP connect-src 'self' + CORS bucket).
 */
export async function uploadCatalogImage(file: File): Promise<string> {
  const jpg = await compressImage(file);
  const name = (file.name.replace(/\.[^.]+$/, '') || 'foto').slice(0, 60);
  const send = async (token: string | null) =>
    fetch(`/v1/media/upload?fileName=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: jpg,
      signal: AbortSignal.timeout(30_000),
    });
  let res = await send(await accessToken());
  if (res.status === 401 && (await refreshActive())) res = await send(await accessToken());
  const json = (await res.json().catch(() => null)) as { data?: { publicUrl?: string }; error?: { code?: string; message?: string } } | null;
  if (!res.ok || !json?.data?.publicUrl) throw new ApiError(res.status, json?.error?.code ?? 'UPLOAD', json?.error?.message ?? `Upload gambar gagal (${res.status})`);
  return json.data.publicUrl;
}
