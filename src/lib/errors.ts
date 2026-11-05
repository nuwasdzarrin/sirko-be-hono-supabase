/**
 * Kode error standar (spec 10 §0) → HTTP status.
 * Error handler memetakan {@link AppError} ke envelope error.
 */
export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UPGRADE_REQUIRED'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  // ── PPOB ──
  | 'OWNER_ACCOUNT_MISSING'
  | 'INSUFFICIENT_POINTS'
  | 'PPOB_UNAVAILABLE'
  | 'PRODUCT_UNAVAILABLE'
  // ── Juragan ──
  | 'PLAN_REQUIRED'
  | 'PLAN_LIMIT'
  | 'PLAN_UNAVAILABLE';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UPGRADE_REQUIRED: 409, // client schemaVersion lebih baru dari yang didukung server
  RATE_LIMITED: 429,
  INTERNAL: 500,
  // ── PPOB ──
  OWNER_ACCOUNT_MISSING: 409, // toko tanpa akun pemilik cloud → Poin tak tersedia
  INSUFFICIENT_POINTS: 409, // saldo Poin kurang untuk pembelian
  PPOB_UNAVAILABLE: 503, // PPOB dimatikan / belum dikonfigurasi
  PRODUCT_UNAVAILABLE: 409, // produk nonaktif / cut-off / bukan jalur otomatis
  // ── Juragan ──
  PLAN_REQUIRED: 403, // fitur butuh Paket Juragan
  PLAN_LIMIT: 403, // sudah mencapai maxStores
  PLAN_UNAVAILABLE: 503, // harga/pembayaran langganan belum diatur
};

/** Error domain terkendali — dibawa apa adanya ke envelope error. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export const httpStatusFor = (code: ErrorCode): number => STATUS_BY_CODE[code];

// Pabrik ringkas untuk kasus umum.
export const unauthenticated = (message = 'Token hilang atau tidak valid', details?: unknown) =>
  new AppError('UNAUTHENTICATED', message, details);
export const forbidden = (message = 'Tidak memiliki izin', details?: unknown) =>
  new AppError('FORBIDDEN', message, details);
export const notFound = (message = 'Resource tidak ditemukan', details?: unknown) =>
  new AppError('NOT_FOUND', message, details);
export const conflict = (message: string, details?: unknown) =>
  new AppError('CONFLICT', message, details);
export const validation = (message = 'Validasi gagal', details?: unknown) =>
  new AppError('VALIDATION', message, details);
export const upgradeRequired = (message: string, details?: unknown) =>
  new AppError('UPGRADE_REQUIRED', message, details);
